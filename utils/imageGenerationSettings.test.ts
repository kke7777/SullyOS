// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';
import ImageGenerationSettings from '../components/chat/ImageGenerationSettings';
import { DEFAULT_IMAGE_CONFIG } from './imageGeneration';
const state = vi.hoisted(() => ({ value: {} as any }));
vi.mock('../context/OSContext', () => ({ useOS: () => state.value }));
vi.mock('../components/os/TokenImg', () => ({ default: ({ value, ...props }: any) => createElement('img', { ...props, src: value }) }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { state.value = { apiConfig: { imageGeneration: { ...DEFAULT_IMAGE_CONFIG, apiKey: 'demo-key', references: [
    { id: 'r1', name: '露露', imageRef: 'data:image/png;base64,AAAA', description: '仅参考五官' },
] } }, characters: [{ id: 'c1', chatImageGenerationEnabled: false }], updateApiConfig: vi.fn(), updateCharacter: vi.fn(), addToast: vi.fn() }; });
it('saves the per-chat toggle alongside the shared API settings without changing the model prefix', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    try {
        await act(async () => root.render(createElement(ImageGenerationSettings, { charId: 'c1' })));
        expect(host.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
        expect(host.querySelectorAll('select')).toHaveLength(2);
        await act(async () => (host.querySelector('input[type=checkbox]') as HTMLInputElement).click());
        expect(state.value.updateCharacter).not.toHaveBeenCalled();
        await act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === '保存设置')!.click());
        expect(state.value.updateCharacter).toHaveBeenCalledWith('c1', { chatImageGenerationEnabled: true });
        expect(state.value.updateApiConfig).toHaveBeenCalledWith({ imageGeneration: expect.objectContaining({ model: '[0.15]gpt-image-2.5-sunburst', size: '1024x1024', references: expect.arrayContaining([expect.objectContaining({ name: '露露' })]) }) });
    } finally { act(() => root.unmount()); host.remove(); }
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
