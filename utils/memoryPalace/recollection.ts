import type { CharacterProfile, Message, UserProfile } from '../../types';
import { ContextBuilder } from '../context';
import { formatMessageForPrompt } from '../messageFormat';
import { extractContent, safeFetchJson } from '../safeApi';
import { truncateContextTokens } from '../tokenEstimate';
import type { RecallMaterial } from './recallMaterial';
import type { RecollectionSnapshot } from './recollectionSnapshot';

export const RECOLLECTION_TIMEOUT_MS = 30_000;
export const RECOLLECTION_TOKEN_LIMIT = 2000;

export function buildRecollectionPrompt(charName: string, userName: string): string {
    return `你是${charName}，正在与${userName}聊天。

请结合当前对话和角色设定，从召回的记忆中选取最相关的往事，以自己的第一人称，像写私人日记一样自然地回忆。

讲清事情的来龙去脉，忠实保留记忆中已有的对话、人物互动、情绪变化和有意思的小细节。相近的经历可以自然串联，让回忆具体、生动，带有角色自己的感受。

优先写与当前话题最有关联的经历。素材丰富时，充分展开至约800—1200字；素材较少时，按实际内容自然叙述。

直接输出回忆正文。`;
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
    const { char, user, material, signal } = input;
    signal?.throwIfAborted();
    const original: RecollectionSnapshot = {
        charId: char.id, text: input.originalText, sources: material?.sources ?? [],
        status: input.originalText ? 'original' : 'empty',
    };
    if (!material?.memoryText.trim()) return original;
    const fallback: RecollectionSnapshot = { ...original, status: 'fallback' };
    const api = readSecondaryApi();
    if (!api) return fallback;

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
            const history = input.messages.map(message => ({
                role: message.role,
                content: formatMessageForPrompt(message, char.name, user.name || '用户'),
            }));
            const messages = await ContextBuilder.buildCharacterRequest({
                char: identity, user, includeDetailedMemories: false,
                layout: { deferVolatile: true }, timeOptions: { skipTimeAwareness: true },
                instructions: buildRecollectionPrompt(char.name, user.name || '用户'),
            }, history);
            controller.signal.throwIfAborted();
            messages.push({ role: 'user', content: `本次召回记忆：\n${material.memoryText}` });
            const data = await safeFetchJson(`${api.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST', signal: controller.signal,
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey}` },
                body: JSON.stringify({ model: api.model, messages, temperature: 0.7, max_tokens: 4096, stream: false }),
            }, 0, 0, { appName: '记忆宫殿', charId: char.id, charName: char.name, purpose: '召回回忆整理' });
            controller.signal.throwIfAborted();
            // A reasoning-only response is an empty recollection, not a usable private memory.
            const content = extractContent({ choices: [{ message: { content: data?.choices?.[0]?.message?.content } }] });
            if (!content) return fallback;
            const narrative = truncateContextTokens(content, RECOLLECTION_TOKEN_LIMIT);
            return { ...original, status: 'refined', text: `${material.prefix}${narrative}\n\n${material.suffix}`.trim() };
        };
        return await Promise.race([work(), deadline]);
    } catch {
        signal?.throwIfAborted();
        return fallback;
    } finally {
        if (timer) clearTimeout(timer);
        if (abortParent) signal?.removeEventListener('abort', abortParent);
    }
}
