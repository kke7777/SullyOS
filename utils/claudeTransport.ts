/** Opt-in transport: a saved URL ending in /messages selects Claude native + 5m caching.
 * Keeping the selection in the endpoint preserves existing preset/backup/credential contracts.
 * All OpenAI-shaped callers keep their internal format; only the network boundary translates.
 */
import { clampClaudeTemperature, modelRejectsSamplingParams, stripSamplingParams } from './samplingParamCompat';

type Obj = Record<string, any>;
const CACHE = { type: 'ephemeral' };
export const isClaudeNativeUrl = (url: string): boolean => /\/messages(?:\/(?:chat\/completions|models))?\/*$/i.test(url);
export function selectClaudeEndpoint(url: string, native: boolean): string {
    const base = url.trim().replace(/\/+$/, '').replace(/\/(?:chat\/completions|messages)$/i, '');
    return native && base ? `${base}/messages` : base;
}

function inlineSystemSupported(model: string): boolean {
    return /(?:opus[-.]?(?:5(?:[-.]5)?|4[-.]8)|sonnet[-.]5[-.]5|haiku[-.]5[-.]5|fable[-.]5|mythos[-.]5)(?:\b|[-.])/i.test(model);
}
function contentBlocks(content: any): Obj[] {
    if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
    if (content == null) return [];
    if (!Array.isArray(content)) throw new Error('Claude 原生接口收到无法识别的消息内容');
    return content.map((part: Obj) => {
        if (part.type === 'text') return { type: 'text', text: String(part.text ?? '') };
        if (part.type === 'image_url') {
            const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
            if (typeof url !== 'string') throw new Error('Claude 图片缺少地址');
            const data = /^data:([^;,]+);base64,([\s\S]+)$/.exec(url);
            return { type: 'image', source: data
                ? { type: 'base64', media_type: data[1], data: data[2] }
                : { type: 'url', url } };
        }
        if (['image', 'tool_result', 'tool_use', 'thinking', 'redacted_thinking'].includes(part.type)) {
            const { cache_control: _cache, ...block } = part;
            return block;
        }
        throw new Error(`Claude 原生接口暂不支持消息片段：${part.type}`);
    }).filter((p: Obj) => p.type !== 'text' || p.text.length > 0);
}
const mark = (blocks: Obj[]) => {
    const b = [...blocks].reverse().find(b => b.type !== 'thinking' && b.type !== 'redacted_thinking');
    if (b) b.cache_control = { ...CACHE };
};

export function buildClaudeRequest(input: Obj): Obj {
    if (!Array.isArray(input.messages)) throw new Error('Claude 原生请求缺少 messages');
    const source = input.messages as Obj[];
    const system: Obj[] = [];
    const messages: Obj[] = [];
    // Native inline system sections have placement rules. Older models and unusual
    // worldbook layouts use the same system hoisting as Anthropic's compatibility API.
    const laterSystems = source.some((m, i) => ['system', 'developer'].includes(m.role)
        && source.slice(0, i).some(p => !['system', 'developer'].includes(p.role)));
    const inline = inlineSystemSupported(input.model || '') && source.every((m, i) => {
        if (!['system', 'developer'].includes(m.role)) return true;
        let before = i - 1, after = i + 1;
        while (before >= 0 && ['system', 'developer'].includes(source[before].role)) before--;
        while (after < source.length && ['system', 'developer'].includes(source[after].role)) after++;
        return before < 0 || (['user', 'tool'].includes(source[before].role)
            && (after === source.length || source[after].role === 'assistant'));
    });
    let seenDialogue = false;
    let historyBreakpoint: Obj[] | undefined;
    let foundLiveSection = false;
    for (const m of source) {
        const isSystem = ['system', 'developer'].includes(m.role);
        if (isSystem && (!seenDialogue || !inline)) {
            const blocks = contentBlocks(m.content);
            // Always write the stable opening system prefix independently of live state.
            if (!seenDialogue && blocks.length) mark(blocks);
            system.push(...blocks);
            continue;
        }
        seenDialogue = true;
        if (isSystem) foundLiveSection = true;
        let role = isSystem ? 'system' : m.role === 'tool' ? 'user' : m.role;
        if (!['system', 'user', 'assistant'].includes(role)) throw new Error(`Claude 不支持消息角色：${role}`);
        let blocks = m.role === 'tool'
            ? [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: contentBlocks(m.content) }]
            : contentBlocks(m.content);
        if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
            const thinking = m.tool_calls[0]?.__claude_thinking;
            if (Array.isArray(thinking)) blocks = [...thinking, ...blocks];
            blocks.push(...m.tool_calls.map((tc: Obj) => ({
                type: 'tool_use', id: tc.id, name: tc.function.name,
                input: typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments || '{}') : tc.function.arguments || {},
            })));
        }
        if (!blocks.length) continue;
        const previous = messages[messages.length - 1];
        if (previous?.role === role) previous.content.push(...blocks);
        else messages.push({ role, content: blocks });
        if (!foundLiveSection && role !== 'system') historyBreakpoint = messages[messages.length - 1].content;
    }
    // Keep within the four-breakpoint limit even for multiple leading system messages.
    let markedSystem = false;
    for (const block of system) {
        if (block.cache_control && !markedSystem) markedSystem = true;
        else delete block.cache_control;
    }
    if ((!laterSystems || inline) && historyBreakpoint) mark(historyBreakpoint);
    const body: Obj = { model: input.model, max_tokens: input.max_tokens ?? 8000,
        messages, ...(system.length ? { system } : {}), stream: input.stream === true };
    if (Array.isArray(input.tools) && input.tools.length) {
        body.tools = input.tools.map((t: Obj) => ({ name: t.function?.name ?? t.name,
            description: t.function?.description ?? t.description,
            input_schema: t.function?.parameters ?? t.input_schema ?? { type: 'object', properties: {} } }));
        if (!markedSystem) body.tools[body.tools.length - 1].cache_control = { ...CACHE };
        const choice = input.tool_choice;
        body.tool_choice = choice?.type === 'function' ? { type: 'tool', name: choice.function.name }
            : { type: choice === 'required' ? 'any' : choice === 'none' ? 'none' : 'auto' };
    }
    if (input.thinking?.type === 'enabled' || input.thinking?.type === 'adaptive') {
        body.thinking = inlineSystemSupported(input.model || '') ? { type: 'adaptive' } : { ...input.thinking };
        if (body.thinking.type === 'adaptive' && ['low', 'medium', 'high', 'max'].includes(input.reasoning_effort)) {
            body.output_config = { effort: input.reasoning_effort };
        }
        if (body.thinking.type === 'enabled') body.thinking.budget_tokens = Math.min(body.thinking.budget_tokens ?? 4000, body.max_tokens - 1);
    } else if (typeof input.temperature === 'number') body.temperature = input.temperature;
    if (input.stop) body.stop_sequences = Array.isArray(input.stop) ? input.stop : [input.stop];
    clampClaudeTemperature(body);
    if (modelRejectsSamplingParams(body.model)) stripSamplingParams(body);
    return body;
}

export function claudeUsage(usage: Obj = {}): Obj {
    const regular = usage.input_tokens ?? 0;
    const read = usage.cache_read_input_tokens ?? 0;
    const write = usage.cache_creation_input_tokens ?? 0;
    const output = usage.output_tokens ?? 0;
    return { ...usage, prompt_tokens: regular + read + write, completion_tokens: output,
        total_tokens: regular + read + write + output,
        prompt_tokens_details: { cached_tokens: read }, cache_read_input_tokens: read, cache_creation_input_tokens: write };
}
const finishReason = (reason: string) => reason === 'tool_use' ? 'tool_calls' : reason === 'max_tokens' ? 'length' : 'stop';
export function claudeCompletion(data: Obj): Obj {
    if (data.type === 'error') throw new Error(data.error?.message || 'Claude 返回错误');
    if (!Array.isArray(data.content)) throw new Error('Claude 原生接口未返回有效的 content');
    const thinking = data.content.filter((b: Obj) => ['thinking', 'redacted_thinking'].includes(b.type));
    const calls = data.content.filter((b: Obj) => b.type === 'tool_use').map((b: Obj, i: number) => ({
        id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input) },
        ...(i === 0 && thinking.length ? { __claude_thinking: thinking } : {}),
    }));
    return { id: data.id, model: data.model, object: 'chat.completion', usage: claudeUsage(data.usage),
        choices: [{ index: 0, finish_reason: finishReason(data.stop_reason), message: {
            role: 'assistant', content: data.content.filter((b: Obj) => b.type === 'text').map((b: Obj) => b.text).join(''),
            ...(thinking.length ? { reasoning_content: thinking.map((b: Obj) => b.thinking || '').join('') } : {}),
            ...(calls.length ? { tool_calls: calls } : {}),
        } }] };
}

/** Convert native SSE incrementally, including tool JSON fragments and late output usage.
 * Terminal finish_reason is emitted only at message_stop, after message_delta usage.
 */
function nativeStream(response: Response): Response {
    if (!response.body) return response;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let pending = '', id = '', model = '', reason = 'end_turn';
    let usage: Obj = {}, toolIndex = 0;
    const tools = new Map<number, number>();
    const thoughts = new Map<number, Obj>();
    let ended = false;
    const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
            let emitted = false;
            const emit = (delta: Obj, final = false) => { emitted = true; controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                id, model, object: 'chat.completion.chunk',
                choices: [{ index: 0, delta, finish_reason: final ? finishReason(reason) : null }],
                ...(final ? { usage: claudeUsage(usage) } : {}),
            })}\n\n`)); };
            const line = (raw: string) => {
                if (!raw.startsWith('data:')) return;
                const text = raw.slice(5).trim();
                if (!text || text === '[DONE]') return;
                const e = JSON.parse(text);
                if (e.type === 'error') throw new Error(e.error?.message || 'Claude 流式响应错误');
                if (e.type === 'message_start') {
                    id = e.message.id; model = e.message.model; usage = { ...e.message.usage }; emit({ role: 'assistant' });
                } else if (e.type === 'content_block_start') {
                    const b = e.content_block;
                    if (b.type === 'tool_use') {
                        const index = toolIndex++; tools.set(e.index, index);
                        emit({ tool_calls: [{ index, id: b.id, type: 'function', function: { name: b.name, arguments: '' } }] });
                    } else if (b.type === 'thinking' || b.type === 'redacted_thinking') thoughts.set(e.index, { ...b });
                    else if (b.type === 'text' && b.text) emit({ content: b.text });
                } else if (e.type === 'content_block_delta') {
                    const d = e.delta;
                    if (d.type === 'text_delta') emit({ content: d.text });
                    else if (d.type === 'thinking_delta') {
                        const t = thoughts.get(e.index); if (t) t.thinking = (t.thinking || '') + d.thinking;
                        emit({ reasoning_content: d.thinking });
                    } else if (d.type === 'signature_delta') {
                        const t = thoughts.get(e.index); if (t) t.signature = (t.signature || '') + d.signature;
                    } else if (d.type === 'input_json_delta') emit({ tool_calls: [{ index: tools.get(e.index), function: { arguments: d.partial_json } }] });
                } else if (e.type === 'message_delta') {
                    usage = { ...usage, ...e.usage }; reason = e.delta?.stop_reason || reason;
                } else if (e.type === 'message_stop') {
                    if (thoughts.size) emit({ __claude_thinking: [...thoughts.values()] });
                    emit({}, true); ended = true;
                }
            };
            try {
                while (!ended) {
                    const next = await reader.read();
                    pending += next.done ? decoder.decode() : decoder.decode(next.value, { stream: true });
                    const lines = pending.split('\n'); pending = lines.pop() || '';
                    for (const raw of lines) line(raw.replace(/\r$/, ''));
                    if (next.done) {
                        if (pending) line(pending);
                        if (!ended) throw new Error('Claude 流式响应提前中断，请检查本次调用记录');
                    }
                    if (emitted) break;
                }
                if (ended) { controller.close(); await reader.cancel(); }
            } catch (error) { controller.error(error); await reader.cancel().catch(() => {}); }
        },
        cancel(reason) { return reader.cancel(reason); },
    });
    const headers = new Headers(response.headers);
    headers.delete('content-length'); headers.delete('content-encoding');
    headers.set('content-type', 'text/event-stream');
    return new Response(stream, { status: response.status, statusText: response.statusText, headers });
}

/** No retries and no global mutation. Non-native requests pass through unchanged. */
export async function fetchWithClaudeTransport(fetchImpl: typeof fetch, resource: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof resource === 'string' ? resource : resource instanceof URL ? resource.href : resource.url;
    if (!isClaudeNativeUrl(url)) return fetchImpl(resource, init);
    const method = (init?.method || (resource instanceof Request ? resource.method : 'GET')).toUpperCase();
    const headers = new Headers(init?.headers || (resource instanceof Request ? resource.headers : undefined));
    const key = headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (key && !headers.has('x-api-key')) headers.set('x-api-key', key);
    headers.delete('authorization'); headers.set('anthropic-version', '2023-06-01');
    // Native direct calls from a browser need Anthropic's explicit browser opt-in.
    if (new URL(url).hostname === 'api.anthropic.com') headers.set('anthropic-dangerous-direct-browser-access', 'true');
    if (/\/messages\/models\/*$/i.test(url)) return fetchImpl(url.replace(/\/messages\/models\/*$/i, '/models'), { ...init, headers });
    if (method !== 'POST') return fetchImpl(resource, init);
    const raw = init?.body ?? (resource instanceof Request ? await resource.clone().text() : undefined);
    if (typeof raw !== 'string') throw new Error('Claude 原生请求体必须是 JSON');
    const input = JSON.parse(raw);
    // Internal callers always carry OpenAI-shaped messages, even for a native endpoint.
    const body = buildClaudeRequest(input);
    const response = await fetchImpl(url.replace(/\/chat\/completions\/*$/i, ''), { ...init, method, headers, body: JSON.stringify(body) });
    if (!response.ok) return response;
    if (response.headers.get('content-type')?.includes('text/event-stream')) return nativeStream(response);
    const data = claudeCompletion(await response.json());
    const outputHeaders = new Headers(response.headers);
    outputHeaders.delete('content-length'); outputHeaders.delete('content-encoding'); outputHeaders.set('content-type', 'application/json');
    return new Response(JSON.stringify(data), { status: response.status, statusText: response.statusText, headers: outputHeaders });
}
