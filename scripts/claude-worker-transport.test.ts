import { afterEach, expect, it, vi } from 'vitest';
import { build } from 'esbuild';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
it('the bundled amsg dependency calls the native transport without changing the runtime fetch', async () => {
    const result = await build({
        stdin: { contents: "export { callLlm } from '@rei-standard/amsg-shared';", resolveDir: process.cwd() },
        bundle: true, write: false, platform: 'node', format: 'esm',
        inject: [`${process.cwd()}/worker/amsg/nativeFetch.ts`],
    });
    const fake = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
        id: 'msg', type: 'message', model: 'claude-opus-5-5', stop_reason: 'end_turn',
        content: [{ type: 'text', text: '云端回复' }],
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2000, cache_creation_input_tokens: 50 },
    }), { headers: { 'content-type': 'application/json' } }));
    globalThis.fetch = fake;
    // Evaluate exactly the bundled code, including the dependency's globalThis.fetch access.
    const module = await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
    const reply = await module.callLlm({ apiUrl: 'https://relay.test/v1/messages/chat/completions', apiKey: 'secret', primaryModel: 'claude-opus-5-5',
        messages: [{ role: 'system', content: 'stable' }, { role: 'user', content: '你好' }], maxTokens: 8000 });
    expect(reply.content).toBe('云端回复');
    expect(reply.response.usage.prompt_tokens).toBe(2060);
    expect(reply.response.usage.cache_read_input_tokens).toBe(2000);
    expect(fake).toHaveBeenCalledTimes(1);
    expect(fake.mock.calls[0][0]).toBe('https://relay.test/v1/messages');
    expect(JSON.parse((fake.mock.calls[0] as any)[1].body).system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(globalThis.fetch).toBe(fake);
});
