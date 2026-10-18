import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextBuilder } from '../context';
import { prepareRecollection, buildRecollectionPrompt, recollectionOutputProblem } from './recollection';
import { createRecollectionDispatch, readUsedRecollection, saveUsedRecollection } from './recollectionSnapshot';
import { waitForPalaceRequest } from './maintenanceMode';
import { estimateContextTokens } from '../tokenEstimate';
import { buildPromptBreakdown } from '../apiCallLog';
import type { RecallMaterial } from './recallMaterial';
import { readRecollectionReference } from './recollectionReference';
import { formatMessageForPrompt } from '../messageFormat';

const config = { baseUrl: 'https://secondary.example/v1', apiKey: 'test-secondary', model: 'writer' };
const material: RecallMaterial = {
    originalText: '原始完整召回文字', memoryText: '[2026-09-01] 我们在海边看过日落。',
    prefix: '宫殿标题\n置顶便利贴\n\n', suffix: '> 窗台期盼\n想再一起看海',
    sources: [{ id: 'box-sea', kind: 'event_box', name: '海边旅行' }],
};
const input = () => ({
    char: { id: 'recollection-char', name: '角色', systemPrompt: '核心设定', worldview: '海边小镇' } as any,
    user: { name: '小明', bio: '用户设定' } as any,
    messages: [{ id: 2, role: 'user', type: 'text', content: '还记得那次看海吗' }] as any[],
    material, originalText: material.originalText,
});
const response = (content: unknown, extra = {}, _init?: RequestInit) => new Response(JSON.stringify({
    choices: [{ message: { content, ...extra } }],
}), { headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('os_memory_palace_config', JSON.stringify({ lightLLM: config }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); localStorage.clear(); });

describe('recall recollection', () => {
    it.each([0, 1, 59, 60, 61, 125])('sends only the latest 60 visible chat bubbles, sharing the budget across speakers (%i)', async count => {
        const bubbles = Array.from({ length: count }, (_, i) => ({
            id: i + 1, role: i % 3 ? 'assistant' : 'user', type: 'text',
            content: `气泡${i + 1}正文\n第二行`, timestamp: i + 1,
        }));
        const messages = bubbles.flatMap(bubble => [bubble, { id: 1000 + bubble.id, role: 'system', type: 'text', content: '非聊天消息' }]);
        const args = { ...input(), messages: messages as any[] };
        const before = JSON.stringify(args);
        const fetch = vi.fn(async () => response('那天我们在海边。'));
        vi.stubGlobal('fetch', fetch);
        await prepareRecollection(args);
        const body = JSON.parse(String((fetch.mock.calls[0] as any)[1].body));
        const entries = readRecollectionReference(body.messages[1].content)!;
        const chat = entries.filter(entry => entry.source === '当前对话参考片段');
        expect(chat.map(entry => [entry.role, entry.content])).toEqual(bubbles.slice(-60).map(bubble => [
            bubble.role, formatMessageForPrompt(bubble as any, args.char.name, args.user.name),
        ]));
        expect(entries[0].content).toContain('核心设定');
        expect(body.messages.at(-1).content).toBe(`本次召回记忆：\n${material.memoryText}`);
        expect(JSON.stringify(args)).toBe(before);
    });

    it.each([[0, 'system'], [1, 'user'], [2, 'assistant']] as const)('preserves worldbook triggers and depth entries outside the retained chat window (%i, %s)', async (role, roleName) => {
        const args = input();
        args.messages = Array.from({ length: 70 }, (_, i) => ({
            id: i + 1, role: i % 2 ? 'assistant' : 'user', type: 'text',
            content: i === 0 ? '早期触发词' : `最近消息${i + 1}`, timestamp: i + 1,
        }));
        args.char.mountedWorldbooks = [
            { id: 'early-trigger', title: '早期设定', content: '由旧气泡触发的世界书', constant: false, key: ['早期触发词'], scanDepth: 100, position: 1 },
            { id: 'deep-entry', title: '深度设定', content: '深度世界书原文', constant: true, position: 4, depth: 65, role },
        ];
        const fetch = vi.fn(async () => response('那天我们在海边。'));
        vi.stubGlobal('fetch', fetch);
        await prepareRecollection(args);
        const body = JSON.parse(String((fetch.mock.calls[0] as any)[1].body));
        const entries = readRecollectionReference(body.messages[1].content)!;
        expect(entries[0].content).toContain('由旧气泡触发的世界书');
        expect(entries).toContainEqual(expect.objectContaining({ source: '世界书补充设定', role: roleName, content: expect.stringContaining('深度世界书原文') }));
        const chat = entries.filter(entry => entry.source === '当前对话参考片段');
        expect(chat).toHaveLength(60);
        expect(chat[0].content).toContain('最近消息11');
        expect(chat.at(-1)?.content).toContain('最近消息70');
        expect(JSON.stringify(chat)).not.toContain('早期触发词');
    });

    it('sends one batch with identity/worldview/user/visible history, retaining constant blocks', async () => {
        const fetch = vi.fn(async (_url, init) => response('那天我和小明一起坐在海边，等太阳慢慢落下去。', {}, init));
        vi.stubGlobal('fetch', fetch);
        const result = await prepareRecollection(input());
        expect(fetch).toHaveBeenCalledTimes(1);
        const [url, init] = fetch.mock.calls[0] as any;
        const body = JSON.parse(init.body);
        expect(url).toBe(config.baseUrl + '/chat/completions');
        expect(init.headers.Authorization).toBe('Bearer test-secondary');
        expect(body.model).toBe('writer');
        expect(body.messages.at(-1)).toEqual({ role: 'user', content: `本次召回记忆：\n${material.memoryText}` });
        expect(buildPromptBreakdown(body)).toContainEqual({ label: '本次召回记忆', chars: body.messages.at(-1).content.length });
        const sent = JSON.stringify(body.messages);
        for (const text of ['核心设定', '海边小镇', '用户设定', '还记得那次看海吗', '2026-09-01', '1000—1600字']) expect(sent).toContain(text);
        expect(sent).not.toContain('置顶便利贴');
        expect(result.status).toBe('refined');
        expect(result.text).toBe(material.prefix + '那天我和小明一起坐在海边，等太阳慢慢落下去。\n\n' + material.suffix);
        expect(result.sources).toEqual(material.sources);
        // Preparation alone never changes the user-visible last-used record.
        expect(readUsedRecollection(input().char.id)).toBeNull();
    });

    it('keeps the first estimated 2000 tokens exactly and preserves Unicode', async () => {
        const text = '回忆😀abcd'.repeat(700);
        vi.stubGlobal('fetch', vi.fn(async (_url, init) => response(text, {}, init)));
        const result = await prepareRecollection({ ...input(), material: { ...material, prefix: '', suffix: '' } });
        const kept = result.text.trim();
        expect(estimateContextTokens(kept)).toBeLessThanOrEqual(2000);
        expect(estimateContextTokens(kept)).toBeGreaterThanOrEqual(1999);
        expect(text.startsWith(kept)).toBe(true);
        expect(kept).not.toMatch(/[\uD800-\uDBFF]$/);
    });

    it.each(['empty', 'reasoning', 'error'])('uses the complete original batch on %s, without retrying', async mode => {
        const fetch = vi.fn(async () => {
            if (mode === 'error') throw new TypeError('offline');
            return response('', mode === 'reasoning' ? { reasoning_content: '只是在思考如何回忆' } : {});
        });
        vi.stubGlobal('fetch', fetch);
        const original = '原文'.repeat(2500);
        const result = await prepareRecollection({ ...input(), originalText: original });
        expect(result).toMatchObject({ status: 'fallback', text: original, sources: material.sources });
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('skips the secondary call for empty recall, pins/anticipations only, or missing API settings', async () => {
        const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
        expect((await prepareRecollection({ ...input(), material: undefined, originalText: '' })).status).toBe('empty');
        expect((await prepareRecollection({ ...input(), material: { ...material, memoryText: '' } })).status).toBe('original');
        localStorage.removeItem('os_memory_palace_config');
        expect((await prepareRecollection(input())).status).toBe('fallback');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('accepts a complete response after 30 seconds without waiting for the 120-second deadline', async () => {
        vi.useFakeTimers();
        let finish!: (value: Response) => void;
        let requestSignal!: AbortSignal;
        const fetch = vi.fn((_url: string, init: RequestInit) => {
            requestSignal = init.signal!;
            return new Promise<Response>(resolve => { finish = resolve; });
        });
        vi.stubGlobal('fetch', fetch);
        const pending = prepareRecollection(input());
        await vi.advanceTimersByTimeAsync(45_000);
        expect(requestSignal.aborted).toBe(false);
        finish(response('那天我和小明在海边看日落。'));
        expect(await pending).toMatchObject({ status: 'refined', narrative: '那天我和小明在海边看日落。' });
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('bounds a response that sends headers immediately but never finishes its body; late text cannot overwrite', async () => {
        vi.useFakeTimers();
        let finish!: () => void;
        let requestSignal!: AbortSignal;
        vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
            requestSignal = init.signal!;
            return new Response(new ReadableStream({ start(controller) {
                finish = () => { controller.enqueue(new TextEncoder().encode(JSON.stringify({ choices: [{ message: { content: '迟到的回忆' } }] }))); controller.close(); };
            } }), { headers: { 'Content-Type': 'application/json' } });
        }));
        const pending = prepareRecollection(input());
        await vi.advanceTimersByTimeAsync(119_999);
        expect(requestSignal.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        const result = await pending;
        expect(result.fallbackReason).toBe('整理超时，已使用召回原记忆。');
        expect(result).toMatchObject({ status: 'fallback', text: material.originalText });
        expect(requestSignal.aborted).toBe(true);
        saveUsedRecollection(result);
        finish();
        await vi.advanceTimersByTimeAsync(0);
        expect(readUsedRecollection(result.charId)?.text).toBe(material.originalText);
    });

    it('includes maintenance queue time in the deadline and does not send a timed-out queued request', async () => {
        vi.useFakeTimers();
        localStorage.setItem('os_memory_palace_config', JSON.stringify({ lightLLM: config, manualMaintenance: true, maintenanceIntervalSeconds: 60 }));
        await waitForPalaceRequest();
        const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
        const pending = prepareRecollection({ ...input(), timeoutMs: 30_000 });
        await vi.advanceTimersByTimeAsync(30_000);
        expect((await pending).status).toBe('fallback');
        await vi.advanceTimersByTimeAsync(60_000);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('honors stop while building context and never starts a delayed request', async () => {
        const abort = new AbortController();
        const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
        let resolve!: (value: any[]) => void;
        vi.spyOn(ContextBuilder, 'buildCharacterRequest').mockImplementation(() => new Promise(done => { resolve = done; }));
        const pending = prepareRecollection({ ...input(), signal: abort.signal });
        abort.abort(new DOMException('已停止', 'AbortError'));
        await expect(pending).rejects.toThrow('已停止');
        resolve([]);
        await Promise.resolve();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('uses the approved prompt wording', () => {
        const prompt = buildRecollectionPrompt('角色', '小明');
        expect(prompt.startsWith('你是角色，正在回忆与小明有关的往事。')).toBe(true);
        expect(prompt.endsWith('只输出回忆正文，不写接下来如何回复对方的建议或计划。')).toBe(true);
    });

    it('keeps roleplay instructions and prior assistant replies in reference data, with only the writing task at system priority', async () => {
        const fetch = vi.fn(async (_url, init) => response('那天我和小明在海边。', {}, init));
        vi.stubGlobal('fetch', fetch);
        const result = await prepareRecollection({ ...input(), char: { ...input().char, systemPrompt: '每行输出聊天气泡，用语音回复' }, messages: [
            { id: 2, role: 'assistant', type: 'text', content: '<语音>旧回复</语音>' },
            { id: 3, role: 'user', type: 'text', content: '那天的事情呢？' },
        ] as any });
        const body = JSON.parse(String(fetch.mock.calls[0][1].body));
        expect(body.messages.filter((m: any) => m.role === 'assistant')).toEqual([]);
        expect(readRecollectionReference(body.messages[1].content)).toEqual(expect.arrayContaining([
            expect.objectContaining({ source: '当前对话参考片段', role: 'assistant', content: expect.stringContaining('旧回复') }),
        ]));
        expect(result.narrative).toBe('那天我和小明在海边。');
        expect(result.secondaryOutput).toBe('那天我和小明在海边。');
        expect(body.messages.filter((m: any) => m.role === 'system')).toHaveLength(1);
        expect(body.messages[0].content).not.toContain('每行输出聊天气泡');
        expect(body.messages[1].content).toContain('每行输出聊天气泡');
        expect(JSON.stringify(body.messages)).not.toContain('暂无特定记忆，请基于当前对话互动');
        expect(result.text).not.toContain('private_recollection');
    });

    it.each([
        '[角色]: ……诶？\n[角色]: 露露往上翻了一下，好像真的是呢\n[角色]: <语音>宝贝，你连这个都发现了呀。</语音>\n[角色]: [表情包]',
        '### 记忆宫殿 (Memory Palace)\n📌 **便利贴（近期重要事项）**\n记着不等于要一直说——话赶到那儿了顺口提一句就够了',
    ])('rejects the observed chat/template output itself, preserving the raw response and full original memories (%s)', async raw => {
        const fetch = vi.fn(async () => response(raw));
        vi.stubGlobal('fetch', fetch);
        const result = await prepareRecollection(input());
        expect(result).toMatchObject({ status: 'fallback', text: material.originalText, secondaryOutput: raw });
        expect(result.fallbackReason).toContain('已使用召回原文');
        expect(result.narrative).toBeUndefined();
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('allows a diary to quote an old conversation without requiring an arbitrary response tag', async () => {
        const narrative = '那天我和小明坐在海边，风吹得眼睛有些睁不开。\n[角色]: 想再看一会儿日落。\n小明没有催我，只把围巾递给我。现在想起她的动作，我仍然觉得暖和。';
        expect(recollectionOutputProblem(narrative, material, ['角色', '小明'])).toBeUndefined();
        vi.stubGlobal('fetch', vi.fn(async () => response(narrative)));
        expect(await prepareRecollection(input())).toMatchObject({ status: 'refined', narrative });
    });

});

describe('last dispatched recollection', () => {
    it('keeps the dispatch snapshot independent of later main reply and source mutations', () => {
        const next = { charId: 'snapshot-value', text: '固定的注入正文', narrative: '固定的整理回忆', secondaryOutput: '副API原文', status: 'refined' as const, sources: [{ id: 'one', kind: 'memory' as const, name: '原条目' }] };
        const dispatch = createRecollectionDispatch(next);
        next.text = '[角色]: 本轮主回复'; next.narrative = '改写的正文'; next.sources[0].name = '错误条目';
        dispatch();
        expect(readUsedRecollection(next.charId)).toMatchObject({ text: '固定的注入正文', narrative: '固定的整理回忆', secondaryOutput: '副API原文', sources: [{ name: '原条目' }] });
    });
    it('keeps the previous result until dispatch, saves all fields together and separates characters', () => {
        const previous = { charId: 'char-a', text: '上一次', sources: material.sources, status: 'refined' } as const;
        saveUsedRecollection({ ...previous, sources: [...previous.sources] });
        const next = { ...previous, text: '这一次的原文', sources: [{ id: 'new', kind: 'memory' as const, name: '日期 · 正文开头' }], status: 'fallback' as const };
        const dispatch = createRecollectionDispatch(next);
        expect(readUsedRecollection('char-a')?.text).toBe('上一次');
        dispatch();
        const saved = readUsedRecollection('char-a');
        expect(saved).toMatchObject(next);
        dispatch();
        expect(readUsedRecollection('char-a')).toEqual(saved);
        expect(readUsedRecollection('char-b')).toBeNull();
        // A new module instance reads the persisted JSON, independent of prepared in-memory state.
        expect(JSON.parse(localStorage.getItem('os_mp_used_recollection_char-a')!)).toEqual(saved);
    });
});
