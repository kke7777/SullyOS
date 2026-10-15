// esbuild injects both free fetch and globalThis.fetch references into this wrapper.
// Reflect.get deliberately retrieves the runtime fetch without being rewritten by esbuild.
import { fetchWithClaudeTransport } from '../../utils/claudeTransport';
const nativeFetch: typeof fetch = (resource, init) =>
    fetchWithClaudeTransport(Reflect.get(globalThis, 'fetch').bind(globalThis), resource, init);
export { nativeFetch as fetch, nativeFetch as 'globalThis.fetch' };
