import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DB, openDB } from './db';
import { getBlobForRef, isBlobRef } from './blobRef';
import { importLocalEmoji } from './emojiImport';
import { ChatPrompts } from './chatPrompts';

const gifBytes = Uint8Array.from(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
const gif = () => new File([gifBytes], '兔兔抱抱.gif', { type: 'image/gif' });

beforeEach(async () => {
    vi.restoreAllMocks();
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('emojis', 'readwrite');
        tx.objectStore('emojis').clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
});

describe('相册表情导入', () => {
    it('重读后保留 GIF 原始字节与分类，AI 名称清单遵守角色可见范围', async () => {
        await importLocalEmoji(gif(), '  兔兔抱抱  ', 'loulou');
        const emojis = await DB.getEmojis();
        expect(emojis).toHaveLength(1);
        expect(emojis[0]).toMatchObject({ name: '兔兔抱抱', categoryId: 'loulou' });
        expect(isBlobRef(emojis[0].url)).toBe(true);
        const stored = await getBlobForRef(emojis[0].url);
        expect(stored?.type).toBe('image/gif');
        expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(gifBytes);
        const categories = [{ id: 'loulou', name: '兔兔', allowedCharacterIds: ['A'] }];
        const visible = ChatPrompts.filterVisibleEmojis(emojis, categories, 'A');
        expect(ChatPrompts.buildEmojiContext(visible.emojis, visible.categories)).toBe('兔兔: [兔兔抱抱]');
        expect(ChatPrompts.filterVisibleEmojis(emojis, categories, 'B').emojis).toEqual([]);
    });

    it('通用分类可用，不将图片字节塞进 AI 表情名称清单', async () => {
        await importLocalEmoji(gif(), '抱抱');
        const emojis = await DB.getEmojis();
        expect(emojis[0].categoryId).toBeUndefined();
        expect(ChatPrompts.buildEmojiContext(emojis, [])).toBe('通用: [抱抱]');
    });

    it('同名表情跨分类也不能被覆盖', async () => {
        await DB.saveEmoji('抱抱', 'https://example.com/original.gif', 'old');
        await expect(importLocalEmoji(gif(), '抱抱', 'new')).rejects.toThrow('已有同名表情包');
        expect(await DB.getEmojis()).toEqual([{ name: '抱抱', url: 'https://example.com/original.gif', categoryId: 'old' }]);
    });

    it('并发同名写入只有一张成功，不覆盖先保存的图片', async () => {
        const results = await Promise.allSettled([
            importLocalEmoji(gif(), '抱抱', 'one'), importLocalEmoji(gif(), '抱抱', 'two'),
        ]);
        expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
        expect(await DB.getEmojis()).toHaveLength(1);
    });

    it('拒绝空名称、空图片与非图片，不生成表情记录', async () => {
        await expect(importLocalEmoji(gif(), '  ')).rejects.toThrow('请填写');
        await expect(importLocalEmoji(new File([], 'empty.png', { type: 'image/png' }), '空图')).rejects.toThrow('有效的图片');
        await expect(importLocalEmoji(new File(['text'], 'note.txt', { type: 'text/plain' }), '文字')).rejects.toThrow('有效的图片');
        expect(await DB.getEmojis()).toEqual([]);
    });

    it('存储失败上抛给添加窗口，不假报保存成功', async () => {
        vi.spyOn(DB, 'addEmoji').mockRejectedValueOnce(new Error('空间不足'));
        await expect(importLocalEmoji(gif(), '抱抱')).rejects.toThrow('空间不足');
        expect(await DB.getEmojis()).toEqual([]);
    });
});
