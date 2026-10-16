import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { blobToDataUrl, dataUrlToBlob, getBlobForRef, isBlobRef, resolveRefToDataUrl } from './blobRef';

export interface ImageReference {
    id: string;
    name: string;
    description: string;
    imageRef: string;
}
export interface ImageGenerationConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
    size: string;
    quality: 'auto' | 'low' | 'medium' | 'high';
    references: ImageReference[];
}
export const DEFAULT_IMAGE_CONFIG: ImageGenerationConfig = {
    baseUrl: 'https://api.sunflowerllm.com', apiKey: '', model: '[0.15]gpt-image-2.5-sunburst',
    size: '1024x1024', quality: 'medium', references: [],
};
export const IMAGE_TOOL_NAME = 'generate_image';
export const IMAGE_GENERATION_GUIDE = `【聊天生图】

一、生图时机

用户请求画图或生成图片时，结合当前对话调用 generate_image。信息足够就直接画，缺少影响结果的关键信息时再简短询问。

二、参考图使用

读取已保存的参考图，按画面中的人物选取 reference_ids，并在 prompt 中写明每张参考图对应谁。

人物图默认参考长相；服装、动作、构图与画风依照本次要求及参考图备注。

三、画面提示词

将 prompt 写成一段可独立理解的画面描述，包含：
- 人物及其与参考图的对应关系。
- 动作、表情和相对位置。
- 场景，以及本次画面需要的服饰、构图与画风。

保留用户指定的内容，未指定的细节结合对话自然补足。

画风默认采用平涂日系二次元风格；用户另有指定时，以用户要求为准。

四、调用与回复

工具自动附上所选原图，尺寸与画质沿用用户设置，每轮最多生成一张。

只有工具返回成功后才说图片已生成；失败时简短说明。`;
export const IMAGE_GENERATION_TOOL = {
    type: 'function', function: {
        name: IMAGE_TOOL_NAME,
        description: '根据画面描述及已保存的人物参考图生成一张图片，结果自动发送到当前聊天并保存到相册。',
        parameters: {
            type: 'object', properties: {
                prompt: { type: 'string', description: '完整画面描述，按选中参考图的顺序说明对应人物及参考用途。' },
                reference_ids: { type: 'array', items: { type: 'string' }, description: '画面所需的已保存参考图 ID，按在提示词中使用的顺序排列；不需要参考图时为空。' },
            }, required: ['prompt', 'reference_ids'], additionalProperties: false,
        },
    },
};
export function normalizeImageConfig(value?: Partial<ImageGenerationConfig>): ImageGenerationConfig {
    return {
        ...DEFAULT_IMAGE_CONFIG, ...value,
        baseUrl: (value?.baseUrl ?? DEFAULT_IMAGE_CONFIG.baseUrl).trim().replace(/\/+$/, ''),
        apiKey: (value?.apiKey ?? '').trim(),
        model: (value?.model ?? DEFAULT_IMAGE_CONFIG.model).trim(),
        references: Array.isArray(value?.references) ? value.references : [],
    };
}
export function imageEndpoint(baseUrl: string, withReferences: boolean): string {
    const root = baseUrl.trim().replace(/\/+$/, '').replace(/\/images\/(?:generations|edits)$/, '');
    const url = new URL(root);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error('生图 API 地址应为 HTTP(S) 基础地址');
    }
    return `${root.endsWith('/v1') ? root : `${root}/v1`}/images/${withReferences ? 'edits' : 'generations'}`;
}
export function validateImageConfig(config: ImageGenerationConfig): void {
    imageEndpoint(config.baseUrl, false);
    if (!config.apiKey || !config.model) throw new Error('请先填写生图 API Key 和模型名称');
    if (!['auto', 'low', 'medium', 'high'].includes(config.quality)) throw new Error('请选择有效的图片质量');
    if (!/^\d+x\d+$/.test(config.size)) throw new Error('图片尺寸格式应为 1024x1024');
    const [w, h] = config.size.split('x').map(Number);
    if (Math.min(w, h) < 256 || Math.max(w, h) > 3840 || w % 16 || h % 16 || Math.max(w, h) / Math.min(w, h) > 3) {
        throw new Error('图片尺寸须为 16 的倍数，边长不超过 3840，长宽比不超过 3:1');
    }
    if (config.references.length > 16) throw new Error('最多保存 16 张人物参考图');
    if (new Set(config.references.map(r => r.id)).size !== config.references.length) throw new Error('参考图 ID 重复，请重新添加');
    if (config.references.some(r => !r.name.trim() || !r.imageRef)) throw new Error('请为每张参考图填写人物名称并上传图片');
}

/** Disabled is an early return: no image lookup, tool guide or media part is produced. */
export async function prepareImageGenerationContext(enabled: boolean, value?: ImageGenerationConfig) {
    if (!enabled) return null;
    const config = normalizeImageConfig(value);
    validateImageConfig(config);
    const references = config.references.map(r => ({ ...r }));
    const content: any[] = [{ type: 'text', text: '本轮可用的生图人物参考（仅供生成画面使用）：' }];
    for (const ref of references) {
        const dataUrl = await resolveRefToDataUrl(ref.imageRef);
        if (!/^data:image\/(png|jpeg|webp);base64,/i.test(dataUrl)) throw new Error(`参考图「${ref.name}」不可用，请重新上传`);
        content.push({ type: 'text', text: `参考图 ID：${ref.id}；人物：${ref.name}；备注：${ref.description || '参考人物长相'}` });
        content.push({ type: 'image_url', image_url: { url: dataUrl } });
    }
    return { config: { ...config, references }, guide: IMAGE_GENERATION_GUIDE, referenceMessage: references.length ? { role: 'user', content } : null };
}

function abortCheck(signal?: AbortSignal) { signal?.throwIfAborted(); }
async function readReference(ref: ImageReference): Promise<Blob> {
    const blob = isBlobRef(ref.imageRef) ? await getBlobForRef(ref.imageRef)
        : ref.imageRef.startsWith('data:') ? dataUrlToBlob(ref.imageRef) : null;
    if (!blob || !['image/png', 'image/jpeg', 'image/webp'].includes(blob.type) || blob.size > 20 * 1024 * 1024) {
        throw new Error(`参考图「${ref.name}」不可用或超过 20MB，请重新上传`);
    }
    return blob;
}
export interface GeneratedImage { blob: Blob; costUsd?: number; }
export async function generateImage(config: ImageGenerationConfig, args: unknown, signal?: AbortSignal): Promise<GeneratedImage> {
    validateImageConfig(config);
    const input = args as { prompt?: unknown; reference_ids?: unknown };
    if (typeof input?.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 32000) throw new Error('生图提示词为空或过长');
    if (!Array.isArray(input.reference_ids) || input.reference_ids.some(id => typeof id !== 'string')) throw new Error('生图参考图列表格式错误');
    const ids = [...new Set(input.reference_ids as string[])];
    const refs = ids.map(id => {
        const ref = config.references.find(r => r.id === id);
        if (!ref) throw new Error('请求使用了未保存的参考图，请重新选择');
        return ref;
    });
    abortCheck(signal);
    const blobs = await Promise.all(refs.map(readReference));
    abortCheck(signal);
    const legend = refs.map((r, i) => `参考图${i + 1}：${r.name}。${r.description || '参考人物长相。'}`).join('\n');
    const fields = { model: config.model, prompt: [legend, input.prompt.trim()].filter(Boolean).join('\n\n'), size: config.size, quality: config.quality, n: 1, stream: false };
    const url = imageEndpoint(config.baseUrl, refs.length > 0);
    // Paid requests are sent once. Never retry with references removed or a different model.
    const controller = new AbortController();
    const cancel = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('生图等待超过 5 分钟，请检查渠道记录后再决定是否重试')), 300_000);
    try {
        let data: any;
        let status: number;
        const headers: Record<string, string> = { Authorization: `Bearer ${config.apiKey}` };
        if (Capacitor.isNativePlatform()) {
            let body: any = fields;
            let dataType: 'formData' | undefined;
            headers['Content-Type'] = 'application/json';
            if (blobs.length) {
                headers['Content-Type'] = `multipart/form-data; boundary=Nuomi${crypto.randomUUID().replace(/-/g, '')}`;
                dataType = 'formData';
                body = Object.entries(fields).map(([key, value]) => ({ key, value: String(value), type: 'string' }));
                for (let i = 0; i < blobs.length; i++) body.push({
                    key: 'image[]', type: 'base64File', value: (await blobToDataUrl(blobs[i])).split(',')[1],
                    fileName: `reference-${i + 1}.${blobs[i].type === 'image/jpeg' ? 'jpg' : blobs[i].type.split('/')[1]}`, contentType: blobs[i].type,
                });
            }
            abortCheck(controller.signal);
            const response = await CapacitorHttp.request({ url, method: 'POST', headers, data: body, dataType, responseType: 'json', connectTimeout: 30_000, readTimeout: 300_000, disableRedirects: true });
            status = response.status; data = response.data;
        } else {
            let body: BodyInit;
            if (blobs.length) {
                const form = new FormData();
                Object.entries(fields).forEach(([key, value]) => form.append(key, String(value)));
                blobs.forEach((blob, i) => form.append('image[]', blob, `reference-${i + 1}.${blob.type === 'image/jpeg' ? 'jpg' : blob.type.split('/')[1]}`));
                body = form;
            } else { headers['Content-Type'] = 'application/json'; body = JSON.stringify(fields); }
            const response = await fetch(url, { method: 'POST', headers, body, signal: controller.signal, redirect: 'error' });
            status = response.status;
            try { data = await response.json(); } catch { throw new Error(`生图接口未返回 JSON（HTTP ${status}），请检查 API 地址`); }
        }
        abortCheck(controller.signal);
        if (typeof data === 'string') { try { data = JSON.parse(data); } catch { throw new Error('生图接口未返回有效 JSON'); } }
        if (status < 200 || status >= 300 || data?.error) {
            const detail = String(data?.error?.message || data?.message || `HTTP ${status}`).replaceAll(config.apiKey, '[已隐藏]').slice(0, 350);
            throw new Error(`生图失败：${detail}${refs.length && status === 404 ? '。当前渠道未提供标准带图接口 /v1/images/edits' : ''}`);
        }
        const item = data?.data?.[0];
        let blob: Blob;
        if (typeof item?.b64_json === 'string' && item.b64_json) {
            const mime = item.media_type || (data.output_format === 'jpeg' ? 'image/jpeg' : data.output_format === 'webp' ? 'image/webp' : 'image/png');
            blob = dataUrlToBlob(`data:${mime};base64,${item.b64_json}`);
        } else if (typeof item?.url === 'string' && /^https?:\/\//i.test(item.url)) {
            if (Capacitor.isNativePlatform()) {
                const response = await CapacitorHttp.request({ url: item.url, method: 'GET', responseType: 'blob', readTimeout: 60_000 });
                if (response.status < 200 || response.status >= 300) throw new Error('图片已生成，但下载失败，请查看渠道记录');
                const mime = Object.entries(response.headers || {}).find(([key]) => key.toLowerCase() === 'content-type')?.[1] || 'image/png';
                blob = dataUrlToBlob(`data:${mime};base64,${response.data}`);
            } else {
                const response = await fetch(item.url, { signal: controller.signal });
                if (!response.ok) throw new Error('图片已生成，但下载失败，请查看渠道记录');
                blob = await response.blob();
            }
        } else throw new Error('生图接口没有返回图片');
        abortCheck(controller.signal);
        if (!blob.size || !['image/png', 'image/jpeg', 'image/webp'].includes(blob.type)) throw new Error('生图接口返回了无效的图片数据');
        return { blob, costUsd: typeof data?.usage?.cost === 'number' && Number.isFinite(data.usage.cost) ? data.usage.cost : undefined };
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}

/** One paid attempt per reply, shared by all tool loops (including repeated tool calls). */
export function createImageGenerationSession(
    config: ImageGenerationConfig,
    save: (result: GeneratedImage, prompt: string, referenceIds: string[]) => Promise<void>,
    signal?: AbortSignal,
) {
    let attempted = false;
    return async (args: unknown): Promise<string> => {
        abortCheck(signal);
        if (attempted) return '本轮已经提交过生图请求，请根据已有结果回复。需要再画一张时由用户发起新一轮。';
        attempted = true;
        try {
            const result = await generateImage(config, args, signal);
            abortCheck(signal);
            const input = args as { prompt: string; reference_ids: string[] };
            await save(result, input.prompt, input.reference_ids);
            abortCheck(signal);
            return '图片已生成并发送到当前聊天。请自然接话。';
        } catch (e: any) {
            abortCheck(signal);
            return `图片未能完成发送：${String(e?.message || '请求失败').replaceAll(config.apiKey, '[已隐藏]')}。本轮不自动重试。请如实简短说明。`;
        }
    };
}
