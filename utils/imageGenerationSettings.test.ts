// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';
import ImageGenerationSettings from '../components/chat/ImageGenerationSettings';
import { DEFAULT_IMAGE_CONFIG } from './imageGeneration';
import { fetchImageModels } from './imageModelList';
const state = vi.hoisted(() => ({ value: {} as any }));
vi.mock('../context/OSContext', () => ({ useOS: () => state.value }));
vi.mock('./imageModelList', () => ({ fetchImageModels: vi.fn() }));
vi.mock('../components/os/TokenImg', () => ({ default: ({ value, ...props }: any) => createElement('img', { ...props, src: value }) }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { vi.clearAllMocks(); state.value = { apiConfig: { imageGeneration: { ...DEFAULT_IMAGE_CONFIG, apiKey: 'demo-key', references: [
    { id: 'r1', name: '露露', imageRef: 'data:image/png;base64,AAAA', description: '仅参考五官' },
] } }, characters: [{ id: 'c1', chatImageGenerationEnabled: false }], updateApiConfig: vi.fn(), updateCharacter: vi.fn(), addToast: vi.fn() }; });
it('saves the per-chat toggle alongside the shared API settings without changing the model prefix', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    try {
        await act(async () => root.render(createElement(ImageGenerationSettings, { charId: 'c1' })));
        expect(host.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
        expect(host.querySelectorAll('select')).toHaveLength(3);
        expect(host.querySelector('select[aria-label="生图质量"] option[value="xhigh"]')?.textContent).toContain('超高');
        await act(async () => (host.querySelector('input[type=checkbox]') as HTMLInputElement).click());
        expect(state.value.updateCharacter).not.toHaveBeenCalled();
        await act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === '保存设置')!.click());
        expect(state.value.updateCharacter).toHaveBeenCalledWith('c1', { chatImageGenerationEnabled: true });
        expect(state.value.updateApiConfig).toHaveBeenCalledWith({ imageGeneration: expect.objectContaining({ model: '[0.15]gpt-image-2.5-sunburst', size: '1024x1024', references: expect.arrayContaining([expect.objectContaining({ name: '露露' })]) }) });
    } finally { act(() => root.unmount()); host.remove(); }
});

const inputValue = (input: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
};
it('fetches, searches, and fills the selected complete model ID, then persists it on save', async () => {
    vi.mocked(fetchImageModels).mockResolvedValue(['[0.15]gpt-image-2.5-flare', 'chat-model']);
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    try {
        await act(async () => root.render(createElement(ImageGenerationSettings)));
        await act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === '拉取模型')!.click());
        expect(fetchImageModels).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'demo-key', baseUrl: DEFAULT_IMAGE_CONFIG.baseUrl }), expect.any(AbortSignal));
        expect((host.querySelector('[aria-label="生图模型"]') as HTMLInputElement).value).toBe(DEFAULT_IMAGE_CONFIG.model);
        await act(async () => inputValue(host.querySelector('input[placeholder*="搜索"]')!, 'flare'));
        expect(Array.from(host.querySelectorAll('button')).some(b => b.title === 'chat-model')).toBe(false);
        await act(async () => host.querySelector<HTMLButtonElement>('button[title="[0.15]gpt-image-2.5-flare"]')!.click());
        expect((host.querySelector('[aria-label="生图模型"]') as HTMLInputElement).value).toBe('[0.15]gpt-image-2.5-flare');
        expect(state.value.updateApiConfig).not.toHaveBeenCalled();
        await act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === '保存设置')!.click());
        expect(state.value.updateApiConfig).toHaveBeenCalledWith({ imageGeneration: expect.objectContaining({ model: '[0.15]gpt-image-2.5-flare' }) });
    } finally { act(() => root.unmount()); host.remove(); }
});
it('retains the current model and manual entry when fetching fails', async () => {
    vi.mocked(fetchImageModels).mockRejectedValue(new Error('渠道未提供模型列表（HTTP 404）'));
    const host = document.createElement('div'); const root = createRoot(host);
    try {
        await act(async () => root.render(createElement(ImageGenerationSettings)));
        await act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === '拉取模型')!.click());
        expect(host.querySelector('[role=alert]')?.textContent).toContain('404');
        expect((host.querySelector('[aria-label="生图模型"]') as HTMLInputElement).value).toBe(DEFAULT_IMAGE_CONFIG.model);
        await act(async () => inputValue(host.querySelector('[aria-label="生图模型"]')!, '[custom]image'));
        expect((host.querySelector('[aria-label="生图模型"]') as HTMLInputElement).value).toBe('[custom]image');
    } finally { act(() => root.unmount()); }
});
it('clears old lists and ignores an in-flight response when the image credentials change', async () => {
    let resolve!: (models: string[]) => void;
    vi.mocked(fetchImageModels).mockResolvedValueOnce(['old-model']).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const host = document.createElement('div'); const root = createRoot(host);
    try {
        await act(async () => root.render(createElement(ImageGenerationSettings)));
        await act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === '拉取模型')!.click());
        expect(host.querySelector('button[title="old-model"]')).not.toBeNull();
        await act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === '刷新模型列表')!.click());
        await act(async () => inputValue(host.querySelector('[aria-label="生图 API Key"]')!, 'new-key'));
        expect(vi.mocked(fetchImageModels).mock.calls[1][1]?.aborted).toBe(true);
        await act(async () => resolve(['stale-model']));
        expect(host.querySelector('button[title="old-model"]')).toBeNull();
        expect(host.querySelector('button[title="stale-model"]')).toBeNull();
        expect((host.querySelector('[aria-label="生图模型"]') as HTMLInputElement).value).toBe(DEFAULT_IMAGE_CONFIG.model);
    } finally { act(() => root.unmount()); }
});
it('keeps reference removal in the draft until save, and rejects enabling with a missing key', async () => {
    state.value.apiConfig.imageGeneration.apiKey = '';
    const host = document.createElement('div'); const root = createRoot(host);
    try {
        await act(async () => root.render(createElement(ImageGenerationSettings, { charId: 'c1' })));
        await act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === '移除')!.click());
        expect(state.value.apiConfig.imageGeneration.references).toHaveLength(1);
        expect(state.value.updateApiConfig).not.toHaveBeenCalled();
        await act(async () => (host.querySelector('input[type=checkbox]') as HTMLInputElement).click());
        await act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === '保存设置')!.click());
        expect(host.querySelector('[role=alert]')?.textContent).toContain('Key');
        expect(state.value.updateCharacter).not.toHaveBeenCalled();
        expect(state.value.updateApiConfig).not.toHaveBeenCalled();
    } finally { act(() => root.unmount()); }
});

it('switches to OpenRouter, rejects the old list, selects a fetched image model, saves and restores it', async () => {
    let resolve!: (models: string[]) => void;
    vi.mocked(fetchImageModels).mockImplementationOnce(() => new Promise(r => { resolve = r; }))
        .mockResolvedValueOnce(['openai/gpt-image-2.5-sunburst', 'openai/gpt-image-2.5-flare']);
    const host = document.createElement('div'); document.body.append(host); let root = createRoot(host);
    const click = (text: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent === text)!.click();
    try {
        await act(async () => root.render(createElement(ImageGenerationSettings)));
        await act(async () => click('拉取模型'));
        await act(async () => {
            const select = host.querySelector<HTMLSelectElement>('[aria-label="生图接口类型"]')!;
            select.value = 'openrouter'; select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        expect(vi.mocked(fetchImageModels).mock.calls[0][1]?.aborted).toBe(true);
        await act(async () => resolve(['stale-channel-model']));
        expect(host.querySelector('button[title="stale-channel-model"]')).toBeNull();
        expect(host.querySelector<HTMLInputElement>('[aria-label="生图 API 地址"]')!.value).toBe('https://openrouter.ai/api/v1');
        expect(host.querySelector<HTMLInputElement>('[aria-label="生图 API Key"]')!.value).toBe('');
        expect(host.querySelector('img')).not.toBeNull();
        await act(async () => inputValue(host.querySelector('[aria-label="生图 API Key"]')!, 'openrouter-key'));
        await act(async () => click('拉取模型'));
        expect(fetchImageModels).toHaveBeenLastCalledWith(expect.objectContaining({ apiType: 'openrouter', apiKey: 'openrouter-key' }), expect.any(AbortSignal));
        await act(async () => inputValue(host.querySelector('input[placeholder*="搜索"]')!, 'flare'));
        expect(host.querySelector('button[title="openai/gpt-image-2.5-sunburst"]')).toBeNull();
        await act(async () => host.querySelector<HTMLButtonElement>('button[title="openai/gpt-image-2.5-flare"]')!.click());
        await act(async () => click('保存设置'));
        const saved = state.value.updateApiConfig.mock.calls[0][0].imageGeneration;
        expect(saved).toMatchObject({ apiType: 'openrouter', apiKey: 'openrouter-key', model: 'openai/gpt-image-2.5-flare', size: '1024x1024', references: [expect.objectContaining({ id: 'r1' })] });
        state.value.apiConfig.imageGeneration = saved;
        act(() => root.unmount()); root = createRoot(host);
        await act(async () => root.render(createElement(ImageGenerationSettings)));
        expect(host.querySelector<HTMLSelectElement>('[aria-label="生图接口类型"]')!.value).toBe('openrouter');
        expect(host.querySelector<HTMLInputElement>('[aria-label="生图模型"]')!.value).toBe('openai/gpt-image-2.5-flare');
    } finally { act(() => root.unmount()); host.remove(); }
});
