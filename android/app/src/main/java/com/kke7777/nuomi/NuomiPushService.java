package com.kke7777.nuomi;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import org.json.JSONObject;
import org.unifiedpush.android.connector.FailedReason;
import org.unifiedpush.android.connector.PushService;
import org.unifiedpush.android.connector.UnifiedPush;
import org.unifiedpush.android.connector.data.PushEndpoint;
import org.unifiedpush.android.connector.data.PushMessage;
import org.unifiedpush.android.connector.data.PublicKeySet;
import java.nio.charset.StandardCharsets;

/** The official connector validates the sender/token and decrypts RFC8291 before this service. */
public class NuomiPushService extends PushService {
    static final String INSTANCE = "nuomi-amsg";
    static final String CHANNEL = "nuomi_amsg";
    static final String TAP_PAYLOAD = "nuomi_push_payload";
    static final String TAP_ID = "nuomi_push_id";

    @Override public void onNewEndpoint(PushEndpoint endpoint, String instance) {
        if (!INSTANCE.equals(instance)) return;
        NativePushStore store = NativePushStore.get(this);
        try {
            PublicKeySet keys = endpoint.getPubKeySet();
            if (keys == null || !endpoint.getUrl().startsWith("https://")) {
                store.write("subscription", null); store.write("lastError", "推送服务未提供有效的加密 HTTPS 订阅"); return;
            }
            JSONObject subscription = new JSONObject().put("endpoint", endpoint.getUrl())
                    .put("keys", new JSONObject().put("p256dh", keys.getPubKey()).put("auth", keys.getAuth()))
                    .put("distributor", UnifiedPush.getSavedDistributor(this))
                    .put("temporary", endpoint.getTemporary()).put("vapidPublicKey", store.read("vapid"));
            store.write("subscription", subscription.toString()); store.write("lastError", null);
            AmsgUnifiedPushPlugin.publish("registrationChanged", new JSONObject());
        } catch (Exception e) { store.write("lastError", "推送订阅保存失败，请重试"); }
    }

    @Override public void onMessage(PushMessage message, String instance) {
        if (!INSTANCE.equals(instance)) return;
        NativePushStore store = NativePushStore.get(this);
        if (!message.getDecrypted()) { store.write("lastError", "推送消息解密失败，请重置订阅"); return; }
        try {
            String raw = new String(message.getContent(), StandardCharsets.UTF_8);
            JSONObject payload = new JSONObject(raw);
            boolean multipart = "_multipart".equals(payload.optString("messageKind"));
            if (multipart) {
                raw = store.acceptMultipart(payload, System.currentTimeMillis());
                if (raw == null) return;
                payload = new JSONObject(raw);
            }
            JSONObject metadata = payload.optJSONObject("metadata");
            if (metadata == null || metadata.optString("charId", "").trim().isEmpty()) return;
            String id = NativePushStore.idFor(payload, raw);
            if (!multipart && !store.enqueue(id, raw, System.currentTimeMillis())) return;
            AmsgUnifiedPushPlugin.publish("pushReceived", new JSONObject().put("id", id).put("payload", raw));
            showNotification(id, raw, payload, metadata);
        } catch (Exception e) {
            // Do not log message contents, subscriptions or cryptographic keys.
            store.write("lastError", "推送消息处理失败，请重新打开糯米机检查");
        }
    }

    private void showNotification(String id, String raw, JSONObject payload, JSONObject metadata) {
        JSONObject options = payload.optJSONObject("notification");
        String show = options == null ? "auto" : options.optString("show", "auto");
        String kind = payload.optString("messageKind", "content");
        if ("never".equals(show) || "false".equals(show) || "emotion_update".equals(kind)) return;
        if ("auto".equals(show) && !"content".equals(kind) && !"result".equals(kind)) return;
        if ("when-hidden".equals(show) && AmsgUnifiedPushPlugin.isVisible()) return;
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) return;
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "角色主动消息", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("糯米机的角色消息与提醒"); manager.createNotificationChannel(channel);
        }
        String title = payload.optString("contactName", metadata.optString("charName", "糯米机"));
        if (options != null) title = options.optString("title", title);
        String body = payload.optString("message", payload.optString("body", ""));
        if (options != null) body = options.optString("body", body);
        if (body.trim().isEmpty()) body = "有一条新消息";
        Intent launch = new Intent(this, MainActivity.class).setAction(Intent.ACTION_VIEW)
                .setData(Uri.parse("nuomi://notification/" + Uri.encode(id)))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(TAP_PAYLOAD, raw).putExtra(TAP_ID, id);
        PendingIntent tap = PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Object silence = options == null ? payload.opt("silent") : options.opt("silent");
        boolean silent = Boolean.TRUE.equals(silence) || ("when-visible".equals(silence) && AmsgUnifiedPushPlugin.isVisible());
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_push_message).setContentTitle(title).setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body)).setContentIntent(tap)
                .setAutoCancel(true).setOnlyAlertOnce(true).setSilent(silent)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setPriority(NotificationCompat.PRIORITY_HIGH)
                .setGroup("nuomi-char-" + metadata.optString("charId"));
        try { NotificationManagerCompat.from(this).notify(id, 1, builder.build()); }
        catch (SecurityException ignored) { /* Native queue still retains the message. */ }
    }

    @Override public void onRegistrationFailed(FailedReason reason, String instance) {
        if (!INSTANCE.equals(instance)) return;
        NativePushStore.get(this).write("lastError", reason.name());
        AmsgUnifiedPushPlugin.publish("registrationChanged", new JSONObject());
    }
    @Override public void onUnregistered(String instance) {
        if (!INSTANCE.equals(instance)) return;
        NativePushStore store = NativePushStore.get(this);
        store.write("subscription", null); store.write("lastError", "推送订阅已注销，请重新开启");
        AmsgUnifiedPushPlugin.publish("registrationChanged", new JSONObject());
    }
    @Override public void onTempUnavailable(String instance) {
        if (INSTANCE.equals(instance)) NativePushStore.get(this).write("lastError", "推送服务暂时不可用，等待恢复");
    }
}
