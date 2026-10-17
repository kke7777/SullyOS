import { Capacitor, registerPlugin } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { blobToDataUrl, dataUrlToBlob, getBlobForRef, isBlobRef } from './blobRef';
import { fetchBlobForShare, shareOrDownloadBlob } from './shareExport';

const PhotoLibrary = registerPlugin<{ saveImage(options: { fileName: string; mimeType: string }): Promise<{ uri: string }> }>('PhotoLibrary');
const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

/** Copy original bytes; exporting never re-encodes the image or changes the DB reference. */
export async function saveImageToDevice(value: string): Promise<'saved' | 'shared' | 'downloaded' | 'cancelled'> {
    const blob = isBlobRef(value) ? await getBlobForRef(value)
        : value.startsWith('data:') ? dataUrlToBlob(value) : await fetchBlobForShare(value, 'image/png');
    if (!blob?.size) throw new Error('图片不可用，请重新打开后重试');
    const mimeType = blob.type.toLowerCase().split(';')[0];
    const extension = extensions[mimeType];
    if (!extension) throw new Error('暂不支持保存这种图片格式');
    const fileName = `nuomi-photo-${crypto.randomUUID()}.${extension}`;
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
        try {
            const data = (await blobToDataUrl(blob)).split(',')[1];
            await Filesystem.writeFile({ directory: Directory.Cache, path: fileName, data });
            await PhotoLibrary.saveImage({ fileName, mimeType });
            return 'saved';
        } finally {
            // Remove only the temporary export, including on permission denial or a partial failure.
            try { await Filesystem.deleteFile({ directory: Directory.Cache, path: fileName }); } catch { /* best effort */ }
        }
    }
    return shareOrDownloadBlob({ blob, fileName, preferDownloadOnWeb: true });
}
