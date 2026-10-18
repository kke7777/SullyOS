import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { prepareCallRecollection } from './callRecollection';
import { injectMemoryPalace } from './pipeline';
import { readUsedRecollection } from './recollectionSnapshot';
import { readRecollectionReference } from './recollectionReference';
vi.mock('./pipeline', () => ({ injectMemoryPalace: vi.fn() }));
const char = { id: 'call-char', name: '角色', systemPrompt: '角色设定', memoryPalaceEnabled: true,
    memoryPalaceInjection: '上一轮残留', roomPlatesInjection: '旧门牌' } as any;
const msg = (id: number, role = 'user', content = `消息${id}`) => ({ id, charId: char.id, role, type: 'text', content, timestamp: id } as any);
const args = () => ({ char, user: { name: '用户' } as any,
    range: { hwm: 1, messages: [msg(1), msg(2), msg(3)] } as any,
    text: '本轮问题', skipDbId: 3, signal: new AbortController().signal });
beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('os_memory_palace_config', JSON.stringify({ lightLLM: {
        baseUrl: 'https://writer.example/v1', apiKey: 'test', model: 'writer',
    } }));
    vi.mocked(injectMemoryPalace).mockImplementation(async (target, _messages, _hint, _name, options) => {
        target.memoryPalaceInjection = '完整原召回'; target.roomPlatesInjection = '门牌';
        options?.onMaterial?.({ originalText: '完整原召回', memoryText: '曾一起看海', prefix: '', suffix: '', sources: [] });
        return {} as any;
    });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('refines one batch with the current turn, excludes archived originals, and saves only at dispatch', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '我记得一起看海。' } }] })));
    vi.stubGlobal('fetch', fetch);
    const result = await prepareCallRecollection(args());
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetch.mock.calls[0] as any)[1].body));
    const refs = readRecollectionReference(body.messages[1].content)!;
    const history = refs.filter(ref => ref.source === '当前对话参考片段');
    expect(history).toHaveLength(2);
    expect(history[0].content).toContain('消息2');
    expect(history[1].content).toContain('本轮问题');
    expect(result.char.memoryPalaceInjection).toBe('我记得一起看海。');
    expect(result.char.roomPlatesInjection).toBe('门牌');
    expect(char.memoryPalaceInjection).toBe('上一轮残留');
    expect(readUsedRecollection(char.id)).toBeNull();
    result.onDispatch();
    const saved = readUsedRecollection(char.id);
    expect(saved?.status).toBe('refined');
    result.onDispatch(); // image rejection/text fallback reuses the same prepared round
    expect(readUsedRecollection(char.id)).toEqual(saved);
});
it('uses the full original recall when the secondary API fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const result = await prepareCallRecollection(args());
    expect(result.char.memoryPalaceInjection).toBe('完整原召回');
    result.onDispatch();
    expect(readUsedRecollection(char.id)?.status).toBe('fallback');
});
it('does not call either recall or writer when disabled and clears stale injections locally', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    vi.mocked(injectMemoryPalace).mockClear();
    const result = await prepareCallRecollection({ ...args(), char: { ...char, memoryPalaceEnabled: false } });
    expect(injectMemoryPalace).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    expect(result.char.memoryPalaceInjection).toBe(''); expect(result.char.roomPlatesInjection).toBe('');
});
it('regeneration excludes the replaced answer and future turns without duplicating its user input', async () => {
    localStorage.clear();
    const result = await prepareCallRecollection({ ...args(), text: '问题', skipDbId: 4,
        range: { hwm: 0, messages: [msg(2), msg(3, 'user', '问题'), msg(4, 'assistant', '被替换回答'), msg(5)] } as any });
    expect(result.history.map(m => m.id)).toEqual([2, 3]);
    expect(vi.mocked(injectMemoryPalace).mock.lastCall?.[1]?.map(m => m.content)).toEqual(['消息2', '问题']);
});
it('aborting during recall prevents the writer and dispatch snapshot', async () => {
    const controller = new AbortController(); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    vi.mocked(injectMemoryPalace).mockImplementationOnce(async () => { controller.abort(); return {} as any; });
    await expect(prepareCallRecollection({ ...args(), signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled(); expect(readUsedRecollection(char.id)).toBeNull();
});
it('overlapping turns retain independent recall even when the older recall finishes last', async () => {
    localStorage.clear(); // explicit original-memory fallback
    let release!: () => void;
    vi.mocked(injectMemoryPalace).mockImplementation(async (target, messages, _hint, _name, options) => {
        const text = messages!.at(-1)!.content;
        if (text === '旧轮') await new Promise<void>(resolve => { release = resolve; });
        target.memoryPalaceInjection = text;
        options?.onMaterial?.({ originalText: text, memoryText: text, prefix: '', suffix: '', sources: [] });
        return {} as any;
    });
    const older = prepareCallRecollection({ ...args(), text: '旧轮' });
    const newer = await prepareCallRecollection({ ...args(), text: '新轮' });
    newer.onDispatch(); release();
    const old = await older;
    expect(old.char.memoryPalaceInjection).toBe('旧轮');
    expect(newer.char.memoryPalaceInjection).toBe('新轮');
    expect(readUsedRecollection(char.id)?.text).toBe('新轮');
    expect(char.memoryPalaceInjection).toBe('上一轮残留');
});
it('hangup during the secondary request aborts it without falling back into a main reply', async () => {
    const controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
        started();
        return new Promise<Response>((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true });
        });
    }));
    const pending = prepareCallRecollection({ ...args(), signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await ready; controller.abort(); await rejected;
    expect(readUsedRecollection(char.id)).toBeNull();
});
