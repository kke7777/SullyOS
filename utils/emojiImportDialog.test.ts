// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import EmojiImportDialog from '../components/chat/EmojiImportDialog';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
let sequence = 0;
const createObjectURL = vi.fn(() => `blob:preview-${++sequence}`);
const revokeObjectURL = vi.fn();
const onImportImage = vi.fn();
const onImportLinks = vi.fn();
const onClose = vi.fn();

beforeEach(() => {
    vi.clearAllMocks();
    onImportImage.mockResolvedValue(undefined);
    (URL as any).createObjectURL = createObjectURL;
    (URL as any).revokeObjectURL = revokeObjectURL;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(createElement(EmojiImportDialog, {
        existingNames: ['已有表情'], linkText: '抱抱--https://example.com/a.gif',
        onLinkTextChange: () => {}, onImportLinks, onImportImage, onClose,
    })));
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
});
function button(text: string) {
    return Array.from(container.querySelectorAll('button')).find(b => b.textContent === text)!;
}
function select(file: File) {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    act(() => input.dispatchEvent(new Event('change', { bubbles: true })));
}
function setName(name: string) {
    const input = container.querySelector<HTMLInputElement>('input[type="text"]')!;
    act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, name);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}
function previewLoad() {
    act(() => container.querySelector('img')!.dispatchEvent(new Event('load')));
}
const file = (name = '兔兔.gif') => new File(['GIF89a'], name, { type: 'image/gif' });

describe('相册添加窗口', () => {
    it('选图、预览通过、命名后才能保存原文件，并阻止重复提交', async () => {
        expect(button('添加至当前分类').disabled).toBe(true);
        const selected = file();
        select(selected);
        expect(container.querySelector('img')?.src).toContain('blob:preview-');
        expect(button('添加至当前分类').disabled).toBe(true);
        previewLoad();
        setName('  小狗抱抱  ');
        let resolve!: () => void;
        onImportImage.mockReturnValueOnce(new Promise<void>(r => { resolve = r; }));
        await act(async () => { const save = button('添加至当前分类'); save.click(); save.click(); });
        expect(onImportImage).toHaveBeenCalledOnce();
        expect(onImportImage).toHaveBeenCalledWith(selected, '小狗抱抱');
        expect(button('正在保存…').disabled).toBe(true);
        await act(async () => resolve());
    });

    it('同名提示可改名恢复，图片预览失败时不可保存', () => {
        select(file()); previewLoad(); setName('已有表情');
        expect(container.textContent).toContain('已有同名表情包');
        expect(button('添加至当前分类').disabled).toBe(true);
        setName('新表情');
        expect(button('添加至当前分类').disabled).toBe(false);
        act(() => container.querySelector('img')!.dispatchEvent(new Event('error')));
        expect(container.textContent).toContain('无法预览');
        expect(button('添加至当前分类').disabled).toBe(true);
    });

    it('保存失败保留图片和名称，可以重试', async () => {
        select(file()); previewLoad(); setName('抱抱');
        onImportImage.mockRejectedValueOnce(new Error('空间不足'));
        await act(async () => button('添加至当前分类').click());
        expect(container.textContent).toContain('空间不足');
        expect(container.querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe('抱抱');
        expect(container.querySelector('img')).not.toBeNull();
        expect(onClose).not.toHaveBeenCalled();
        await act(async () => button('添加至当前分类').click());
        expect(onImportImage).toHaveBeenCalledTimes(2);
    });

    it('更换与关闭释放临时预览，取消不保存', () => {
        select(file());
        const first = container.querySelector('img')!.src;
        select(file('另一个.gif'));
        expect(revokeObjectURL).toHaveBeenCalledWith(first);
        const second = container.querySelector('img')!.src;
        act(() => button('取消').click());
        expect(onClose).toHaveBeenCalledOnce();
        act(() => root.render(null));
        expect(revokeObjectURL).toHaveBeenCalledWith(second);
        expect(onImportImage).not.toHaveBeenCalled();
    });

    it('链接导入仍交给原有处理逻辑', async () => {
        act(() => button('链接导入').click());
        expect(container.querySelector('textarea')?.value).toContain('抱抱--https://');
        await act(async () => button('添加至当前分类').click());
        expect(onImportLinks).toHaveBeenCalledOnce();
        expect(onImportImage).not.toHaveBeenCalled();
    });
});
