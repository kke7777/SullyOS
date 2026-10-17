package com.kke7777.nuomi;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import android.util.Base64;
import java.io.ByteArrayOutputStream;

/** Durable handoff: a read never removes messages; JavaScript acknowledges after saving. */
final class NativePushStore extends SQLiteOpenHelper {
    private static NativePushStore singleton;
    static synchronized NativePushStore get(Context context) {
        if (singleton == null) singleton = new NativePushStore(context.getApplicationContext());
        return singleton;
    }

    NativePushStore(Context context) { super(context, "nuomi-native-push.db", null, 1); }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE state (name TEXT PRIMARY KEY, value TEXT NOT NULL)");
        db.execSQL("CREATE TABLE pending (id TEXT PRIMARY KEY, payload TEXT NOT NULL, received INTEGER NOT NULL)");
        db.execSQL("CREATE TABLE seen (id TEXT PRIMARY KEY, payload TEXT NOT NULL, received INTEGER NOT NULL)");
        db.execSQL("CREATE TABLE multipart (id TEXT PRIMARY KEY, total INTEGER NOT NULL, expires INTEGER NOT NULL, created INTEGER NOT NULL, settled INTEGER NOT NULL)");
        db.execSQL("CREATE TABLE parts (id TEXT NOT NULL, part INTEGER NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY(id, part))");
    }
    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {}

    synchronized String read(String name) {
        try (Cursor c = getReadableDatabase().query("state", new String[]{"value"}, "name=?",
                new String[]{name}, null, null, null)) {
            return c.moveToFirst() ? c.getString(0) : null;
        }
    }

    synchronized void write(String name, String value) {
        SQLiteDatabase db = getWritableDatabase();
        if (value == null) { db.delete("state", "name=?", new String[]{name}); return; }
        ContentValues row = new ContentValues(); row.put("name", name); row.put("value", value);
        db.insertWithOnConflict("state", null, row, SQLiteDatabase.CONFLICT_REPLACE);
    }

    static String idFor(JSONObject message, String raw) throws Exception {
        String id = message.optString("messageId", "").trim();
        if (!id.isEmpty()) return id;
        byte[] hash = MessageDigest.getInstance("SHA-256").digest(raw.getBytes(StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder("native-");
        for (byte b : hash) result.append(String.format("%02x", b & 255));
        return result.toString();
    }

    synchronized boolean enqueue(String id, String payload, long received) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            try (Cursor c = db.query("seen", new String[]{"id"}, "id=?", new String[]{id}, null, null, null)) {
                if (c.moveToFirst()) { db.setTransactionSuccessful(); return false; }
            }
            ContentValues row = new ContentValues(); row.put("id", id); row.put("payload", payload); row.put("received", received);
            if (db.insertWithOnConflict("pending", null, row, SQLiteDatabase.CONFLICT_IGNORE) == -1) { db.setTransactionSuccessful(); return false; }
            ContentValues seen = new ContentValues(); seen.put("id", id); seen.put("payload", payload); seen.put("received", received);
            db.insertOrThrow("seen", null, seen);
            // Bound completed replay history only. Never evict an unacknowledged message.
            db.execSQL("DELETE FROM seen WHERE id NOT IN (SELECT id FROM pending) AND id NOT IN "
                    + "(SELECT id FROM seen ORDER BY received DESC LIMIT 2000)");
            db.setTransactionSuccessful(); return true;
        } finally { db.endTransaction(); }
    }

    synchronized JSONArray pending() throws JSONException {
        JSONArray rows = new JSONArray();
        try (Cursor c = getReadableDatabase().query("pending", new String[]{"id", "payload", "received"},
                null, null, null, null, "received ASC, rowid ASC", "200")) {
            while (c.moveToNext()) rows.put(new JSONObject().put("id", c.getString(0))
                    .put("payload", c.getString(1)).put("receivedAt", c.getLong(2)));
        }
        return rows;
    }

    /** Persist out-of-order transport fragments and atomically queue the restored business payload. */
    synchronized String acceptMultipart(JSONObject payload, long now) throws Exception {
        JSONObject meta = payload.getJSONObject("multipart");
        String id = meta.getString("id"), chunk = payload.getString("chunk");
        int part = meta.getInt("index"), total = meta.getInt("total");
        long created = meta.getLong("createdAt"), ttl = meta.getLong("ttlMs");
        if (meta.getInt("version") != 1 || !"json-utf8-base64url".equals(meta.getString("encoding"))
                || id.isEmpty() || id.length() > 200 || total < 1 || total > 128 || part < 1 || part > total
                || ttl <= 0 || chunk.length() > 8192 || !chunk.matches("[A-Za-z0-9_-]+")) {
            throw new IllegalArgumentException("Invalid multipart envelope");
        }
        byte[] bytes = Base64.decode(chunk, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
        try {
            db.execSQL("DELETE FROM parts WHERE id IN (SELECT id FROM multipart WHERE expires <= ?)", new Object[]{now});
            db.delete("multipart", "expires <= ?", new String[]{String.valueOf(now)});
            boolean exists = false;
            try (Cursor c = db.query("multipart", new String[]{"total", "created", "settled"}, "id=?", new String[]{id}, null, null, null)) {
                if (c.moveToFirst()) {
                    exists = true;
                    if (c.getInt(2) != 0) { db.setTransactionSuccessful(); return null; }
                    if (c.getInt(0) != total || c.getLong(1) != created) {
                        settleMultipart(db, id); db.setTransactionSuccessful(); return null;
                    }
                }
            }
            if (!exists) {
                if (db.compileStatement("SELECT COUNT(*) FROM multipart WHERE settled=0").simpleQueryForLong() >= 64)
                    throw new IllegalStateException("Too many incomplete messages");
                ContentValues group = new ContentValues(); group.put("id", id); group.put("total", total);
                group.put("created", created); group.put("expires", now + Math.min(ttl, 60000)); group.put("settled", 0);
                db.insertOrThrow("multipart", null, group);
            }
            try (Cursor c = db.query("parts", new String[]{"bytes"}, "id=? AND part=?", new String[]{id, String.valueOf(part)}, null, null, null)) {
                if (c.moveToFirst() && !java.util.Arrays.equals(c.getBlob(0), bytes)) {
                    settleMultipart(db, id); db.setTransactionSuccessful(); return null;
                }
            }
            ContentValues row = new ContentValues(); row.put("id", id); row.put("part", part); row.put("bytes", bytes);
            db.insertWithOnConflict("parts", null, row, SQLiteDatabase.CONFLICT_IGNORE);
            ByteArrayOutputStream restored = new ByteArrayOutputStream(); int count = 0;
            try (Cursor c = db.query("parts", new String[]{"bytes"}, "id=?", new String[]{id}, null, null, "part ASC")) {
                while (c.moveToNext()) {
                    byte[] data = c.getBlob(0);
                    if (restored.size() + data.length > 256000) {
                        settleMultipart(db, id); db.setTransactionSuccessful(); return null;
                    }
                    restored.write(data); count++;
                }
            }
            if (count != total) { db.setTransactionSuccessful(); return null; }
            String raw = new String(restored.toByteArray(), StandardCharsets.UTF_8);
            JSONObject message = new JSONObject(raw), metadata = message.optJSONObject("metadata");
            if (metadata == null || metadata.optString("charId", "").trim().isEmpty()
                    || "_multipart".equals(message.optString("messageKind"))) {
                settleMultipart(db, id); db.setTransactionSuccessful(); return null;
            }
            boolean fresh = enqueue(idFor(message, raw), raw, now);
            settleMultipart(db, id); db.setTransactionSuccessful();
            return fresh ? raw : null;
        } finally { db.endTransaction(); }
    }

    private void settleMultipart(SQLiteDatabase db, String id) {
        db.delete("parts", "id=?", new String[]{id});
        ContentValues state = new ContentValues(); state.put("settled", 1);
        db.update("multipart", state, "id=?", new String[]{id});
    }

    synchronized boolean authenticTap(String id, String payload) {
        try (Cursor c = getReadableDatabase().query("seen", new String[]{"payload"}, "id=?", new String[]{id}, null, null, null)) {
            return c.moveToFirst() && payload.equals(c.getString(0));
        }
    }

    synchronized void acknowledge(List<String> ids, String launchId) throws JSONException {
        SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
        try {
            for (String id : ids) db.delete("pending", "id=?", new String[]{id});
            String launch = read("launch");
            if (launchId != null && launch != null && launchId.equals(new JSONObject(launch).optString("id"))) {
                write("launch", null);
            }
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }
}
