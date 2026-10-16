package com.kke7777.nuomi;

import static org.junit.Assert.*;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.pm.ProviderInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;
import java.util.UUID;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowContentResolver;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {28, 34})
public class PhotoLibraryTest {
    private Context context;
    private File source;
    private FakeMediaProvider provider;
    private final byte[] original = new byte[]{(byte)137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3};

    @Before public void setup() throws Exception {
        context = RuntimeEnvironment.getApplication();
        source = new File(context.getCacheDir(), "nuomi-photo-" + UUID.randomUUID() + ".png");
        try (FileOutputStream output = new FileOutputStream(source)) { output.write(original); }
        provider = new FakeMediaProvider();
        provider.destination = new File(context.getCacheDir(), "test-media-output");
        ProviderInfo info = new ProviderInfo(); info.authority = "media";
        provider.attachInfo(context, info);
        ShadowContentResolver.registerProviderInternal("media", provider);
        Shadows.shadowOf(context.getContentResolver()).registerOutputStream(
                Uri.parse("content://media/external_primary/images/media/7"), new FileOutputStream(provider.destination));
    }

    @Test public void savesOriginalBytesAndPublishesOnlyAfterCopy() throws Exception {
        Uri result = PhotoLibraryPlugin.copyToGallery(context, source, "image/png");
        File exported = Build.VERSION.SDK_INT >= 29 ? provider.destination : new File(result.getPath());
        assertArrayEquals(original, Files.readAllBytes(exported.toPath()));
        assertArrayEquals(original, Files.readAllBytes(source.toPath()));
        if (Build.VERSION.SDK_INT >= 29) {
            assertEquals(1, provider.inserted.getAsInteger(MediaStore.Images.Media.IS_PENDING).intValue());
            assertEquals("Pictures/糯米机", provider.inserted.getAsString(MediaStore.Images.Media.RELATIVE_PATH));
            assertEquals("image/png", provider.inserted.getAsString(MediaStore.Images.Media.MIME_TYPE));
            assertEquals(0, provider.publishedPending);
            assertTrue(provider.bytesPresentAtPublish);
            assertFalse(provider.deleted);
        } else {
            assertTrue(exported.getAbsolutePath().contains("Pictures/糯米机/"));
        }
    }

    @Test public void stagedImageCannotReadOtherCacheFilesOrEscapeCache() throws Exception {
        assertEquals(source.getCanonicalFile(), PhotoLibraryPlugin.stagedImage(context, source.getName()));
        assertThrows(IOException.class, () -> PhotoLibraryPlugin.stagedImage(context, "../secret.png"));
        assertThrows(IOException.class, () -> PhotoLibraryPlugin.stagedImage(context, "secret.png"));
        assertThrows(IOException.class, () -> PhotoLibraryPlugin.stagedImage(context, "nuomi-photo-missing.png"));
        File empty = new File(context.getCacheDir(), "nuomi-photo-empty.png"); empty.createNewFile();
        assertThrows(IOException.class, () -> PhotoLibraryPlugin.stagedImage(context, empty.getName()));
    }

    @Test @Config(sdk = 34) public void failedWriteRemovesPendingRowAndNeverPublishes() {
        Shadows.shadowOf(context.getContentResolver()).registerOutputStream(
                Uri.parse("content://media/external_primary/images/media/7"), new OutputStream() {
                    @Override public void write(int value) throws IOException { throw new IOException("storage full"); }
                });
        assertThrows(IOException.class, () -> PhotoLibraryPlugin.copyToGallery(context, source, "image/png"));
        assertTrue(provider.deleted);
        assertEquals(-1, provider.publishedPending);
        assertTrue(source.isFile());
    }

    public static class FakeMediaProvider extends ContentProvider {
        File destination;
        ContentValues inserted;
        int publishedPending = -1;
        boolean deleted, bytesPresentAtPublish;
        @Override public boolean onCreate() { return true; }
        @Override public String getType(Uri uri) { return "image/png"; }
        @Override public Uri insert(Uri uri, ContentValues values) {
            inserted = new ContentValues(values);
            return Uri.parse("content://media/external_primary/images/media/7");
        }
        @Override public int update(Uri uri, ContentValues values, String selection, String[] args) {
            publishedPending = values.getAsInteger(MediaStore.Images.Media.IS_PENDING);
            bytesPresentAtPublish = destination.length() > 0;
            return 1;
        }
        @Override public int delete(Uri uri, String selection, String[] args) { deleted = true; return 1; }
        @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sortOrder) { return null; }
    }
}
