import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  saveInboxMessage: vi.fn().mockResolvedValue(undefined),
  flushInboxToChat: vi.fn().mockResolvedValue(undefined),
  handleError: vi.fn().mockResolvedValue(undefined),
  dispatchResult: vi.fn().mockResolvedValue(true),
}));

vi.mock('./activeMsgStore', () => ({
  ActiveMsgStore: { saveInboxMessage: mocks.saveInboxMessage },
}));
vi.mock('./activeMsgRuntime', () => ({
  flushInboxToChat: mocks.flushInboxToChat,
  handleInstantErrorPushMessage: mocks.handleError,
}));
vi.mock('./amsgResults', () => ({ dispatchAmsgResult: mocks.dispatchResult }));

import { ingestNativeAmsgPayload, parseNativeAmsgPayload } from './nativeAmsgInbox';

describe('UnifiedPush payload 入库桥', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.saveInboxMessage.mockClear();
    mocks.flushInboxToChat.mockClear();
    mocks.handleError.mockClear();
    mocks.dispatchResult.mockReset().mockResolvedValue(true);
  });

  it('routes task results to their handler and retains failed results for retry', async () => {
    const payload = { messageId: 'result-1', messageKind: 'result', metadata: { charId: 'c' } };
    mocks.dispatchResult.mockResolvedValueOnce(false);
    await expect(ingestNativeAmsgPayload(payload)).rejects.toThrow();
    await ingestNativeAmsgPayload(payload);
    expect(mocks.dispatchResult).toHaveBeenCalledTimes(2);
    expect(mocks.saveInboxMessage).not.toHaveBeenCalled();
  });

  it('keeps error events and emotion updates out of normal chat text', async () => {
    await ingestNativeAmsgPayload({ messageId: 'err-1', messageKind: 'error', message: 'failed', metadata: { charId: 'c' } });
    expect(mocks.handleError).toHaveBeenCalledWith(expect.objectContaining({ charId: 'c' }));
    expect(mocks.saveInboxMessage).not.toHaveBeenCalled();
    await ingestNativeAmsgPayload({ messageId: 'emo-1', messageKind: 'emotion_update', message: 'not a chat message', metadata: { charId: 'c', emotionRaw: 'raw' } });
    expect(mocks.saveInboxMessage).toHaveBeenCalledWith(expect.objectContaining({ body: '', messageType: 'emotion_update', metadata: { charId: 'c', emotionRaw: 'raw' } }));
  });

  it('接受对象或 JSON 字符串，拒绝无效内容', () => {
    expect(parseNativeAmsgPayload({ message: 'hi' })).toEqual({ message: 'hi' });
    expect(parseNativeAmsgPayload('{"message":"hi"}')).toEqual({ message: 'hi' });
    expect(parseNativeAmsgPayload('not-json')).toBeNull();
  });

  it('把标准 AMSG payload 交给现有 inbox 管线并按 messageId 去重', async () => {
    const payload = {
      messageId: 'msg-up-1',
      message: '该醒啦',
      contactName: '小明',
      timestamp: '2026-08-09T08:00:00.000Z',
      metadata: { charId: 'char-1', charName: '小明' },
    };

    await ingestNativeAmsgPayload(payload);
    await ingestNativeAmsgPayload(payload);

    expect(mocks.saveInboxMessage).toHaveBeenCalledTimes(1);
    expect(mocks.saveInboxMessage).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'msg-up-1',
      charId: 'char-1',
      body: '该醒啦',
      sentAt: Date.parse('2026-08-09T08:00:00.000Z'),
    }));
    expect(mocks.flushInboxToChat).toHaveBeenCalledTimes(1);
  });
});
