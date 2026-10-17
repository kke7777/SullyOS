package com.kke7777.nuomi;

import android.content.Intent;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;
import org.unifiedpush.android.connector.UnifiedPush;
import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.List;
import kotlin.Unit;

@CapacitorPlugin(name = "AmsgUnifiedPush")
public class AmsgUnifiedPushPlugin extends Plugin {
    private static WeakReference<AmsgUnifiedPushPlugin> active = new WeakReference<>(null);
    private static volatile boolean visible;
    static boolean isVisible() { return visible; }
    static void publish(String event, JSONObject data) {
        AmsgUnifiedPushPlugin plugin = active.get();
        if (plugin != null) plugin.getActivity().runOnUiThread(() -> {
            try { plugin.notifyListeners(event, new JSObject(data.toString())); }
            catch (Exception ignored) { /* SQLite is the delivery source of truth. */ }
        });
    }

    @Override public void load() {
        active = new WeakReference<>(this);
        captureTap(getActivity().getIntent());
    }
    @Override protected void handleOnResume() {
        visible = true;
        String vapid = NativePushStore.get(getContext()).read("vapid");
        if (vapid != null && UnifiedPush.getAckDistributor(getContext()) != null) {
            try { UnifiedPush.register(getContext(), NuomiPushService.INSTANCE, "糯米机角色消息", vapid); }
            catch (Exception e) { NativePushStore.get(getContext()).write("lastError", "推送重新登记失败，请检查推送服务"); }
        }
        publish("pushReceived", new JSONObject()); // Wake JS to retry its durable inbox.
    }
    @Override protected void handleOnPause() { visible = false; }
    @Override protected void handleOnDestroy() {
        if (active.get() == this) { active.clear(); visible = false; }
    }
    @Override protected void handleOnNewIntent(Intent intent) { captureTap(intent); }

    private void captureTap(Intent intent) {
        if (intent == null) return;
        String raw = intent.getStringExtra(NuomiPushService.TAP_PAYLOAD);
        String id = intent.getStringExtra(NuomiPushService.TAP_ID);
        if (raw == null || id == null || !NativePushStore.get(getContext()).authenticTap(id, raw)) return;
        try {
            JSONObject launch = new JSONObject().put("id", id).put("payload", raw);
            NativePushStore.get(getContext()).write("launch", launch.toString());
            publish("notificationTapped", launch);
            intent.removeExtra(NuomiPushService.TAP_PAYLOAD); intent.removeExtra(NuomiPushService.TAP_ID);
        } catch (Exception ignored) {}
    }

    @PluginMethod public void getStatus(PluginCall call) {
        try {
            NativePushStore store = NativePushStore.get(getContext());
            List<String> distributors = UnifiedPush.getDistributors(getContext());
            String saved = UnifiedPush.getSavedDistributor(getContext());
            String raw = saved != null && distributors.contains(saved) ? store.read("subscription") : null;
            JSObject status = new JSObject();
            status.put("native", true); status.put("distributors", new JSArray(distributors));
            status.put("distributor", saved != null && distributors.contains(saved) ? saved : JSONObject.NULL);
            status.put("subscription", raw == null ? JSONObject.NULL : new JSONObject(raw));
            status.put("lastError", store.read("lastError") == null ? JSONObject.NULL : store.read("lastError"));
            call.resolve(status);
        } catch (Exception e) { call.reject("读取推送状态失败"); }
    }

    @PluginMethod public void register(PluginCall call) {
        String vapid = call.getString("vapidPublicKey", "").trim();
        if (!vapid.matches("[A-Za-z0-9_-]{87}")) { call.reject("Worker VAPID 公钥格式无效"); return; }
        getActivity().runOnUiThread(() -> {
            try {
                NativePushStore store = NativePushStore.get(getContext());
                String previous = store.read("vapid");
                if (previous != null && !previous.equals(vapid)) {
                    UnifiedPush.unregister(getContext(), NuomiPushService.INSTANCE);
                    store.write("subscription", null);
                }
                store.write("vapid", vapid); store.write("lastError", null);
                UnifiedPush.tryUseCurrentOrDefaultDistributor(getActivity(), success -> {
                    if (!success) { call.reject("未选择可用的 UnifiedPush 服务，请先安装并打开 ntfy"); return Unit.INSTANCE; }
                    try {
                        UnifiedPush.register(getContext(), NuomiPushService.INSTANCE, "糯米机角色消息", vapid);
                        JSObject result = new JSObject(); result.put("pending", true); call.resolve(result);
                    } catch (Exception e) { call.reject("推送注册失败，请检查 ntfy 后重试"); }
                    return Unit.INSTANCE;
                });
            } catch (Exception e) { call.reject("推送注册失败，请检查 ntfy 后重试"); }
        });
    }

    @PluginMethod public void unregister(PluginCall call) {
        try {
            UnifiedPush.unregister(getContext(), NuomiPushService.INSTANCE);
            NativePushStore store = NativePushStore.get(getContext());
            store.write("subscription", null); store.write("vapid", null); store.write("lastError", null);
            call.resolve();
        } catch (Exception e) { call.reject("注销推送失败"); }
    }

    @PluginMethod public void drainPendingPushes(PluginCall call) {
        try {
            NativePushStore store = NativePushStore.get(getContext());
            JSObject result = new JSObject(); result.put("messages", store.pending());
            String raw = store.read("launch");
            if (raw != null) {
                JSONObject launch = new JSONObject(raw); result.put("launchPayload", launch.getString("payload"));
                result.put("launchId", launch.getString("id"));
            }
            call.resolve(result);
        } catch (Exception e) { call.reject("读取本机推送收件箱失败"); }
    }

    @PluginMethod public void acknowledgePushes(PluginCall call) {
        try {
            JSArray values = call.getArray("ids", new JSArray()); List<String> ids = new ArrayList<>();
            for (int i = 0; i < values.length(); i++) ids.add(values.getString(i));
            NativePushStore.get(getContext()).acknowledge(ids, call.getString("launchId"));
            call.resolve();
        } catch (Exception e) { call.reject("确认本机推送收件箱失败"); }
    }
}
