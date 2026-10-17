import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import RecollectionPage from '../../components/chat/RecollectionPage';
import { readUsedRecollection, saveUsedRecollection } from '../../utils/memoryPalace/recollectionSnapshot';
import { handleLocalBack } from '../../utils/localBackHandlers';

(window as any).qaRecollection = { readUsedRecollection, saveUsedRecollection, handleLocalBack };
function App() {
    const [open, setOpen] = useState(true);
    return open ? <RecollectionPage charId="qa-recollection" charName="测试角色" onBack={() => setOpen(false)} />
        : <button type="button" onClick={() => setOpen(true)}>最近使用的回忆</button>;
}
createRoot(document.getElementById('root')!).render(<App />);
