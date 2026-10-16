import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { fetchImageModels } from './imageModelList';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: vi.fn(() => false) }, CapacitorHttp: { request: vi.fn() } }));
const config = { baseUrl: 'https://image.example', apiKey: ' image-only-key ' };
beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, text: async () => JSON.stringify({ data: [{ id: '[0.15]gpt-image-2.5-flare' }, { id: 'chat-model' }, null, { id: '[0.15]gpt-image-2.5-flare' }] }) })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each(['https://image.example', 'https://image.example/v1/', 'https://image.example/v1/images/generations', 'https://image.example/v1/images/edits'])('lists with image credentials from %s and preserves complete IDs', async baseUrl => {
    expect(await fetchImageModels({ ...config, baseUrl })).toEqual(['[0.15]gpt-image-2.5-flare', 'chat-model']);
    expect(fetch).toHaveBeenCalledWith('https://image.example/v1/models', expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ Authorization: 'Bearer image-only-key' }), redirect: 'error' }));
});
it('uses native HTTP on Android and accepts nested gateway lists', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(CapacitorHttp.request).mockResolvedValue({ status: 200, data: { data: { models: [{ model_name: '[0.15]gpt-image-2' }] } }, headers: {}, url: '' });
    expect(await fetchImageModels(config)).toEqual(['[0.15]gpt-image-2']);
    expect(fetch).not.toHaveBeenCalled();
    expect(CapacitorHttp.request).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', url: 'https://image.example/v1/models', headers: expect.objectContaining({ Authorization: 'Bearer image-only-key' }) }));
});
it.each([401, 403, 404, 405, 500])('reports HTTP %s without reflecting private server data', async status => {
    vi.mocked(fetch).mockResolvedValue({ status, text: async () => 'secret-key' } as Response);
    await expect(fetchImageModels(config)).rejects.toThrow(`HTTP ${status}`);
});
it.each(['<html>sign in</html>', '{}', '{"data":[]}'])('rejects invalid or empty lists: %s', async body => {
    vi.mocked(fetch).mockResolvedValue({ status: 200, text: async () => body } as Response);
    await expect(fetchImageModels(config)).rejects.toThrow(/模型列表/);
});
it('does not contact an API when URL or Key is missing', async () => {
    await expect(fetchImageModels({ ...config, apiKey: '' })).rejects.toThrow('Key');
    await expect(fetchImageModels({ ...config, baseUrl: 'not a url' })).rejects.toThrow('地址');
    expect(fetch).not.toHaveBeenCalled();
});
it('discards a late native response after credentials change', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    let resolve!: (value: any) => void;
    vi.mocked(CapacitorHttp.request).mockReturnValue(new Promise(r => { resolve = r; }));
    const controller = new AbortController();
    const pending = fetchImageModels(config, controller.signal);
    controller.abort();
    resolve({ status: 200, data: { data: [{ id: 'stale-model' }] } });
    await expect(pending).rejects.toThrow();
});
it('aborts a browser request after the list timeout', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation((_url, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
    const checked = expect(fetchImageModels(config)).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(30_000);
    await checked;
});

it.each([false, true])('loads the OpenRouter image catalog with its own key (native=%s)', async native => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(native);
    const data = { data: [{ id: 'openai/gpt-image-2.5-sunburst', name: 'OpenAI: GPT Image 2.5 Sunburst' }, { id: 'openai/gpt-image-2.5-flare' }] };
    vi.mocked(fetch).mockResolvedValue({ status: 200, text: async () => JSON.stringify(data) } as Response);
    vi.mocked(CapacitorHttp.request).mockResolvedValue({ status: 200, data, headers: {}, url: '' });
    for (const baseUrl of ['https://openrouter.ai', 'https://openrouter.ai/api/v1', 'https://openrouter.ai/api/v1/images']) {
        expect(await fetchImageModels({ apiType: 'openrouter', baseUrl, apiKey: ' or-image-key ' })).toEqual(['openai/gpt-image-2.5-sunburst', 'openai/gpt-image-2.5-flare']);
    }
    const expected = { method: 'GET', headers: expect.objectContaining({ Authorization: 'Bearer or-image-key' }) };
    if (native) {
        expect(CapacitorHttp.request).toHaveBeenCalledWith(expect.objectContaining({ ...expected, url: 'https://openrouter.ai/api/v1/images/models' }));
        expect(fetch).not.toHaveBeenCalled();
    } else {
        expect(fetch).toHaveBeenCalledWith('https://openrouter.ai/api/v1/images/models', expect.objectContaining(expected));
        expect(CapacitorHttp.request).not.toHaveBeenCalled();
    }
});
