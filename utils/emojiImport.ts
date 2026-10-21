import { DB } from './db';
import { putImageBlob } from './blobRef';

export function isEmojiImage(file: File): boolean {
    // Some Android document providers omit the MIME type.
    return file.type.startsWith('image/')
        || (!file.type && /\.(png|jpe?g|gif|webp|avif|bmp|svg|heic|heif)$/i.test(file.name));
}

/** Store the original bytes, including animated GIF/WebP frames, in the existing image store. */
export async function importLocalEmoji(file: File, name: string, categoryId?: string): Promise<void> {
    const trimmedName = name.trim();
    if (!trimmedName) throw new Error('请填写表情包名称');
    if (!isEmojiImage(file) || file.size === 0) throw new Error('请选择有效的图片文件');
    // Names are global keys, even when categories are restricted to different characters.
    const existing = await DB.getEmojis();
    if (existing.some(emoji => emoji.name === trimmedName)) {
        throw new Error('已有同名表情包，请换一个名称');
    }
    const ref = await putImageBlob(file);
    await DB.addEmoji(trimmedName, ref, categoryId);
}
