// @vitest-environment jsdom
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import RecollectionPage from '../components/chat/RecollectionPage';
import { saveUsedRecollection } from './memoryPalace/recollectionSnapshot';
import { handleLocalBack } from './localBackHandlers';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
    localStorage.clear();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div'); document.body.append(host);
    root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); });

it('shows actual text, source names and fallback state together, and rereads persisted state after reopening', async () => {
    const onBack = vi.fn();
    const render = () => act(async () => { root.render(React.createElement(RecollectionPage, { charId: 'page-char', charName: '角色', onBack })); });
    await render();
    expect(host.textContent).toContain('还没有使用记录');
    const text = '### 记忆宫殿\n这是完整的原召回文字\n第二段也要显示';
    await act(async () => saveUsedRecollection({ charId: 'page-char', text, status: 'fallback',
        sources: [{ id: 'box-one', kind: 'event_box', name: '第一次看海' }, { id: 'node-one', kind: 'memory', name: '2026-09-01 · 原文开头' }] }));
    expect(host.textContent).toContain('整理失败，已使用召回原文');
    expect(host.textContent).toContain('第一次看海');
    expect(host.textContent).toContain('2026-09-01 · 原文开头');
    expect(host.textContent).toContain(text);
    expect(host.querySelector('time')?.textContent).toBeTruthy();
    await act(async () => root.unmount());
    root = createRoot(host); await render();
    expect(host.textContent).toContain(text);
    expect(handleLocalBack()).toBe(true);
    expect(onBack).toHaveBeenCalledTimes(1);
    await act(async () => { host.querySelector('button')!.click(); });
    expect(onBack).toHaveBeenCalledTimes(2);
});

it('separates character records and shows a new empty request instead of stale recollection', async () => {
    saveUsedRecollection({ charId: 'other-char', text: '另一角色的回忆', status: 'refined', sources: [] });
    await act(async () => root.render(React.createElement(RecollectionPage, { charId: 'page-char', charName: '角色', onBack() {} })));
    expect(host.textContent).not.toContain('另一角色的回忆');
    await act(async () => saveUsedRecollection({ charId: 'page-char', text: '', status: 'empty', sources: [] }));
    expect(host.textContent).toContain('本次没有召回记忆');
    expect(host.textContent).toContain('本次没有注入回忆文字');
});

it('shows secondary output separately from the pinned injection and reports a rejected reply', async () => {
    saveUsedRecollection({ charId: 'page-char', text: '便利贴\n真正采用的回忆', narrative: '真正采用的回忆',
        requestId: 'one', recalledText: '本次往事素材', secondaryOutput: '<private_recollection id="one">真正采用的回忆</private_recollection>',
        status: 'refined', sources: [] });
    await act(async () => root.render(React.createElement(RecollectionPage, { charId: 'page-char', charName: '角色', onBack() {} })));
    const narrativeSection = [...host.querySelectorAll('section')].find(section => section.textContent?.startsWith('副 API 整理后的回忆正文'))!;
    expect(narrativeSection.textContent).toContain('真正采用的回忆');
    expect(narrativeSection.textContent).not.toContain('便利贴');
    expect(narrativeSection.textContent).not.toContain('private_recollection');
    expect(host.textContent).toContain('交给副 API 的召回原文');
    await act(async () => saveUsedRecollection({ charId: 'page-char', text: '召回原文', requestId: 'two',
        secondaryOutput: '[角色]: 本轮主回复', fallbackReason: '副 API 返回内容未对应本轮回忆任务，已使用召回原文。', status: 'fallback', sources: [] }));
    expect(host.textContent).toContain('本轮没有采用副 API 整理正文');
    expect(host.textContent).toContain('未对应本轮回忆任务');
    const rawSection = [...host.querySelectorAll('details')].find(section => section.textContent?.startsWith('副 API 原始返回'))!;
    expect(rawSection.textContent).toContain('[角色]: 本轮主回复');
});
