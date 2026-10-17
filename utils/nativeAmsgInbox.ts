import type { ActiveMsg2InboxMessage } from '../types';
import { flushInboxToChat, handleInstantErrorPushMessage } from './activeMsgRuntime';
import { ActiveMsgStore } from './activeMsgStore';

const RECEIVED_IDS_KEY = 'amsg2_native_received_ids_v2';

const readReceivedIds = (): string[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECEIVED_IDS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
};

const rememberReceivedId = (messageId: string): void => {
  const next = [messageId, ...readReceivedIds().filter((id) => id !== messageId)].slice(0, 100);
  localStorage.setItem(RECEIVED_IDS_KEY, JSON.stringify(next));
};

export const parseNativeAmsgPayload = (raw: unknown): Record<string, any> | null => {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, any>;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, any> : null;
  } catch {
    return null;
  }
};

/** 把 UnifiedPush 收到的标准 AMSG payload 送进 master 现有的 inbox 管线。 */
export const ingestNativeAmsgPayload = async (
  raw: unknown,
  previewOverride?: string,
): Promise<{ charId: string; messageId: string } | null> => {
  const payload = parseNativeAmsgPayload(raw);
  const charId = payload?.metadata?.charId;
  if (!payload || typeof charId !== 'string' || !charId) return null;

  const messageId = String(payload.messageId || `${charId}-${Date.now()}`);
  if (readReceivedIds().includes(messageId)) return { charId, messageId };

  if (payload.messageKind === 'result') {
    const { dispatchAmsgResult } = await import('./amsgResults');
    if (!await dispatchAmsgResult(payload)) throw new Error('原生后台任务结果尚未成功保存');
    rememberReceivedId(messageId);
    return { charId, messageId };
  }
  if (payload.messageKind === 'error') {
    await handleInstantErrorPushMessage({ type: 'active-msg-error', ...payload, charId });
    rememberReceivedId(messageId);
    return { charId, messageId };
  }

  const parsedSentAt = payload.timestamp ? new Date(payload.timestamp).getTime() : NaN;
  const emotion = payload.messageKind === 'emotion_update';
  const body = emotion ? '' : String(payload.message || payload.body || '').trim();
  const inbox: ActiveMsg2InboxMessage = {
    messageId,
    charId,
    charName: String(payload.contactName || payload.metadata?.charName || '主动消息'),
    body,
    previewBody: emotion ? '' : String(previewOverride || payload.notification?.body || payload.previewBody || body).trim(),
    avatarUrl: payload.avatarUrl,
    source: payload.source,
    messageType: emotion ? 'emotion_update' : payload.messageType,
    messageSubtype: payload.messageSubtype,
    taskId: payload.taskId ?? null,
    taskUuid: payload.taskUuid ?? null,
    recurrenceType: payload.recurrenceType ?? null,
    occurrenceMs: payload.occurrenceMs ?? null,
    metadata: emotion ? { charId, emotionRaw: payload.metadata?.emotionRaw || '' } : {
      ...(payload.metadata || {}),
      sessionId: payload.sessionId,
      messageIndex: payload.messageIndex,
      totalMessages: payload.totalMessages,
    },
    sentAt: Number.isFinite(parsedSentAt) ? parsedSentAt : Date.now(),
    receivedAt: Date.now(),
  };

  await ActiveMsgStore.saveInboxMessage(inbox);
  rememberReceivedId(messageId);
  await flushInboxToChat('原生收件箱');
  return { charId, messageId };
};
