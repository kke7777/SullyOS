// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import DialogueApiFields from '../components/settings/DialogueApiFields';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
it('switches native mode and back while preserving the current key and model', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    function Probe() {
        const [value, setValue] = useState({ baseUrl: 'https://relay.test/v1', apiKey: 'private', model: 'claude-opus-5-5' });
        return React.createElement(DialogueApiFields, { value, onChange: patch => setValue(v => ({ ...v, ...patch })),
            fetchModels: () => {}, isLoadingModels: false, openModelPicker: () => {} });
    }
    try {
        act(() => root.render(React.createElement(Probe)));
        const select = host.querySelector('select')!;
        act(() => { select.value = 'claude'; select.dispatchEvent(new Event('change', { bubbles: true })); });
        expect((host.querySelector('input[type="text"]') as HTMLInputElement).value).toBe('https://relay.test/v1/messages');
        expect((host.querySelector('input[type="password"]') as HTMLInputElement).value).toBe('private');
        expect(host.textContent).toContain('claude-opus-5-5');
        act(() => { select.value = 'openai'; select.dispatchEvent(new Event('change', { bubbles: true })); });
        expect((host.querySelector('input[type="text"]') as HTMLInputElement).value).toBe('https://relay.test/v1');
    } finally { act(() => root.unmount()); host.remove(); }
});
