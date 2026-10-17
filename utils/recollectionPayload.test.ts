import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildChatRequestPayload } from './chatRequestPayload';
import * as palace from './memoryPalace/pipeline';
import { safeFetchJson } from './safeApi';
import { createRecollectionDispatch, readUsedRecollection, saveUsedRecollection } from './memoryPalace/recollectionSnapshot';
import type { RecallMaterial } from './memoryPalace/recallMaterial';

const batch: RecallMaterial = {
    originalText: '原始召回标记', memoryText: '2026-09-01 原始往事标记',
    prefix: '### 记忆宫殿\n便利贴标记\n', suffix: '期盼标记',
    sources: [{ id: 'sea-box', kind: 'event_box', name: '看海的约定' }],
};
const input = () => ({
    char: { id: 'payload-recollection', name: '角色', memoryPalaceEnabled: true, contextRangeMode: 'manual', contextLimit: 50,
        systemPrompt: '人设标记', worldview: '世界观标记',
        mountedWorldbooks: [{ id: 'sea', title: '海边设定', content: '海边世界书标记', constant: false, key: ['海边'], position: 1 }],
    } as any,
    userProfile: { name: '小明', bio: '用户设定标记' } as any,
    groups: [], emojis: [], categories: [], contextLimit: 50, contextHighWaterMark: 5,
    recallEntryPoint: 'chat_app' as const,
    historyMsgs: [
        { id: 4, role: 'user', type: 'text', content: '水位前的原文', timestamp: 400 },
        { id: 7, role: 'assistant', type: 'text', content: '刚才的回复', timestamp: 700 },
        { id: 8, role: 'user', type: 'text', content: '海边的约定还记得吗', timestamp: 800 },
    ] as any[],
});
beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('os_memory_palace_config', JSON.stringify({ lightLLM: { baseUrl: 'https://secondary.example/v1', apiKey: 'secondary', model: 'writer' } }));
    vi.spyOn(palace, 'injectMemoryPalace').mockImplementation(async (char, _messages, _query, _name, options) => {
        options?.onMaterial?.(batch);
        char.memoryPalaceInjection = batch.originalText;
        char.roomPlatesInjection = '门牌标记';
        // A concurrent archive after recall must affect only the next request.
        localStorage.setItem(`mp_lastMsgId_${char.id}`, '999');
        return { stages: [], injection: {} } as any;
    });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

it.each(['chat_app', 'home_3d', 'proactive_chat'] as const)('uses the prepared batch exactly once for %s and saves at the main transport dispatch', async entry => {
    const previous = { charId: input().char.id, text: '上一次真正使用的回忆', sources: [], status: 'refined' as const };
    saveUsedRecollection(previous);
    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)); bodies.push(body);
        if (String(url).includes('secondary.example')) {
            expect(readUsedRecollection(previous.charId)?.text).toBe(previous.text);
            return new Response(JSON.stringify({ choices: [{ message: { content: '整理后的私人回忆标记' } }] }));
        }
        const snapshot = readUsedRecollection(previous.charId);
        expect(snapshot).toMatchObject({ status: 'refined', sources: batch.sources });
        expect(snapshot?.text).toContain('整理后的私人回忆标记');
        expect(body.messages.some((message: any) => typeof message.content === 'string' && message.content.includes(snapshot?.text))).toBe(true);
        return new Response(JSON.stringify({ choices: [{ message: { content: '回复' } }] }));
    }));
    const args = { ...input(), recallEntryPoint: entry };
    const stages: any[] = [];
    const result = await buildChatRequestPayload({ ...args, onPreparationStage: event => stages.push(event) });
    const secondary = JSON.stringify(bodies[0].messages);
    for (const marker of ['人设标记', '世界观标记', '海边世界书标记', '用户设定标记', '刚才的回复', '海边的约定还记得吗', batch.memoryText]) expect(secondary).toContain(marker);
    expect(secondary).not.toContain('水位前的原文');
    expect(bodies).toHaveLength(1);
    expect(result.systemPrompt).toContain('整理后的私人回忆标记');
    expect(result.systemPrompt).not.toContain('原始召回标记');
    for (const marker of ['便利贴标记', '期盼标记', '门牌标记']) expect(result.systemPrompt).toContain(marker);
    expect(args.char).not.toHaveProperty('memoryPalaceInjection');
    expect(readUsedRecollection(previous.charId)?.text).toBe(previous.text);
    expect(stages.filter(event => event.stage === 'memory').map(event => event.status)).toEqual(['start', 'end']);
    await safeFetchJson('https://main.example/v1/chat/completions', { method: 'POST', body: JSON.stringify({ messages: result.fullMessages }) },
        0, 0, undefined, undefined, createRecollectionDispatch(result.recollection));
    expect(bodies).toHaveLength(2);
});

it('does not save a prepared result if the send was stopped before fetch', async () => {
    const abort = new AbortController(); abort.abort();
    const dispatch = createRecollectionDispatch({ charId: 'stopped', text: '尚未使用', sources: [], status: 'refined' });
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(safeFetchJson('https://main.example/v1/chat/completions', { signal: abort.signal, body: '{}' }, 0, 0, undefined, undefined, dispatch)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect(readUsedRecollection('stopped')).toBeNull();
});

it('does not start a writing request when memory palace is disabled', async () => {
    vi.spyOn(palace, 'injectMemoryPalace').mockImplementation(async () => ({ stages: [], injection: {} }) as any);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const args = input(); args.char.memoryPalaceEnabled = false;
    const result = await buildChatRequestPayload(args);
    expect(result.recollection).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
});
