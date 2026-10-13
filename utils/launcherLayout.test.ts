// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppID } from '../types';
import { DOCK_APPS, INSTALLED_APPS } from '../constants';

const state = vi.hoisted(() => ({ os: {} as any, devVisible: false, devChanged: (_value: boolean) => {} }));
vi.mock('../context/OSContext', () => ({ useOS: () => state.os, isPaperWallpaper: () => false }));
vi.mock('../utils/devDebug', () => ({
    isDevDebugAvailable: () => state.devVisible,
    subscribeDevDebugAvailability: (callback: (value: boolean) => void) => { state.devChanged = callback; return () => {}; },
}));
vi.mock('../utils/blobRef', () => ({ useBlobRefUrl: (value: string) => value }));
vi.mock('../utils/db', () => ({ DB: {
    getRecentMessagesWithCount: vi.fn(async () => ({ messages: [] })),
    getAllAnniversaries: vi.fn(async () => []),
} }));
vi.mock('../utils/dailySchedule', () => ({ getDailyScheduleForChar: vi.fn(async () => null) }));
vi.mock('../hooks/useLocalDateKey', () => ({ useLocalDateKey: () => '2026-10-13' }));
vi.mock('../utils/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../components/os/appPreload', () => ({ preloadApp: vi.fn() }));
vi.mock('../components/os/TokenImg', () => ({ default: (props: any) => React.createElement('img', { ...props, src: props.value }) }));
vi.mock('../components/os/NowPlayingSquareWidget', () => ({ default: () => React.createElement('div', { 'data-testid': 'music-widget' }) }));
vi.mock('../components/os/MobileGameHome', () => ({ default: () => React.createElement('div', { 'data-testid': 'mobilegame' }) }));
vi.mock('../components/os/TamagotchiHome', () => ({ default: () => null }));
vi.mock('../components/schedule/ScheduleHomeWidget', () => ({
    ScheduleHomeWidget: ({ onOpen }: any) => React.createElement('button', { onClick: onOpen, 'data-testid': 'schedule-widget' }, '今日日程'),
    ScheduleFullscreenViewer: ({ open, onClose }: any) => open ? React.createElement('button', { onClick: onClose, 'data-testid': 'schedule-viewer' }, '关闭日程') : null,
}));
import Launcher from '../apps/Launcher';

let host: HTMLDivElement;
let root: Root;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
    state.os = {
        openApp: vi.fn(), updateTheme: vi.fn(), characters: [{ id: 'loulou', name: '露露', avatar: '', description: '下午好' }],
        activeCharacterId: 'loulou', unreadMessages: { loulou: 12 }, isDataLoaded: false,
        theme: { skin: 'default', wallpaper: '', contentColor: '#fff' }, virtualTime: { hours: 18, minutes: 15 }, customIcons: {},
    };
    state.devVisible = false;
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390);
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
    // Restore the cover as the saved page, so tests do not share the module's last-page state.
    const scroller = host.querySelector('.launcher-pages');
    if (scroller) await act(async () => { scroller.scrollLeft = 0; scroller.dispatchEvent(new Event('scroll')); });
    await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});
const render = () => act(async () => root.render(React.createElement(Launcher)));

describe('首页布局与入口迁移', () => {
    it('第一页只保留时钟，所有应用入口各出现一次，功能页最多八个图标', async () => {
        await render();
        const cover = host.querySelector('.launcher-cover-page')!;
        expect(cover.textContent).toContain('System Online');
        expect(cover.querySelector('button')).toBeNull();
        expect(cover.querySelector('[data-launcher-item]')).toBeNull();
        expect(cover.querySelector('.launcher-bottom-content')).not.toBeNull();
        const appPages = [...host.querySelectorAll('.launcher-app-page')];
        for (const page of appPages) {
            const icons = page.querySelectorAll('[data-launcher-kind="app"]');
            expect(icons.length).toBeGreaterThan(0); expect(icons.length).toBeLessThanOrEqual(8);
            expect(page.querySelector('.launcher-bottom-content')).not.toBeNull();
        }
        const actual = [...host.querySelectorAll('[data-launcher-kind="app"]')].map(icon => icon.getAttribute('data-launcher-item'));
        const expected = INSTALLED_APPS.filter(app => app.id !== AppID.CharCreatorDev && app.id !== AppID.Schedule).map(app => app.id);
        expect(actual.sort()).toEqual(expected.sort());
        expect(host.querySelectorAll('.launcher-schedule-page button')).toHaveLength(2);
        expect(host.querySelector('.launcher-schedule-page [data-launcher-kind="app"]')).toBeNull();
        const pages = host.querySelector('.launcher-pages')!.children;
        expect(pages).toHaveLength(appPages.length + 4);
        expect(host.querySelector('[aria-hidden="true"].absolute.left-0')!.children).toHaveLength(pages.length);
    });

    it('快捷栏入口移入功能页后，保留图标样式、未读角标和点击目标', async () => {
        state.os.customIcons = { [AppID.Chat]: 'data:image/png;base64,test' };
        await render();
        for (const id of DOCK_APPS) {
            const icon = host.querySelector(`[data-launcher-item="${id}"]`)!;
            expect(icon.closest('.launcher-app-page')).not.toBeNull();
            expect(icon.querySelector('button span')?.classList.contains('hidden')).toBe(true);
            await act(async () => (icon.querySelector('button') as HTMLButtonElement).click());
            expect(state.os.openApp).toHaveBeenLastCalledWith(id);
        }
        const chat = host.querySelector(`[data-launcher-item="${AppID.Chat}"]`)!;
        expect(chat.textContent).toContain('9+');
        expect(chat.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,test');
    });

    it('日程独占一页，卡片能展开和关闭，日程应用入口可用', async () => {
        await render();
        const widget = host.querySelector('[data-testid="schedule-widget"]') as HTMLButtonElement;
        expect(widget.closest('.launcher-schedule-page')).not.toBeNull();
        await act(async () => widget.click());
        const viewer = host.querySelector('[data-testid="schedule-viewer"]') as HTMLButtonElement;
        expect(viewer).not.toBeNull();
        await act(async () => viewer.click());
        expect(host.querySelector('[data-testid="schedule-viewer"]')).toBeNull();
        const scheduleIcon = host.querySelector('.launcher-schedule-page button:last-child') as HTMLButtonElement;
        await act(async () => scheduleIcon.click());
        expect(state.os.openApp).toHaveBeenLastCalledWith(AppID.Schedule);
    });

    it('旧图标顺序和快捷栏顺序合并后不丢入口，音乐与图片仍保留', async () => {
        state.os.theme.launcherAppOrder = [AppID.Music, AppID.Character];
        state.os.theme.launcherDockOrder = [...DOCK_APPS].reverse();
        state.os.theme.launcherWidgets = { tl: 'blobref:tl', tr: 'blobref:tr', wide: 'blobref:wide', dsq: 'blobref:dsq' };
        await render();
        const icons = [...host.querySelectorAll('[data-launcher-kind="app"]')].map(icon => icon.getAttribute('data-launcher-item'));
        expect(icons.slice(0, 6)).toEqual([AppID.Music, AppID.Character, ...[...DOCK_APPS].reverse()]);
        const widgets = host.querySelector('.launcher-widgets-page')!;
        expect(widgets.querySelector('[data-testid="music-widget"]')).not.toBeNull();
        for (const slot of ['tl', 'tr', 'wide', 'dsq']) expect(widgets.querySelector(`img[src="blobref:${slot}"]`)).not.toBeNull();
        state.os.theme = { ...state.os.theme, launcherMusicVisible: false, launcherImageVisible: false };
        await render();
        expect(widgets.querySelector('[data-testid="music-widget"]')).toBeNull();
        expect(widgets.querySelector('img[src="blobref:dsq"]')).toBeNull();
        expect(widgets.querySelector('img[src="blobref:wide"]')).not.toBeNull();
    });

    it('从功能页打开应用再返回，仍停在原页，分页圆点同步', async () => {
        await render();
        const scroller = host.querySelector('.launcher-pages')!;
        await act(async () => { scroller.scrollLeft = 390 * 2; scroller.dispatchEvent(new Event('scroll')); });
        await act(async () => root.unmount()); root = createRoot(host); await render();
        expect(host.querySelector('.launcher-pages')!.scrollLeft).toBe(780);
        const dots = host.querySelector('[aria-hidden="true"].absolute.left-0')!.children;
        expect(dots[2].firstElementChild?.classList.contains('opacity-100')).toBe(true);
    });

    it('整理模式仍能交换应用、保存顺序和删除组件，同时阻止误打开应用', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('PointerEvent', MouseEvent);
        vi.stubGlobal('document', document);
        HTMLElement.prototype.setPointerCapture = vi.fn();
        document.elementFromPoint = vi.fn();
        await render();
        const icons = [...host.querySelectorAll('[data-launcher-kind="app"]')];
        const source = icons[0] as HTMLElement;
        const target = icons[1] as HTMLElement;
        const firstId = source.dataset.launcherItem;
        const secondId = target.dataset.launcherItem;
        const pointer = (type: string, x = 150) => {
            const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: 200 });
            Object.defineProperty(event, 'pointerId', { value: 1 });
            return event;
        };
        await act(async () => source.dispatchEvent(pointer('pointerdown')));
        await act(async () => vi.advanceTimersByTime(520));
        expect(host.querySelector('.launcher-editing')).not.toBeNull();
        vi.mocked(document.elementFromPoint).mockReturnValue(target);
        await act(async () => source.dispatchEvent(pointer('pointermove')));
        await act(async () => source.dispatchEvent(pointer('pointerup')));
        const order = state.os.updateTheme.mock.calls.at(-1)[0].launcherAppOrder;
        expect(order.slice(0, 2)).toEqual([secondId, firstId]);
        await act(async () => vi.advanceTimersByTime(800));
        await act(async () => (source.querySelector('button') as HTMLButtonElement).click());
        expect(state.os.openApp).not.toHaveBeenCalled();
        const remove = host.querySelector('[aria-label="删除音乐组件"]') as HTMLButtonElement;
        await act(async () => remove.click());
        expect(state.os.updateTheme).toHaveBeenLastCalledWith({ launcherMusicVisible: false });
        await act(async () => (host.querySelector('.launcher-editing > div button') as HTMLButtonElement).click());
        expect(host.querySelector('.launcher-editing')).toBeNull();
    });

    it('开发入口仍受开关控制，独立主题仍使用原首页', async () => {
        await render();
        expect(host.querySelector(`[data-launcher-item="${AppID.CharCreatorDev}"]`)).toBeNull();
        await act(async () => state.devChanged(true));
        expect(host.querySelector(`[data-launcher-item="${AppID.CharCreatorDev}"]`)).not.toBeNull();
        state.os.theme.skin = 'mobilegame'; await render();
        expect(host.querySelector('[data-testid="mobilegame"]')).not.toBeNull();
        expect(host.querySelector('.launcher-pages')).toBeNull();
    });
});
