import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { OSProvider, useOS } from '../../context/OSContext';
import { MusicProvider } from '../../context/MusicContext';
import Chat from '../../apps/Chat';
import { DB } from '../../utils/db';
import { AppID } from '../../types';
import { acquireChatReply } from '../../utils/chatReplyLock';

const id = 'qa-reply-status';
(window as any).qaReplyStatus = { acquireChatReply, charId: id };
function App() {
    const os = useOS();
    useEffect(() => { os.openApp(AppID.Chat); }, []);
    return os.activeCharacterId === id ? <Chat /> : null;
}
async function start() {
    localStorage.setItem('os_first_use_memory_guide_v1', 'done');
    localStorage.setItem('os_last_active_char_id', id);
    await DB.saveCharacter({ id, name: '露易丝', avatar: '', description: '', systemPrompt: '', memoryPalaceEnabled: true } as any);
    createRoot(document.getElementById('root')!).render(<OSProvider><MusicProvider><App /></MusicProvider></OSProvider>);
}
void start();
