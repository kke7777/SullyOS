package com.kke7777.nuomi;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

/** Export only an explicitly staged image; never read the user's photo library. */
@CapacitorPlugin(name = "PhotoLibrary", permissions = {
    @Permission(alias = "legacyWrite", strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE })
})
public class PhotoLibraryPlugin extends Plugin {
    @PluginMethod public void saveImage(PluginCall call) {
        if (Build.VERSION.SDK_INT <= 28 && getPermissionState("legacyWrite") != PermissionState.GRANTED) {
            requestPermissionForAlias("legacyWrite", call, "writePermissionResult");
            return;
        }
        saveAuthorized(call);
    }

    @PermissionCallback private void writePermissionResult(PluginCall call) {
        if (getPermissionState("legacyWrite") != PermissionState.GRANTED) {
            call.reject("未获得保存图片所需的存储权限");
            return;
        }
        saveAuthorized(call);
    }

    private void saveAuthorized(PluginCall call) {
        getBridge().execute(() -> {
            try {
                File source = stagedImage(getContext(), call.getString("fileName"));
                String mime = call.getString("mimeType", "");
                if (!mime.matches("image/(png|jpeg|webp|gif)")) throw new IOException("不支持的图片格式");
                String extension = mime.equals("image/jpeg") ? "jpg" : mime.substring(6);
                if (!source.getName().endsWith("." + extension)) throw new IOException("图片格式与文件名不匹配");
                Uri uri = copyToGallery(getContext(), source, mime);
                JSObject result = new JSObject();
                result.put("uri", uri.toString());
                call.resolve(result);
            } catch (Exception error) {
                call.reject("保存到手机相册失败，请检查存储空间和权限", error);
            }
        });
    }

    static File stagedImage(Context context, String name) throws IOException {
        if (name == null || !name.matches("nuomi-photo-[a-zA-Z0-9-]+\\.(png|jpg|webp|gif)")) throw new IOException("无效的图片文件");
        File cache = context.getCacheDir().getCanonicalFile();
        File source = new File(cache, name).getCanonicalFile();
        if (!cache.equals(source.getParentFile()) || !source.isFile() || source.length() == 0) throw new IOException("图片文件不可用");
        return source;
    }

    @SuppressWarnings("deprecation")
    static Uri copyToGallery(Context context, File source, String mime) throws IOException {
        if (Build.VERSION.SDK_INT >= 29) {
            ContentResolver resolver = context.getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, source.getName());
            values.put(MediaStore.Images.Media.MIME_TYPE, mime);
            values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/糯米机");
            values.put(MediaStore.Images.Media.IS_PENDING, 1);
            Uri uri = resolver.insert(MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values);
            if (uri == null) throw new IOException("无法创建相册图片");
            try {
                try (OutputStream output = resolver.openOutputStream(uri)) { copy(source, output); }
                values.clear();
                values.put(MediaStore.Images.Media.IS_PENDING, 0);
                if (resolver.update(uri, values, null, null) < 1) throw new IOException("图片发布失败");
                return uri;
            } catch (Exception error) {
                try { resolver.delete(uri, null, null); } catch (Exception ignored) { }
                if (error instanceof IOException) throw (IOException) error;
                throw new IOException("图片写入失败", error);
            }
        }
        File album = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "糯米机");
        if (!album.isDirectory() && !album.mkdirs()) throw new IOException("无法创建相册文件夹");
        File target = new File(album, source.getName());
        if (!target.createNewFile()) throw new IOException("图片文件已存在，请重试");
        try {
            try (OutputStream output = new FileOutputStream(target)) { copy(source, output); }
            MediaScannerConnection.scanFile(context, new String[]{target.getAbsolutePath()}, new String[]{mime}, null);
            return Uri.fromFile(target);
        } catch (IOException error) {
            target.delete();
            throw error;
        }
    }

    private static void copy(File source, OutputStream output) throws IOException {
        if (output == null) throw new IOException("无法打开相册图片");
        try (FileInputStream input = new FileInputStream(source)) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            output.flush();
        }
    }
}
