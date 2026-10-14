// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
    isNative: true,
    platform: 'android',
    getInsets: vi.fn(),
    setDarkIcons: vi.fn(),
    addListener: vi.fn(),
    remove: vi.fn(),
    insetsChanged: undefined as undefined | ((insets: { top: number }) => void),
}));
vi.mock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => native.isNative, getPlatform: () => native.platform },
    registerPlugin: () => native,
}));
import { installAndroidSystemBars, useDarkStatusBarIcons } from './androidSystemBars';

let cleanup: (() => void) | undefined;
let surface: HTMLDivElement;
beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    native.isNative = true;
    native.platform = 'android';
    native.getInsets.mockResolvedValue({ top: 32 });
    native.setDarkIcons.mockResolvedValue(undefined);
    native.addListener.mockImplementation(async (_event, handler) => {
        native.insetsChanged = handler;
        return { remove: native.remove };
    });
    document.body.innerHTML = '<div id="surface" style="background-color:white"></div><div id="messages"></div>';
    surface = document.getElementById('surface') as HTMLDivElement;
    surface.getBoundingClientRect = () => ({ top: 0, bottom: 160, left: 0, right: 400, width: 400, height: 160 }) as DOMRect;
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [surface] });
});
afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    vi.useRealTimers();
});

describe('Android system bar', () => {
    it('leaves browsers and iOS alone', () => {
        native.isNative = false;
        cleanup = installAndroidSystemBars();
        expect(native.getInsets).not.toHaveBeenCalled();
        native.isNative = true;
        native.platform = 'ios';
        cleanup = installAndroidSystemBars();
        expect(native.addListener).not.toHaveBeenCalled();
        expect(document.documentElement.hasAttribute('data-android-system-bars')).toBe(false);
    });

    it('uses real device insets, updates rotation and chooses icons for changing headers', async () => {
        cleanup = installAndroidSystemBars();
        await vi.advanceTimersByTimeAsync(160);
        expect(document.documentElement.style.getPropertyValue('--native-safe-area-top')).toBe('32px');
        expect(native.setDarkIcons).toHaveBeenLastCalledWith({ dark: true });
        native.insetsChanged!({ top: 24 });
        surface.style.backgroundColor = '#0f172a';
        await vi.advanceTimersByTimeAsync(160);
        expect(document.documentElement.style.getPropertyValue('--native-safe-area-top')).toBe('24px');
        expect(native.setDarkIcons).toHaveBeenLastCalledWith({ dark: false });
        // No fabricated minimum on a device/window with zero top intrusion.
        native.insetsChanged!({ top: 0 });
        await vi.advanceTimersByTimeAsync(160);
        expect(document.documentElement.style.getPropertyValue('--native-safe-area-top')).toBe('0px');
    });

    it('does not perform bridge writes while messages stream below the header', async () => {
        cleanup = installAndroidSystemBars();
        await vi.advanceTimersByTimeAsync(160);
        const calls = native.setDarkIcons.mock.calls.length;
        const messages = document.getElementById('messages')!;
        messages.getBoundingClientRect = () => ({ top: 160, bottom: 800 }) as DOMRect;
        messages.textContent = '宝贝';
        messages.append(document.createElement('span'));
        await vi.advanceTimersByTimeAsync(160);
        expect(native.setDarkIcons).toHaveBeenCalledTimes(calls);
    });

    it('rejects a stale wallpaper sample after navigating to a dark header', async () => {
        let image: any;
        vi.stubGlobal('Image', class {
            onload: (() => void) | null = null;
            onerror = null;
            naturalWidth = 400;
            naturalHeight = 800;
            constructor() { image = this; }
        });
        const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
            drawImage: vi.fn(),
            getImageData: () => ({ data: new Uint8ClampedArray(Array(8).fill([255, 255, 255, 255]).flat()) }),
        } as any);
        surface.style.backgroundImage = 'url("https://example.com/wallpaper.png")';
        cleanup = installAndroidSystemBars();
        await vi.advanceTimersByTimeAsync(160);
        expect(image).toBeDefined();
        surface.style.backgroundImage = 'none';
        surface.style.backgroundColor = '#0f172a';
        await vi.advanceTimersByTimeAsync(160);
        expect(native.setDarkIcons).toHaveBeenLastCalledWith({ dark: false });
        image.onload();
        await vi.advanceTimersByTimeAsync(160);
        expect(native.setDarkIcons).toHaveBeenCalledTimes(1);
        getContext.mockRestore();
        vi.unstubAllGlobals();
    });

    it('cleans listeners and ignores a late initial inset read after disposal', async () => {
        let resolve!: (value: { top: number }) => void;
        native.getInsets.mockReturnValue(new Promise(done => { resolve = done; }));
        cleanup = installAndroidSystemBars();
        await vi.advanceTimersByTimeAsync(1);
        cleanup();
        resolve({ top: 44 });
        await vi.advanceTimersByTimeAsync(160);
        expect(native.remove).toHaveBeenCalledOnce();
        expect(document.documentElement.style.getPropertyValue('--native-safe-area-top')).toBe('');
        expect(native.setDarkIcons).not.toHaveBeenCalled();
        cleanup = undefined;
    });

    it('uses readable contrast across light, midtone and dark backgrounds', () => {
        expect(useDarkStatusBarIcons('#fff')).toBe(true);
        expect(useDarkStatusBarIcons('#888')).toBe(true);
        expect(useDarkStatusBarIcons('#000')).toBe(false);
        expect(useDarkStatusBarIcons('#0f172a')).toBe(false);
    });
});
