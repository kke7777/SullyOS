import React from 'react';
import { createRoot } from 'react-dom/client';
import { OSProvider } from '../../context/OSContext';
import { MusicProvider } from '../../context/MusicContext';
import MemoryPalaceApp from '../../apps/MemoryPalaceApp';
import { DB } from '../../utils/db';
import { saveUsedRecollection } from '../../utils/memoryPalace/recollectionSnapshot';
import { handleLocalBack } from '../../utils/localBackHandlers';

(window as any).qaRecollectionApp = { DB, saveUsedRecollection, handleLocalBack };
async function start() {
    localStorage.setItem('os_first_use_memory_guide_v1', 'done');
    if (!(await DB.getAllCharacters()).some(character => character.id === 'qa-recollection')) {
        await DB.saveCharacter({ id: 'qa-recollection', name: '测试角色', avatar: '', description: '', systemPrompt: '', memoryPalaceEnabled: false } as any);
    }
    createRoot(document.getElementById('root')!).render(<OSProvider><MusicProvider><MemoryPalaceApp /></MusicProvider></OSProvider>);
}
void start();
