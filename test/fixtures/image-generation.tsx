import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { OSPreviewProvider } from '../../context/OSContext';
import ImageGenerationSettings from '../../components/chat/ImageGenerationSettings';
import { DEFAULT_IMAGE_CONFIG } from '../../utils/imageGeneration';
function Preview() {
    const [apiConfig, setApiConfig] = useState({ imageGeneration: { ...DEFAULT_IMAGE_CONFIG, apiKey: 'demo-only' } });
    const [characters, setCharacters] = useState([{ id: 'demo', name: '露露', chatImageGenerationEnabled: false }]);
    const [notice, setNotice] = useState('');
    const value: any = { apiConfig, characters, updateApiConfig: (patch: any) => setApiConfig(c => ({ ...c, ...patch })), updateCharacter: (id: string, patch: any) => setCharacters(cs => cs.map(c => c.id === id ? { ...c, ...patch } : c)), addToast: (text: string) => setNotice(text) };
    return <OSPreviewProvider value={value}><main className="mx-auto max-w-sm bg-white p-5"><h1 className="mb-5 text-center text-lg font-bold">聊天生图</h1><ImageGenerationSettings charId="demo" /><p role="status" className="mt-4 text-sm text-green-700">{notice}</p></main></OSPreviewProvider>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
