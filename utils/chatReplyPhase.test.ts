// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useChatAI } from '../hooks/useChatAI';
import ChatReplyStatus from '../components/chat/ChatReplyStatus';
import * as payloads from './chatRequestPayload';
import * as api from './safeApi';
import * as inbox from './activeMsgRuntime';
import * as instant from './amsgInstantChat';
import { KeepAlive } from './keepAlive';
import { stopReplyRuns } from './chatReplyCancellation';
import { DB } from './db';

vi.mock('../context/MusicContext', () => ({ useMusic: () => ({}), loadMusicHooks: () => null }));
vi.mock('./keepAlive', () => ({ KeepAlive: { start: vi.fn(), stop: vi.fn() } }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, current: ReturnType<typeof useChatAI>;
const charId = 'reply-phase-ui';
function Probe({ id = charId, enabled = true }: { id?: string; enabled?: boolean }) {
    current = useChatAI({
        char: { id, name: '露易丝', memoryPalaceEnabled: enabled, contextRangeMode: 'manual', contextLimit: 50 } as any,
        userProfile: { name: '咲咲' } as any, apiConfig: { baseUrl: 'https://main.test/v1', model: 'qa' },
        groups: [], emojis: [], categories: [], realtimeConfig: {} as any,
        addToast: vi.fn(), setMessages: vi.fn(), updateCharacter: vi.fn(), updateUserProfile: vi.fn(),
    });
    return current.replyPhase ? React.createElement(ChatReplyStatus, { characterName: '露易丝', phase: current.replyPhase }) : null;
}
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
beforeEach(async () => {
    localStorage.clear();
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    vi.mocked(KeepAlive.start).mockResolvedValue(undefined);
    vi.spyOn(inbox, 'prepareInboxBeforeChat').mockResolvedValue('done' as any);
    await DB.clearMessages(charId);
    await DB.saveMessage({ charId, role: 'user', type: 'text', content: '还记得那次看海吗？' });
});
afterEach(async () => {
    await act(async () => { stopReplyRuns(charId); root.unmount(); }); host.remove(); vi.restoreAllMocks(); localStorage.clear();
});

it.each([{ enabled: true, cloud: false }, { enabled: false, cloud: false }, { enabled: true, cloud: true }])('follows actual memory completion and main dispatch, restores on reentry, and clears on stop (%j)', async ({ enabled, cloud }) => {
    const memory = deferred(), started = deferred(), sent = deferred();
    vi.spyOn(payloads, 'buildChatRequestPayload').mockImplementation(async input => {
        input.onPreparationStage?.({ stage: 'memory', status: 'start' });
        started.resolve();
        await memory.promise;
        input.onPreparationStage?.({ stage: 'memory', status: 'end', ms: 1 });
        const messages = [{ role: 'user', content: '还记得那次看海吗？' }];
        return { systemPrompt: '', cleanedApiMessages: messages, fullMessages: messages, flags: { promptBuildSkipped: true } } as any;
    });
    vi.spyOn(api, 'safeFetchJson').mockImplementation(async (...args) => {
        args[6]?.(); sent.resolve();
        return new Promise(() => {});
    });
    vi.spyOn(instant, 'resolveInstantChatReadiness').mockResolvedValue({ ready: cloud } as any);
    vi.spyOn(instant, 'sendInstantChatTurn').mockImplementation(async input => {
        input.onDispatch?.(); sent.resolve();
        return new Promise(() => {});
    });
    await act(async () => { root.render(React.createElement(Probe, { enabled })); });
    let pending!: Promise<void>;
    await act(async () => { pending = current.triggerAI([]); await started.promise; });
    expect(current.replyPhase).toBe(enabled ? 'recollecting' : 'preparing');
    expect(host.textContent).toBe(enabled ? '露易丝在回忆ing' : '');
    // The original async request continues while the Chat view is unmounted.
    await act(async () => root.unmount()); root = createRoot(host);
    await act(async () => root.render(React.createElement(Probe, { id: 'another-character' })));
    expect(current.replyPhase).toBeNull();
    expect(host.textContent).toBe('');
    await act(async () => root.render(React.createElement(Probe, { enabled })));
    expect(current.replyPhase).toBe(enabled ? 'recollecting' : 'preparing');
    await act(async () => { memory.resolve(); await sent.promise; });
    expect(current.replyPhase).toBe('replying');
    expect(host.textContent).toBe('露露打字ing');
    await act(async () => { stopReplyRuns(charId); await pending; });
    expect(current.replyPhase).toBeNull();
    expect(host.textContent).toBe('');
});

it('clears the memory label immediately on stop and ignores a late preparation callback', async () => {
    const memory = deferred(), started = deferred(), ended = deferred();
    vi.spyOn(payloads, 'buildChatRequestPayload').mockImplementation(async input => {
        input.onPreparationStage?.({ stage: 'memory', status: 'start' }); started.resolve();
        await memory.promise;
        input.onPreparationStage?.({ stage: 'memory', status: 'end', ms: 1 }); ended.resolve();
        throw new DOMException('已停止', 'AbortError');
    });
    await act(async () => root.render(React.createElement(Probe)));
    let pending!: Promise<void>;
    await act(async () => { pending = current.triggerAI([]); await started.promise; });
    expect(host.textContent).toBe('露易丝在回忆ing');
    await act(async () => { stopReplyRuns(charId); await pending; });
    expect(current.replyPhase).toBeNull();
    expect(host.textContent).toBe('');
    await act(async () => { memory.resolve(); await ended.promise; });
    expect(current.replyPhase).toBeNull();
    expect(host.textContent).toBe('');
});
