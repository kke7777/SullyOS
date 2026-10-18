import type { CharacterProfile, Message, UserProfile } from '../../types';
import { ContextBuilder } from '../context';
import { formatMessageForPrompt } from '../messageFormat';
import { extractContent, safeFetchJson } from '../safeApi';
import { truncateContextTokens } from '../tokenEstimate';
import type { RecallMaterial } from './recallMaterial';
import type { RecollectionSnapshot } from './recollectionSnapshot';
import { formatRecollectionReference } from './recollectionReference';

export const RECOLLECTION_TIMEOUT_MS = 30_000;
export const RECOLLECTION_TOKEN_LIMIT = 2000;

/** Reject the observed wrong-task shapes; normal narration may still quote past dialogue. */
export function recollectionOutputProblem(content: string, material: RecallMaterial, names: string[]): string | undefined {
    const lines = content.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const dialogue = lines.filter(line => {
        const speaker = line.match(/^\[([^\]\r\n]+)\]\s*[:：]/)?.[1];
        return speaker && names.some(name => name && (speaker === name || name.startsWith(speaker + '·')));
    });
    if (dialogue.length >= 3 && dialogue.reduce((sum, line) => sum + line.length, 0) >= content.trim().length * 0.5) {
        return '副 API 写成了聊天记录，已使用召回原文。';
    }
    const prefix = material.prefix.trim();
    if ((prefix.length >= 20 && content.includes(prefix))
        || /^\s*###\s*记忆宫殿\s*\(Memory Palace\)/.test(content)
        || content.includes('记着不等于要一直说——话赶到那儿了顺口提一句就够了')) {
        return '副 API 返回了记忆模板内容，已使用召回原文。';
    }
}

export function buildRecollectionPrompt(charName: string, userName: string): string {
    return `你是${charName}，正在回忆与${userName}有关的往事。

1. 资料作用
角色设定用于保持你的身份、性格与感受；当前对话用于判断哪些往事相关；“本次召回记忆”是回忆中事件、原话和细节的事实依据。

2. 回忆写作
从本次召回记忆中选取与当前话题最相关的往事，以自己的第一人称，像写私人日记一样自然地回忆。

讲清事情的来龙去脉，忠实保留记忆中已有的对话、人物互动、情绪变化和有意思的小细节。相近的经历可以自然串联，让回忆具体、生动，带有角色自己的感受。

记忆里没有交代的地方，可以保留空白，不必补出新的情节、对话或细节。

3. 篇幅要求
素材丰富时，充分展开至约1000—1600字；素材较少时，按实际内容自然叙述。

4. 输出要求
只输出回忆正文，不写接下来如何回复对方的建议或计划。`;
}

function readSecondaryApi(): { baseUrl: string; apiKey: string; model: string } | null {
    try {
        const api = JSON.parse(localStorage.getItem('os_memory_palace_config') || '{}').lightLLM;
        return api && ['baseUrl', 'apiKey', 'model'].every(key => typeof api[key] === 'string' && api[key].trim()) ? api : null;
    } catch { return null; }
}

export async function prepareRecollection(input: {
    char: CharacterProfile;
    user: UserProfile;
    /** Already limited to this request's visible, post-waterline original messages. */
    messages: Message[];
    material?: RecallMaterial;
    originalText: string;
    signal?: AbortSignal;
    timeoutMs?: number;
}): Promise<RecollectionSnapshot> {
    const { char, user, signal } = input;
    // Freeze the batch before any asynchronous work. It cannot acquire later chat text.
    const material = input.material && { ...input.material, sources: input.material.sources.map(source => ({ ...source })) };
    const history = input.messages.filter(message => message.role === 'user' || message.role === 'assistant').map(message => ({
        role: message.role,
        content: formatMessageForPrompt(message, char.name, user.name || '用户'),
    }));
    signal?.throwIfAborted();
    const original: RecollectionSnapshot = {
        charId: char.id, text: input.originalText, sources: material?.sources ?? [],
        status: input.originalText ? 'original' : 'empty',
    };
    if (!material?.memoryText.trim()) return original;
    const requestId = Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
    const fallback: RecollectionSnapshot = { ...original, status: 'fallback', requestId, recalledText: material.memoryText };
    const api = readSecondaryApi();
    if (!api) return { ...fallback, fallbackReason: '未配置副 API，已使用召回原文。' };

    // One deadline includes context building, maintenance queue, fetch and the complete body.
    // Promise.race also bounds providers/adapters that do not settle after abort.
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortParent: (() => void) | undefined;
    const deadline = new Promise<never>((_, reject) => {
        abortParent = () => {
            const reason = signal?.reason ?? new DOMException('已取消', 'AbortError');
            controller.abort(reason);
            reject(reason);
        };
        signal?.addEventListener('abort', abortParent, { once: true });
        timer = setTimeout(() => {
            const reason = new Error('回忆整理超时');
            controller.abort(reason);
            reject(reason);
        }, input.timeoutMs ?? RECOLLECTION_TIMEOUT_MS);
    });
    try {
        const work = async (): Promise<RecollectionSnapshot> => {
            // Only identity/worldview/worldbooks/user settings enter this auxiliary request.
            // Existing memories, plates, schedules and reply-format rules are not extra sources.
            const identity = {
                id: char.id, name: char.name, description: char.description,
                systemPrompt: char.systemPrompt, worldview: char.worldview,
                mountedWorldbooks: char.mountedWorldbooks,
                timeAwarenessEnabled: false,
            } as CharacterProfile;
            // Resolve mounted worldbooks against the original visible history once.
            // This is reference material for the writer, not another live roleplay session.
            const reference = await ContextBuilder.buildCharacterRequest({
                char: identity, user, includeDetailedMemories: false,
                layout: { deferVolatile: true, omitMemoryBank: true }, timeOptions: { skipTimeAwareness: true },
            }, history);
            controller.signal.throwIfAborted();
            const messages = [
                { role: 'system', content: buildRecollectionPrompt(char.name, user.name || '用户') },
                { role: 'user', content: formatRecollectionReference(reference.map((message, index) => ({
                    source: index === 0 ? '角色与关系设定' : history.some(entry => entry === message) ? '当前对话参考片段' : '世界书补充设定',
                    role: message.role, content: message.content,
                }))) },
                { role: 'user', content: `本次召回记忆：\n${material.memoryText}` },
            ];
            const data = await safeFetchJson(`${api.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST', signal: controller.signal,
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey}` },
                body: JSON.stringify({ model: api.model, messages, temperature: 0.7, max_tokens: 4096, stream: false }),
            }, 0, 0, { appName: '记忆宫殿', charId: char.id, charName: char.name, purpose: '召回回忆整理' });
            controller.signal.throwIfAborted();
            // A reasoning-only response is an empty recollection, not a usable private memory.
            const raw = data?.choices?.[0]?.message?.content;
            const secondaryOutput = typeof raw === 'string' ? raw : raw == null ? '' : JSON.stringify(raw);
            const content = extractContent({ choices: [{ message: { content: data?.choices?.[0]?.message?.content } }] });
            if (!content) return { ...fallback, secondaryOutput, fallbackReason: '副 API 返回正文为空，已使用召回原文。' };
            const problem = recollectionOutputProblem(content, material, [char.name, user.name || '用户']);
            if (problem) return { ...fallback, secondaryOutput, fallbackReason: problem };
            const narrative = truncateContextTokens(content, RECOLLECTION_TOKEN_LIMIT);
            return { ...fallback, status: 'refined', secondaryOutput, narrative,
                text: `${material.prefix}${narrative}\n\n${material.suffix}`.trim() };
        };
        return await Promise.race([work(), deadline]);
    } catch {
        signal?.throwIfAborted();
        return { ...fallback, fallbackReason: controller.signal.aborted ? '回忆整理等待超时，已使用召回原文。' : '副 API 请求失败，已使用召回原文。' };
    } finally {
        if (timer) clearTimeout(timer);
        if (abortParent) signal?.removeEventListener('abort', abortParent);
    }
}
