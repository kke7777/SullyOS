// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { getBlobForRef, resolveRefToDataUrl } from './blobRef';
import { createImageGenerationSession, DEFAULT_IMAGE_CONFIG, generateImage, imageEndpoint, normalizeImageConfig, prepareImageGenerationContext } from './imageGeneration';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF9sAAAAASUVORK5CYII=';
const dataUrl = `data:image/png;base64,${png}`;
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: vi.fn(() => false) }, CapacitorHttp: { request: vi.fn() } }));
vi.mock('./blobRef', () => ({
    isBlobRef: (ref: string) => ref.startsWith('blobref:'),
    resolveRefToDataUrl: vi.fn(), getBlobForRef: vi.fn(),
    blobToDataUrl: vi.fn(async () => `data:image/png;base64,${png}`),
    dataUrlToBlob: (url: string) => new Blob([atob(url.split(',')[1])], { type: url.slice(5, url.indexOf(';')) }),
}));
const config = () => ({ ...DEFAULT_IMAGE_CONFIG, apiKey: 'private-key', references: [
    { id: 'loulou', name: '露露', description: '仅参考五官', imageRef: 'blobref:loulou' },
    { id: 'saki', name: '咲咲', description: '仅参考长相', imageRef: 'blobref:saki' },
] });
beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(resolveRefToDataUrl).mockResolvedValue(dataUrl);
    vi.mocked(getBlobForRef).mockResolvedValue(new Blob(['original-image-bytes'], { type: 'image/png' }));
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, json: async () => ({ data: [{ b64_json: png }], usage: { cost: 0.12 } }) })));
});
afterEach(() => vi.unstubAllGlobals());

it('disabled feature does not load any reference or expose a guide', async () => {
    expect(await prepareImageGenerationContext(false, config())).toBeNull();
    expect(resolveRefToDataUrl).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
});
it('enabled feature labels each original reference and preserves the model prefix', async () => {
    const result = await prepareImageGenerationContext(true, config());
    expect(result?.config.model).toBe('[0.15]gpt-image-2.5-sunburst');
    expect(result?.referenceMessage?.content.filter((p: any) => p.type === 'image_url')).toHaveLength(2);
    expect(JSON.stringify(result?.referenceMessage)).toContain('露露');
    expect(JSON.stringify(result?.referenceMessage)).toContain('咲咲');
});
it.each(['https://example.test', 'https://example.test/v1/', 'https://example.test/v1/images/generations'])('normalizes the standard endpoint: %s', root => {
    expect(imageEndpoint(root, true)).toBe('https://example.test/v1/images/edits');
});
it.each(['medium', 'xhigh'] as const)('sends a single text-only JSON request with saved %s quality', async quality => {
    const result = await generateImage({ ...config(), quality }, { prompt: '戴帽子的猫', reference_ids: [] });
    const [url, init] = vi.mocked(fetch).mock.calls[0] as any;
    expect(url).toBe('https://api.sunflowerllm.com/v1/images/generations');
    expect(JSON.parse(init.body)).toMatchObject({ model: config().model, size: '1024x1024', quality, n: 1, stream: false });
    expect(result.blob.type).toBe('image/png'); expect(result.costUsd).toBe(0.12);
});
it('sends both original images through multipart edits in selected order, including the identity legend', async () => {
    await generateImage({ ...config(), quality: 'xhigh' }, { prompt: '两人拥抱', reference_ids: ['saki', 'loulou'] });
    const [url, init] = vi.mocked(fetch).mock.calls[0] as any;
    expect(url.endsWith('/v1/images/edits')).toBe(true);
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(init.body.getAll('image[]')).toHaveLength(2);
    expect(init.body.get('prompt')).toContain('参考图1：咲咲');
    expect(init.body.get('prompt')).toContain('参考图2：露露');
    expect(init.body.get('model')).toBe(config().model);
    expect(init.body.get('quality')).toBe('xhigh');
});
it('does not send a paid request when a selected reference is unknown or missing', async () => {
    await expect(generateImage(config(), { prompt: '合照', reference_ids: ['unknown'] })).rejects.toThrow('未保存');
    vi.mocked(getBlobForRef).mockResolvedValue(null);
    await expect(generateImage(config(), { prompt: '合照', reference_ids: ['loulou'] })).rejects.toThrow('不可用');
    expect(fetch).not.toHaveBeenCalled();
});
it('never retries a failed image edit as text generation and redacts credentials from errors', async () => {
    vi.mocked(fetch).mockResolvedValue({ status: 404, json: async () => ({ error: { message: 'private-key not found' } }) } as any);
    await expect(generateImage(config(), { prompt: '合照', reference_ids: ['loulou', 'saki'] })).rejects.toThrow('标准带图接口');
    expect(fetch).toHaveBeenCalledTimes(1);
    const session = createImageGenerationSession(config(), vi.fn());
    const failure = await session({ prompt: '合照', reference_ids: [] });
    expect(failure).not.toContain('private-key');
});
it('prevents duplicate paid attempts within a reply, including after an upstream failure', async () => {
    const save = vi.fn(); const run = createImageGenerationSession(config(), save);
    const args = { prompt: '合照', reference_ids: [] };
    await Promise.all([run(args), run(args)]);
    expect(fetch).toHaveBeenCalledTimes(1); expect(save).toHaveBeenCalledTimes(1);
    vi.mocked(fetch).mockRejectedValueOnce(new Error('connection lost'));
    const failedRun = createImageGenerationSession(config(), save);
    await failedRun(args); await failedRun(args);
    expect(fetch).toHaveBeenCalledTimes(2);
});
it('does not publish a late image after cancellation', async () => {
    const controller = new AbortController(); const save = vi.fn();
    vi.mocked(fetch).mockImplementationOnce(async () => { controller.abort(); return { status: 200, json: async () => ({ data: [{ b64_json: png }] }) } as any; });
    const run = createImageGenerationSession(config(), save, controller.signal);
    await expect(run({ prompt: '合照', reference_ids: [] })).rejects.toMatchObject({ name: 'AbortError' });
    expect(save).not.toHaveBeenCalled();
});
it('uses the native Android multipart serialization with both files, preserving Unicode', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(CapacitorHttp.request).mockResolvedValue({ status: 200, data: { data: [{ b64_json: png }] }, headers: {}, url: '' });
    await generateImage(config(), { prompt: '露露抱着咲咲', reference_ids: ['loulou', 'saki'] });
    const req = vi.mocked(CapacitorHttp.request).mock.calls[0][0];
    expect(req.dataType).toBe('formData');
    expect(req.headers?.['Content-Type']).toContain('boundary=Nuomi');
    expect(req.data.filter((e: any) => e.type === 'base64File')).toHaveLength(2);
    expect(req.data.find((e: any) => e.key === 'prompt').value).toContain('露露抱着咲咲');
    expect(fetch).not.toHaveBeenCalled();
});

it('keeps older saved configurations on the compatible protocol', () => {
    const { apiType, ...legacy } = config();
    expect(normalizeImageConfig(legacy)).toMatchObject({ apiType: 'openai', baseUrl: legacy.baseUrl, model: legacy.model });
    expect(normalizeImageConfig({ apiType: 'openrouter' })).toMatchObject({ baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-image-2.5-sunburst' });
});
it.each(['https://openrouter.ai', 'https://openrouter.ai/api/', 'https://openrouter.ai/api/v1/', 'https://openrouter.ai/api/v1/images', 'https://openrouter.ai/api/v1/images/models'])('normalizes OpenRouter domain and endpoint addresses: %s', baseUrl => {
    expect(imageEndpoint(baseUrl, false, 'openrouter')).toBe('https://openrouter.ai/api/v1/images');
    expect(imageEndpoint(baseUrl, true, 'openrouter')).toBe('https://openrouter.ai/api/v1/images');
});
it.each([false, true])('generates through OpenRouter JSON with and without references (native=%s)', async native => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(native);
    vi.mocked(CapacitorHttp.request).mockResolvedValue({ status: 200, data: { data: [{ b64_json: png, media_type: 'image/png' }], usage: { cost: 0.25 } }, headers: {}, url: '' });
    vi.mocked(getBlobForRef).mockImplementation(async ref => new Blob([ref], { type: 'image/png' }));
    vi.mocked((await import('./blobRef')).blobToDataUrl).mockImplementation(async blob => `data:image/png;base64,${btoa(await blob.text())}`);
    const openrouter = { ...config(), apiType: 'openrouter' as const, baseUrl: 'https://openrouter.ai', model: 'openai/gpt-image-2.5-sunburst', quality: 'xhigh' as const };
    for (const reference_ids of [[], ['saki', 'loulou']]) {
        const result = await generateImage(openrouter, { prompt: '露露抱着咲咲', reference_ids });
        const req = native ? vi.mocked(CapacitorHttp.request).mock.calls.at(-1)![0] : null;
        const [url, init] = native ? [req!.url, req] : vi.mocked(fetch).mock.calls.at(-1)! as any;
        expect(url).toBe('https://openrouter.ai/api/v1/images');
        expect(init.headers['Content-Type']).toBe('application/json');
        expect(init.dataType).toBeUndefined();
        const body = native ? req!.data : JSON.parse(init.body);
        expect(body).toMatchObject({ model: openrouter.model, quality: 'xhigh', n: 1, stream: false, size: '1024x1024' });
        if (reference_ids.length) {
            expect(body.input_references.map((r: any) => atob(r.image_url.url.split(',')[1]))).toEqual(['blobref:saki', 'blobref:loulou']);
            expect(body.prompt).toContain('参考图1：咲咲。仅参考长相');
            expect(body.prompt).toContain('参考图2：露露。仅参考五官');
        } else expect(body.input_references).toBeUndefined();
        expect(result.blob.type).toBe('image/png');
        expect(result.costUsd).toBe(native ? 0.25 : 0.12);
    }
    expect(native ? CapacitorHttp.request : fetch).toHaveBeenCalledTimes(2);
    expect(native ? fetch : CapacitorHttp.request).not.toHaveBeenCalled();
});
it('does not retry OpenRouter errors or describe its endpoint as OpenAI edits', async () => {
    vi.mocked(fetch).mockResolvedValue({ status: 404, json: async () => ({ error: { message: 'private-key model unavailable' } }) } as any);
    const save = vi.fn();
    const run = createImageGenerationSession({ ...config(), apiType: 'openrouter', baseUrl: 'https://openrouter.ai', model: 'openai/gpt-image-2.5-sunburst' }, save);
    const result = await run({ prompt: '合照', reference_ids: ['loulou'] });
    expect(result).toContain('本轮不自动重试');
    expect(result).not.toContain('private-key');
    expect(result).not.toContain('/images/edits');
    await run({ prompt: '合照', reference_ids: ['loulou'] });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
});
