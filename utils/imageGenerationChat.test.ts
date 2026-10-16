// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { DB } from './db';
import { useChatAI } from '../hooks/useChatAI';
import { safeFetchJson } from './safeApi';
import { DEFAULT_IMAGE_CONFIG, IMAGE_TOOL_NAME } from './imageGeneration';

vi.mock('../context/MusicContext', () => ({ useMusic: () => ({}), loadMusicHooks: () => null }));
vi.mock('./keepAlive', () => ({ KeepAlive: { start: vi.fn(), stop: vi.fn() } }));
vi.mock('./safeApi', async original => ({ ...await original<typeof import('./safeApi')>(), safeFetchJson: vi.fn() }));
vi.mock('./applyAssistantPostProcessing', () => ({ applyAssistantPostProcessing: vi.fn(async () => ({})) }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF9sAAAAASUVORK5CYII=';
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

it.each(['openai', 'openrouter'] as const)('runs the real %s chat tool loop, publishes an image and gallery reference, then excludes the feature when disabled', async apiType => {
    const char: any = { id: `image-integration-${apiType}`, name: '露露', chatImageGenerationEnabled: true, emotionConfig: { enabled: false } };
    const imageRef = `data:image/png;base64,${png}`;
    const imageConfig = { ...DEFAULT_IMAGE_CONFIG, apiType, ...(apiType === 'openrouter' ? { baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-image-2.5-sunburst' } : {}), apiKey: 'image-private', references: [
        { id: 'loulou', name: '露露', description: '仅参考长相', imageRef },
        { id: 'saki', name: '咲咲', description: '仅参考长相', imageRef },
    ] };
    const apiConfig: any = { baseUrl: 'https://chat.test/v1', apiKey: 'chat-private', model: 'chat-model', imageGeneration: imageConfig };
    await DB.saveMessage({ charId: char.id, role: 'user', type: 'text', content: '画露露抱着咲咲' });
    let current!: ReturnType<typeof useChatAI>;
    const toast = vi.fn();
    function Probe({ value }: { value: any }) {
        current = useChatAI({ char: value, apiConfig, userProfile: { name: '咲咲' } as any,
            groups: [], emojis: [], categories: [], realtimeConfig: {} as any, addToast: toast,
            setMessages: vi.fn(), updateCharacter: vi.fn(), updateUserProfile: vi.fn() });
        return null;
    }
    vi.mocked(safeFetchJson).mockResolvedValueOnce({ choices: [{ message: { content: '', tool_calls: [
        { id: 'image-call', type: 'function', function: { name: IMAGE_TOOL_NAME, arguments: JSON.stringify({ prompt: '两个人在沙发上拥抱', reference_ids: ['loulou', 'saki'] }) } },
    ] } }] }).mockResolvedValue({ choices: [{ message: { content: '画好啦' } }] });
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, json: async () => ({ data: [{ b64_json: png }], usage: { cost: 0.06 } }) })));
    const root = createRoot(document.createElement('div'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
        await act(async () => { root.render(createElement(Probe, { value: char })); });
        await act(async () => { await current.triggerAI([]); });
        const calls = vi.mocked(safeFetchJson).mock.calls;
        expect(calls.length, errors.mock.calls.flat().map(String).join('\n') + JSON.stringify(toast.mock.calls) + JSON.stringify(await DB.getRecentMessagesByCharId(char.id, 200))).toBe(2);
        const first = JSON.parse(calls[0][1]!.body as string);
        expect(first.tools.some((t: any) => t.function?.name === IMAGE_TOOL_NAME)).toBe(true);
        expect(JSON.stringify(first.messages)).toContain('参考图 ID：loulou');
        expect(first.messages.some((m: any) => Array.isArray(m.content) && m.content.filter((p: any) => p.type === 'image_url').length === 2)).toBe(true);
        const second = JSON.parse(calls[1][1]!.body as string);
        expect(second.messages.some((m: any) => m.role === 'tool' && m.content.includes('图片已生成'))).toBe(true);
        expect(fetch).toHaveBeenCalledTimes(1);
        const messages = await DB.getRecentMessagesByCharId(char.id, 200);
        const image = messages.find(m => m.type === 'image')!;
        expect(image.content).toMatch(/^blobref:/);
        expect(image.metadata.imageGeneration.costUsd).toBe(0.06);
        const gallery = await DB.getGalleryImages(char.id);
        expect(gallery.find(g => g.sourceMessageId === image.id)?.url).toBe(image.content);
        // Reference media are never written to chat history; only the generated result is.
        expect(messages.filter(m => m.type === 'image')).toHaveLength(1);
        expect(messages.some(m => m.content.includes('参考图 ID'))).toBe(false);

        vi.mocked(safeFetchJson).mockClear(); vi.mocked(fetch).mockClear();
        await act(async () => { root.render(createElement(Probe, { value: { ...char, chatImageGenerationEnabled: false } })); });
        await DB.saveMessage({ charId: char.id, role: 'user', type: 'text', content: '继续聊天' });
        await act(async () => { await current.triggerAI([]); });
        const disabled = JSON.parse(vi.mocked(safeFetchJson).mock.calls[0][1]!.body as string);
        expect(JSON.stringify(disabled.messages)).not.toContain('参考图 ID');
        expect(JSON.stringify(disabled.messages)).not.toContain('【聊天生图】');
        expect((disabled.tools || []).some((t: any) => t.function?.name === IMAGE_TOOL_NAME)).toBe(false);
        expect(fetch).not.toHaveBeenCalled();
    } finally { act(() => root.unmount()); errors.mockRestore(); }
});
