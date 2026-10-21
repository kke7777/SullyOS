import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { imageEndpoint, ImageGenerationConfig } from './imageGeneration';
import { extractModelIds } from './modelList';

/** List models with the image API credentials, without starting a generation. */
export async function fetchImageModels(config: Pick<ImageGenerationConfig, 'baseUrl' | 'apiKey' | 'apiType'>, signal?: AbortSignal): Promise<string[]> {
    if (!config.baseUrl.trim()) throw new Error('请先填写生图 API 地址');
    if (!config.apiKey.trim()) throw new Error('请先填写生图 API Key');
    let url: string;
    try {
        const endpoint = imageEndpoint(config.baseUrl, false, config.apiType);
        url = config.apiType === 'openrouter' ? `${endpoint}/models` : endpoint.replace(/\/images\/generations$/, '/models');
    }
    catch { throw new Error('请填写有效的生图 API 地址'); }
    signal?.throwIfAborted();
    const controller = new AbortController();
    const cancel = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
        const headers = { Authorization: `Bearer ${config.apiKey.trim()}`, Accept: 'application/json' };
        let status: number;
        let data: unknown;
        if (Capacitor.isNativePlatform()) {
            const response = await CapacitorHttp.request({ url, method: 'GET', headers, responseType: 'json', connectTimeout: 30_000, readTimeout: 30_000, disableRedirects: true });
            status = response.status;
            data = response.data;
        } else {
            const response = await fetch(url, { method: 'GET', headers, signal: controller.signal, redirect: 'error' });
            status = response.status;
            if (status >= 200 && status < 300) data = await response.text();
        }
        signal?.throwIfAborted();
        controller.signal.throwIfAborted();
        if (status === 401 || status === 403) throw new Error(`模型拉取失败（HTTP ${status}），请检查生图 Key 和渠道权限`);
        if (status === 404 || status === 405) throw new Error(`渠道未提供模型列表（HTTP ${status}），请检查地址或手动填写模型`);
        if (status < 200 || status >= 300) throw new Error(`模型拉取失败（HTTP ${status}），可稍后重试或手动填写`);
        if (typeof data === 'string') {
            try { data = JSON.parse(data); }
            catch { throw new Error('渠道未返回有效的模型列表，可手动填写模型'); }
        }
        const models = extractModelIds(data);
        if (!models.length) throw new Error('模型列表为空或格式不兼容，可手动填写模型');
        return models;
    } catch (error) {
        signal?.throwIfAborted();
        if (controller.signal.aborted) throw new Error('拉取模型超时，请检查网络后重试');
        // Do not reflect native transport errors or server bodies: they may contain credentials.
        if (error instanceof Error && /^(模型|渠道)/.test(error.message)) throw error;
        throw new Error('连接失败，请检查生图地址、网络及渠道跨域设置，或手动填写模型');
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
    }
}
