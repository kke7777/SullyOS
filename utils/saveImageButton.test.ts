// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ toast: vi.fn(), save: vi.fn() }));
vi.mock('../context/OSContext', () => ({ useOS: () => ({ addToast: mocks.toast }) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } }));
vi.mock('./saveImage', () => ({ saveImageToDevice: mocks.save }));
import SaveImageButton from '../components/os/SaveImageButton';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => vi.clearAllMocks());
it('shows a photo-library button, blocks double taps and confirms only after saving succeeds', async () => {
    let resolve!: (result: string) => void;
    mocks.save.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const host = document.createElement('div'); const root = createRoot(host);
    try {
        await act(async () => root.render(createElement(SaveImageButton, { value: 'blobref:photo' })));
        const button = host.querySelector('button')!;
        expect(button.textContent).toContain('保存到手机相册');
        await act(async () => { button.click(); button.click(); });
        expect(mocks.save).toHaveBeenCalledTimes(1);
        expect(button.disabled).toBe(true);
        expect(mocks.toast).not.toHaveBeenCalled();
        await act(async () => resolve('saved'));
        expect(mocks.toast).toHaveBeenCalledWith('已保存到手机相册「糯米机」', 'success');
        expect(button.disabled).toBe(false);
    } finally { act(() => root.unmount()); }
});
it('reports a save error without claiming success', async () => {
    mocks.save.mockRejectedValueOnce(new Error('存储空间不足'));
    const host = document.createElement('div'); const root = createRoot(host);
    try {
        await act(async () => root.render(createElement(SaveImageButton, { value: 'blobref:photo' })));
        await act(async () => host.querySelector('button')!.click());
        expect(mocks.toast).toHaveBeenCalledWith('存储空间不足', 'error');
    } finally { act(() => root.unmount()); }
});
