package com.kke7777.nuomi;

import static org.junit.Assert.*;
import android.app.NotificationManager;
import android.content.Context;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.unifiedpush.android.connector.data.PushMessage;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class NativePushDeliveryTest {
    private Context context;
    private NativePushStore store;
    private NuomiPushService service;
    private final String raw = "{\"messageId\":\"one\",\"message\":\"hello\",\"metadata\":{\"charId\":\"c\"}}";
    @Before public void setup() throws Exception {
        context = RuntimeEnvironment.getApplication();
        Field singleton = NativePushStore.class.getDeclaredField("singleton"); singleton.setAccessible(true); singleton.set(null, null);
        context.deleteDatabase("nuomi-native-push.db");
        store = NativePushStore.get(context);
        service = Robolectric.buildService(NuomiPushService.class).create().get();
    }
    @After public void teardown() { service.onDestroy(); store.close(); }

    @Test public void readAndReopenDoNotLoseUnacknowledgedMessages() throws Exception {
        assertTrue(store.enqueue("one", raw, 123));
        assertEquals(1, store.pending().length()); assertEquals(1, store.pending().length());
        try (NativePushStore reopened = new NativePushStore(context)) {
            assertEquals(raw, reopened.pending().getJSONObject(0).getString("payload"));
            reopened.acknowledge(Collections.singletonList("one"), null);
        }
        assertEquals(0, store.pending().length());
        assertFalse(store.enqueue("one", raw, 124));
    }

    @Test public void forgedNotificationExtrasCannotIntroduceAnotherMessage() throws Exception {
        store.enqueue("one", raw, 123);
        assertTrue(store.authenticTap("one", raw));
        assertFalse(store.authenticTap("one", raw.replace("hello", "forged")));
        assertFalse(store.authenticTap("unknown", raw));
    }

    @Test public void acknowledgmentCannotClearANewerNotificationClick() throws Exception {
        store.write("launch", new JSONObject().put("id", "new").put("payload", raw).toString());
        store.acknowledge(Collections.emptyList(), "old");
        assertNotNull(store.read("launch"));
        store.acknowledge(Collections.emptyList(), "new"); assertNull(store.read("launch"));
    }

    @Test public void decryptedMessageIsStoredAndNotifiedOnce() throws Exception {
        PushMessage message = new PushMessage(raw.getBytes(StandardCharsets.UTF_8), true);
        service.onMessage(message, NuomiPushService.INSTANCE);
        service.onMessage(message, NuomiPushService.INSTANCE);
        assertEquals(1, store.pending().length());
        assertEquals(1, Shadows.shadowOf((NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE)).getAllNotifications().size());
    }

    @Test public void undecryptedAndWrongInstanceMessagesAreRejected() throws Exception {
        service.onMessage(new PushMessage(raw.getBytes(StandardCharsets.UTF_8), false), NuomiPushService.INSTANCE);
        service.onMessage(new PushMessage(raw.getBytes(StandardCharsets.UTF_8), true), "another-instance");
        assertEquals(0, store.pending().length());
    }

    @Test public void emotionPayloadIsQueuedWithoutSystemNotification() throws Exception {
        String emotion = raw.replace("\"messageId\"", "\"messageKind\":\"emotion_update\",\"messageId\"");
        service.onMessage(new PushMessage(emotion.getBytes(StandardCharsets.UTF_8), true), NuomiPushService.INSTANCE);
        assertEquals(1, store.pending().length());
        assertEquals(0, Shadows.shadowOf((NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE)).getAllNotifications().size());
    }

    @Test public void pendingMessagesAreNeverEvictedByReplayHistoryLimit() throws Exception {
        for (int i = 0; i < 2005; i++) store.enqueue("m" + i, raw, i);
        assertEquals(200, store.pending().length());
        assertEquals(2005, store.getReadableDatabase().compileStatement("SELECT COUNT(*) FROM pending").simpleQueryForLong());
        assertFalse(store.enqueue("m0", raw, 9999));
    }

    @Test public void actualProducerFragmentsRestoreUnicodeOutOfOrderAndAcrossReopen() throws Exception {
        JSONObject fixture = new JSONObject(new String(getClass().getResourceAsStream("/amsg-multipart.json").readAllBytes(), StandardCharsets.UTF_8));
        org.json.JSONArray parts = fixture.getJSONArray("parts");
        try (NativePushStore firstProcess = new NativePushStore(context)) {
            assertNull(firstProcess.acceptMultipart(parts.getJSONObject(parts.length() - 1), 1000));
        }
        String restored = null;
        for (int i = parts.length() - 2; i >= 0; i--) {
            restored = store.acceptMultipart(parts.getJSONObject(i), 1001);
        }
        assertEquals(fixture.getJSONObject("payload").getString("message"), new JSONObject(restored).getString("message"));
        assertEquals(1, store.pending().length());
        assertNull(store.acceptMultipart(parts.getJSONObject(0), 1002));
    }

    @Test public void conflictingMultipartChunksAreDiscardedWithoutCorruptChatText() throws Exception {
        JSONObject fixture = new JSONObject(new String(getClass().getResourceAsStream("/amsg-multipart.json").readAllBytes(), StandardCharsets.UTF_8));
        JSONObject part = fixture.getJSONArray("parts").getJSONObject(0);
        assertNull(store.acceptMultipart(part, 1000));
        JSONObject changed = new JSONObject(part.toString()); changed.put("chunk", "Y29ycnVwdA");
        assertNull(store.acceptMultipart(changed, 1001));
        for (int i = 1; i < fixture.getJSONArray("parts").length(); i++)
            assertNull(store.acceptMultipart(fixture.getJSONArray("parts").getJSONObject(i), 1002));
        assertEquals(0, store.pending().length());
    }
}
