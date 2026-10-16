// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ save: vi.fn(), write: vi.fn(), remove: vi.fn(), getBlob: vi.fn(), fetchBlob: vi.fn(), share: vi.fn(), android: true }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => mocks.android, getPlatform: () => mocks.android ? 'android' : 'web' }, registerPlugin: () => ({ saveImage: mocks.save }) }));
vi.mock('@capacitor/filesystem', () => ({ Directory: { Cache: 'CACHE' }, Filesystem: { writeFile: mocks.write, deleteFile: mocks.remove } }));
vi.mock('./blobRef', () => ({ isBlobRef: (v: string) => v.startsWith('blobref:'), getBlobForRef: mocks.getBlob, blobToDataUrl: vi.fn(async () => 'data:image/png;base64,b3JpZ2luYWw='), dataUrlToBlob: () => new Blob(['original'], { type: 'image/png' }) }));
vi.mock('./shareExport', () => ({ fetchBlobForShare: mocks.fetchBlob, shareOrDownloadBlob: mocks.share }));
import { saveImageToDevice } from './saveImage';
beforeEach(() => { vi.clearAllMocks(); mocks.android = true; mocks.getBlob.mockResolvedValue(new Blob(['original'], { type: 'image/png' })); mocks.save.mockResolvedValue({ uri: 'content://media/image/1' }); mocks.write.mockResolvedValue({}); mocks.remove.mockResolvedValue({}); });
it('stages the original then confirms a MediaStore save and removes the temporary file', async () => {
    expect(await saveImageToDevice('blobref:original')).toBe('saved');
    expect(mocks.getBlob).toHaveBeenCalledWith('blobref:original');
    expect(mocks.write).toHaveBeenCalledWith({ directory: 'CACHE', path: expect.stringMatching(/^nuomi-photo-.*\.png$/), data: 'b3JpZ2luYWw=' });
    const path = mocks.write.mock.calls[0][0].path;
    expect(mocks.save).toHaveBeenCalledWith({ fileName: path, mimeType: 'image/png' });
    expect(mocks.remove).toHaveBeenCalledWith({ directory: 'CACHE', path });
    expect(mocks.write.mock.invocationCallOrder[0]).toBeLessThan(mocks.save.mock.invocationCallOrder[0]);
    expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(mocks.remove.mock.invocationCallOrder[0]);
    expect(mocks.share).not.toHaveBeenCalled();
});
it('reports permission or write failures, cleans up and does not pretend to download', async () => {
    mocks.save.mockRejectedValueOnce(new Error('permission denied'));
    await expect(saveImageToDevice('blobref:original')).rejects.toThrow('permission denied');
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.share).not.toHaveBeenCalled();
});
it('does not mask a successful save if temporary cleanup fails', async () => {
    mocks.remove.mockRejectedValueOnce(new Error('cache gone'));
    expect(await saveImageToDevice('data:image/png;base64,b3JpZ2luYWw=')).toBe('saved');
});
it('rejects missing images without invoking the native plugin', async () => {
    mocks.getBlob.mockResolvedValueOnce(null);
    await expect(saveImageToDevice('blobref:missing')).rejects.toThrow('图片不可用');
    expect(mocks.save).not.toHaveBeenCalled();
});
it('uses the existing web exporter and passes the original animated image unchanged', async () => {
    mocks.android = false;
    const blob = new Blob(['gif-original'], { type: 'image/gif' });
    mocks.fetchBlob.mockResolvedValueOnce(blob); mocks.share.mockResolvedValueOnce('downloaded');
    expect(await saveImageToDevice('https://image.example/a.gif')).toBe('downloaded');
    expect(mocks.share).toHaveBeenCalledWith(expect.objectContaining({ blob, fileName: expect.stringMatching(/\.gif$/), preferDownloadOnWeb: true }));
    expect(mocks.save).not.toHaveBeenCalled();
});
