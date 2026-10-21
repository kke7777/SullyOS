// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ read: vi.fn(), ack: vi.fn(), ingest: vi.fn() }));
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn() } }));
vi.mock('./nativeAmsgInbox', () => ({
  ingestNativeAmsgPayload: mocks.ingest,
  parseNativeAmsgPayload: (raw: string) => { try { return JSON.parse(raw); } catch { return null; } },
}));
vi.mock('./unifiedPushPlugin', () => ({
  drainUnifiedPushMessages: mocks.read,
  acknowledgeUnifiedPushMessages: mocks.ack,
  addUnifiedPushListener: vi.fn(), isUnifiedPushPlatform: () => true,
}));
import { consumeNativePushInbox } from './unifiedPushRuntime';

beforeEach(() => { vi.clearAllMocks(); mocks.ingest.mockResolvedValue({ charId: 'c' }); mocks.ack.mockResolvedValue(undefined); });
const payload = JSON.stringify({ message: 'hi', metadata: { charId: 'c' } });

it('a failed database write is retained while other messages are acknowledged', async () => {
  mocks.read.mockResolvedValue({ messages: [{ id: 'bad', payload }, { id: 'good', payload }] });
  mocks.ingest.mockRejectedValueOnce(new Error('database blocked'));
  await consumeNativePushInbox();
  expect(mocks.ack).toHaveBeenCalledWith(['good'], undefined);
  expect(mocks.ingest).toHaveBeenLastCalledWith(expect.objectContaining({ messageId: 'good' }));
});

it('clicking a notification opens its own chat only after its payload is ingested', async () => {
  mocks.read.mockResolvedValue({ messages: [], launchId: 'click', launchPayload: payload });
  const received: string[] = [];
  window.addEventListener('active-msg-open', ((event: CustomEvent) => received.push(event.detail.charId)) as EventListener, { once: true });
  await consumeNativePushInbox();
  expect(received).toEqual(['c']);
  expect(mocks.ingest).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'click' }));
  expect(mocks.ack).toHaveBeenCalledWith([], 'click');
});

it('a notification whose database write fails is not acknowledged or opened', async () => {
  mocks.read.mockResolvedValue({ messages: [], launchId: 'click', launchPayload: payload });
  mocks.ingest.mockRejectedValue(new Error('database blocked'));
  const listener = vi.fn(); window.addEventListener('active-msg-open', listener);
  await consumeNativePushInbox();
  expect(mocks.ack).not.toHaveBeenCalled(); expect(listener).not.toHaveBeenCalled();
  window.removeEventListener('active-msg-open', listener);
});

it('processes the next batch when the first 200 messages succeed', async () => {
  mocks.read.mockResolvedValueOnce({ messages: Array.from({ length: 200 }, (_, i) => ({ id: String(i), payload })) })
    .mockResolvedValueOnce({ messages: [{ id: 'last', payload }] });
  await consumeNativePushInbox();
  expect(mocks.ack).toHaveBeenCalledTimes(2); expect(mocks.ack).toHaveBeenLastCalledWith(['last'], undefined);
});
