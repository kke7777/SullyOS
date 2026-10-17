import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextBuilder } from '../context';
import { prepareRecollection, RECOLLECTION_TIMEOUT_MS, buildRecollectionPrompt } from './recollection';
import { createRecollectionDispatch, readUsedRecollection, saveUsedRecollection } from './recollectionSnapshot';
import { waitForPalaceRequest } from './maintenanceMode';
import { estimateContextTokens } from '../tokenEstimate';
import type { RecallMaterial } from './recallMaterial';

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
const response = (content: unknown, extra = {}) => new Response(JSON.stringify({
    choices: [{ message: { content, ...extra } }],
}), { headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('os_memory_palace_config', JSON.stringify({ lightLLM: config }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); localStorage.clear(); });

describe('recall recollection', () => {
    it('sends one batch with identity/worldview/user/visible history, retaining constant blocks', async () => {
        const fetch = vi.fn(async () => response('那天我和小明一起坐在海边，等太阳慢慢落下去。'));
        vi.stubGlobal('fetch', fetch);
        const result = await prepareRecollection(input());
        expect(fetch).toHaveBeenCalledTimes(1);
        const [url, init] = fetch.mock.calls[0] as any;
        const body = JSON.parse(init.body);
        expect(url).toBe(config.baseUrl + '/chat/completions');
        expect(init.headers.Authorization).toBe('Bearer test-secondary');
        expect(body.model).toBe('writer');
        const sent = JSON.stringify(body.messages);
        for (const text of ['核心设定', '海边小镇', '用户设定', '还记得那次看海吗', '2026-09-01', '800—1200字']) expect(sent).toContain(text);
        expect(sent).not.toContain('置顶便利贴');
        expect(result.status).toBe('refined');
        expect(result.text).toBe(material.prefix + '那天我和小明一起坐在海边，等太阳慢慢落下去。\n\n' + material.suffix);
        expect(result.sources).toEqual(material.sources);
        // Preparation alone never changes the user-visible last-used record.
        expect(readUsedRecollection(input().char.id)).toBeNull();
    });

    it('keeps the first estimated 2000 tokens exactly and preserves Unicode', async () => {
        const text = '回忆😀abcd'.repeat(700);
        vi.stubGlobal('fetch', vi.fn(async () => response(text)));
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
        await vi.advanceTimersByTimeAsync(RECOLLECTION_TIMEOUT_MS);
        const result = await pending;
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
        const pending = prepareRecollection(input());
        await vi.advanceTimersByTimeAsync(RECOLLECTION_TIMEOUT_MS);
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
        expect(prompt.startsWith('你是角色，正在与小明聊天。')).toBe(true);
        expect(prompt.endsWith('直接输出回忆正文。')).toBe(true);
    });
});

describe('last dispatched recollection', () => {
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
