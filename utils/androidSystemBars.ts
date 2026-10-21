import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { parseStatusBarColor, readStatusBarSurfaceColor, type StatusBarColor } from './iosStatusBarEdge';

type Insets = { top: number };
interface NativeSystemBarsPlugin {
    getInsets(): Promise<Insets>;
    setDarkIcons(options: { dark: boolean }): Promise<void>;
    addListener(event: 'insetsChanged', listener: (insets: Insets) => void): Promise<PluginListenerHandle>;
}
const bars = registerPlugin<NativeSystemBarsPlugin>('NativeSystemBars');

/** Choose whichever of black/white offers more contrast with the visible surface. */
export const useDarkStatusBarIcons = (color: string): boolean => {
    const rgb = parseStatusBarColor(color);
    if (!rgb) return false;
    const linear = rgb.slice(0, 3).map(channel => {
        const value = Math.min(255, Math.max(0, channel)) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    return luminance > 0.179;
};

export const installAndroidSystemBars = (): (() => void) => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return () => {};
    const root = document.documentElement;
    if (root.hasAttribute('data-android-system-bars')) return () => {};
    root.setAttribute('data-android-system-bars', '');
    const imageColors = new Map<string, Promise<StatusBarColor | null>>();
    let disposed = false;
    let listener: PluginListenerHandle | undefined;
    let timer: number | undefined;
    let revision = 0;
    let lastDark: boolean | undefined;

    const update = async (current: number) => {
        const color = await readStatusBarSurfaceColor(imageColors);
        if (disposed || current !== revision) return;
        const dark = useDarkStatusBarIcons(color);
        if (dark === lastDark) return;
        try {
            await bars.setDarkIcons({ dark });
            if (!disposed) lastDark = dark;
        } catch (error) { console.warn('状态栏图标颜色暂未更新', error); }
    };
    const schedule = () => {
        revision++;
        if (timer !== undefined || disposed) return;
        timer = window.setTimeout(() => { timer = undefined; void update(revision); }, 80);
    };
    const applyInsets = ({ top }: Insets) => {
        if (disposed || !Number.isFinite(top)) return;
        const value = `${Math.max(0, top)}px`;
        if (root.style.getPropertyValue('--native-safe-area-top') !== value) {
            root.style.setProperty('--native-safe-area-top', value);
        }
        schedule();
    };
    // Subscribe first, then read the current value: cold starts cannot miss insets.
    void (async () => {
        try {
            const handle = await bars.addListener('insetsChanged', applyInsets);
            if (disposed) { await handle.remove(); return; }
            listener = handle;
            applyInsets(await bars.getInsets());
        } catch (error) { console.warn('系统状态栏安全区暂未读取', error); }
    })();

    const touchesTop = (node: Node) => {
        if (!(node instanceof Element)) return false;
        if (node === root || node === document.body || document.head.contains(node)) return true;
        const bounds = node.getBoundingClientRect();
        return bounds.top <= 1 && bounds.bottom >= 1;
    };
    const observer = new MutationObserver(records => {
        // Message streaming does not change status-bar contrast.
        if (records.some(record => touchesTop(record.target) && (
            record.type === 'attributes' || record.target instanceof HTMLStyleElement ||
            [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element)
        ))) schedule();
    });
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    const events = ['pageshow', 'resize', 'orientationchange'];
    for (const event of events) window.addEventListener(event, schedule);
    const visible = () => { if (document.visibilityState === 'visible') schedule(); };
    document.addEventListener('visibilitychange', visible);
    document.addEventListener('transitionend', schedule, true);
    document.addEventListener('animationend', schedule, true);
    document.addEventListener('load', schedule, true);
    schedule();

    return () => {
        disposed = true;
        revision++;
        if (timer !== undefined) clearTimeout(timer);
        observer.disconnect();
        void listener?.remove();
        for (const event of events) window.removeEventListener(event, schedule);
        document.removeEventListener('visibilitychange', visible);
        document.removeEventListener('transitionend', schedule, true);
        document.removeEventListener('animationend', schedule, true);
        document.removeEventListener('load', schedule, true);
        imageColors.clear();
        root.style.removeProperty('--native-safe-area-top');
        root.removeAttribute('data-android-system-bars');
    };
};
