import { describe, expect, it, vi } from 'vitest';
import { buildClaudeRequest, claudeCompletion, fetchWithClaudeTransport, selectClaudeEndpoint } from './claudeTransport';
import { parseSseToCompletion } from './safeApi';
import { extractApiTokenUsage, recordApiCall, buildApiRequestCapture, getApiRequestCaptureSectionContent } from './apiCallLog';
import { DB } from './db';

const messages = [
    { role: 'system', content: 'stable persona and rules' },
    { role: 'user', content: '你好' },
    { role: 'system', content: 'live time 12:00' },
];
const request = (patch = {}) => ({ model: 'claude-opus-5-5', messages, max_tokens: 8000, ...patch });
const native = { type: 'message', id: 'msg_a', model: 'claude-opus-5-5', stop_reason: 'end_turn',
    content: [{ type: 'text', text: '你好呀' }],
    usage: { input_tokens: 20, output_tokens: 10, cache_read_input_tokens: 2000, cache_creation_input_tokens: 100 } };

describe('Claude native transport', () => {
    it('opts in via the saved native endpoint and round trips the selector', () => {
        expect(selectClaudeEndpoint('https://relay.test/v1/', true)).toBe('https://relay.test/v1/messages');
        expect(selectClaudeEndpoint('https://relay.test/v1/messages', false)).toBe('https://relay.test/v1');
    });
    it('writes stable system and history before the changing live suffix; does not mutate callers', () => {
        const input = request(); const before = JSON.stringify(input);
        const body = buildClaudeRequest(input);
        expect(body.system).toEqual([{ type: 'text', text: messages[0].content, cache_control: { type: 'ephemeral', ttl: '1h' } }]);
        expect(body.messages).toEqual([
            { role: 'user', content: [{ type: 'text', text: '你好', cache_control: { type: 'ephemeral', ttl: '1h' } }] },
            { role: 'system', content: [{ type: 'text', text: 'live time 12:00' }] },
        ]);
        const later = buildClaudeRequest(request({ messages: [messages[0], messages[1],
            { role: 'assistant', content: '旧回复' }, { role: 'user', content: '新消息' },
            { role: 'system', content: 'live time 12:01' }] }));
        expect(later.system).toEqual(body.system);
        expect(later.messages[0].content[0].text).toBe(body.messages[0].content[0].text);
        expect(JSON.stringify(input)).toBe(before);
    });
    it('keeps older model system authority and caches stable instructions independently', () => {
        const body = buildClaudeRequest(request({ model: 'claude-sonnet-4-6' }));
        expect(body.system.map((b: any) => b.text)).toEqual([messages[0].content, messages[2].content]);
        expect(body.system[0].cache_control).toBeDefined();
        expect(body.system[1].cache_control).toBeUndefined();
        expect(body.messages.some((m: any) => m.role === 'system')).toBe(false);
    });
    it('converts images, parallel tool results and signed thinking replay', () => {
        const thinking = [{ type: 'thinking', thinking: '分析', signature: 'signed' }];
        const body = buildClaudeRequest(request({ thinking: { type: 'enabled', budget_tokens: 4000 }, temperature: .85,
            tools: [{ type: 'function', function: { name: 'schedule', parameters: { type: 'object' } } }],
            messages: [messages[0], { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,YQ==' } }] },
                { role: 'assistant', content: '', tool_calls: ['a', 'b'].map(id => ({ id, function: { name: 'schedule', arguments: '{"x":1}' }, __claude_thinking: thinking })) },
                ...['a', 'b'].map(id => ({ role: 'tool', tool_call_id: id, content: 'done' }))] }));
        expect(body.messages[0].content[0].source).toEqual({ type: 'base64', media_type: 'image/png', data: 'YQ==' });
        expect(body.messages[1].content[0]).toEqual(thinking[0]);
        expect(body.messages[2].content.map((b: any) => b.tool_use_id)).toEqual(['a', 'b']);
        expect(body.tools[0].input_schema).toEqual({ type: 'object' });
        expect(body.temperature).toBeUndefined();
        expect(body.thinking).toEqual({ type: 'adaptive' });
    });
    it('counts regular, cache reads and cache writes once in input totals', () => {
        const data = claudeCompletion(native);
        expect(extractApiTokenUsage(data)).toEqual({ prompt: 2120, completion: 10, total: 2130, cacheRead: 2000, cacheWrite: 100 });
    });
    it('records cache counts in the persisted API log and captures the real top-level system', async () => {
        const save = vi.spyOn(DB, 'appendApiCallLog').mockResolvedValue();
        recordApiCall({ url: 'https://relay.test/v1/messages/chat/completions', ok: true, response: claudeCompletion(native), body: request() });
        await vi.waitFor(() => expect(save).toHaveBeenCalled());
        expect(save.mock.calls[0][0]).toMatchObject({ promptTokens: 2120, cacheReadTokens: 2000, cacheWriteTokens: 100 });
        save.mockRestore();
        const capture = buildApiRequestCapture({ url: 'https://relay.test/v1/messages', body: buildClaudeRequest(request()) });
        const section = capture.sections.find(s => s.id === 'native-system')!;
        expect(getApiRequestCaptureSectionContent(capture, section)).toBe(messages[0].content);
        expect(getApiRequestCaptureSectionContent(capture, capture.sections.find(s => s.kind === 'request')!)).not.toContain('stable persona');
    });
    it('sends native auth and native body while preserving cancellation; ordinary providers pass through', async () => {
        const signal = new AbortController().signal;
        const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(native), { headers: { 'content-type': 'application/json' } }));
        const init = { method: 'POST', headers: { Authorization: 'Bearer private-key' }, body: JSON.stringify(request()), signal };
        const response = await fetchWithClaudeTransport(fetcher, 'https://relay.test/v1/messages/chat/completions', init);
        const [url, sent] = fetcher.mock.calls[0] as any;
        expect(url).toBe('https://relay.test/v1/messages');
        expect(sent.headers.get('x-api-key')).toBe('private-key');
        expect(sent.headers.get('authorization')).toBeNull();
        expect(sent.signal).toBe(signal);
        expect(JSON.parse(sent.body).system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
        expect((await response.json()).choices[0].message.content).toBe('你好呀');
        await fetchWithClaudeTransport(fetcher, 'https://other.test/v1/chat/completions', init);
        expect(fetcher.mock.calls[1]).toEqual(['https://other.test/v1/chat/completions', init]);
    });
    it('never retries a rejected or failed billable request', async () => {
        const failure = new Response('not supported', { status: 400 });
        const fetcher = vi.fn<typeof fetch>(async () => failure);
        expect(await fetchWithClaudeTransport(fetcher, 'https://relay.test/v1/messages/chat/completions', { method: 'POST', body: JSON.stringify(request()) })).toBe(failure);
        expect(fetcher).toHaveBeenCalledTimes(1);
    });
    it('maps model discovery to the base native models endpoint', async () => {
        const fetcher = vi.fn<typeof fetch>(async () => new Response('{}'));
        await fetchWithClaudeTransport(fetcher, 'https://relay.test/v1/messages/models', { headers: { Authorization: 'Bearer key' } });
        expect(fetcher.mock.calls[0][0]).toBe('https://relay.test/v1/models');
    });
    it('streams split UTF-8, tool JSON, reasoning signatures and final usage without early termination', async () => {
        const events = [
            { type: 'message_start', message: { id: 'msg', model: native.model, usage: native.usage } },
            { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '想想' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'signed' } },
            { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
            { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '你好呀' } },
            { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'tool_a', name: 'schedule', input: {} } },
            { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"x":' } },
            { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '1}' } },
            { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 55 } },
            { type: 'message_stop' },
        ];
        const bytes = new TextEncoder().encode(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
        let offset = 0;
        const stream = new ReadableStream({ pull(c) {
            if (offset >= bytes.length) return c.close();
            c.enqueue(bytes.slice(offset, offset += 7));
        } });
        const fetcher = vi.fn<typeof fetch>(async () => new Response(stream, { headers: { 'content-type': 'text/event-stream' } }));
        const response = await fetchWithClaudeTransport(fetcher, 'https://relay.test/v1/messages/chat/completions', { method: 'POST', body: JSON.stringify(request({ stream: true })) });
        const result = parseSseToCompletion(await response.text());
        expect(result.choices[0].message.content).toBe('你好呀');
        expect(result.choices[0].message.reasoning_content).toBe('想想');
        expect(result.choices[0].message.tool_calls[0]).toMatchObject({ id: 'tool_a', function: { name: 'schedule', arguments: '{"x":1}' }, __claude_thinking: [{ signature: 'signed' }] });
        expect(result.usage.completion_tokens).toBe(55);
        expect(result.usage.prompt_tokens).toBe(2120);
        expect(result.choices[0].finish_reason).toBe('tool_calls');
    });
});
