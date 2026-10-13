import { App } from '@capacitor/app';
import { ingestNativeAmsgPayload, parseNativeAmsgPayload } from './nativeAmsgInbox';
import { acknowledgeUnifiedPushMessages, addUnifiedPushListener, drainUnifiedPushMessages, isUnifiedPushPlatform } from './unifiedPushPlugin';

let initializing: Promise<void> | undefined;
let deliveryChain: Promise<unknown> = Promise.resolve();

const ingest = async (raw: unknown, id?: string): Promise<void> => {
  const payload = parseNativeAmsgPayload(raw);
  if (!payload) return;
  if (!payload.messageId && id) payload.messageId = id;
  await ingestNativeAmsgPayload(payload);
};

/** Only acknowledge ingested IDs. SQLite keeps failed rows across restarts. */
export const consumeNativePushInbox = async (): Promise<void> => {
  for (;;) {
    const pending = await drainUnifiedPushMessages();
    const acknowledged: string[] = [];
    for (const message of pending.messages || []) {
      try {
        await ingest(message.payload, message.id);
        acknowledged.push(message.id);
      } catch { console.warn('[UnifiedPush] 一条消息暂未入库，保留到下次重试'); }
    }
    let launchId: string | undefined;
    if (pending.launchPayload && pending.launchId) {
      try {
        await ingest(pending.launchPayload, pending.launchId);
        const payload = parseNativeAmsgPayload(pending.launchPayload);
        const charId = payload?.metadata?.charId;
        if (typeof charId === 'string' && charId) {
          window.dispatchEvent(new CustomEvent('active-msg-open', { detail: { charId } }));
        }
        launchId = pending.launchId;
      } catch { console.warn('[UnifiedPush] 点通知的消息暂未入库，保留到下次重试'); }
    }
    if (acknowledged.length || launchId) await acknowledgeUnifiedPushMessages(acknowledged, launchId);
    if ((pending.messages?.length || 0) < 200 || acknowledged.length === 0) break;
  }
};

const scheduleDrain = (): Promise<unknown> => {
  const run = deliveryChain.then(consumeNativePushInbox, consumeNativePushInbox);
  deliveryChain = run.catch(() => console.warn('[UnifiedPush] 本机推送收件箱暂不可读，下次回前台重试'));
  return deliveryChain;
};

export const initUnifiedPushRuntime = (): Promise<void> => {
  if (!isUnifiedPushPlatform()) return Promise.resolve();
  if (!initializing) {
    initializing = (async () => {
      await addUnifiedPushListener('pushReceived', () => { void scheduleDrain(); });
      await addUnifiedPushListener('notificationTapped', () => { void scheduleDrain(); });
      await addUnifiedPushListener('registrationChanged', () => {
        void import('./activeMsgClient').then(({ ActiveMsgClient }) => ActiveMsgClient.reconcilePushSubscription())
          .catch(() => console.warn('[UnifiedPush] 订阅登记稍后重试'));
      });
      await App.addListener('appStateChange', ({ isActive }) => { if (isActive) void scheduleDrain(); });
      await scheduleDrain();
    })();
  }
  return initializing;
};
