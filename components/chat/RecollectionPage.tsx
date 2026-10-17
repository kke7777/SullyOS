import React, { useEffect, useState } from 'react';
import { useLocalBackHandler } from '../../hooks/useLocalBackHandler';
import { readUsedRecollection, RECOLLECTION_CHANGED } from '../../utils/memoryPalace/recollectionSnapshot';

export default function RecollectionPage({ charId, charName, onBack }: {
    charId: string; charName: string; onBack: () => void;
}) {
    const [snapshot, setSnapshot] = useState(() => readUsedRecollection(charId));
    useEffect(() => {
        const refresh = () => setSnapshot(readUsedRecollection(charId));
        refresh();
        window.addEventListener(RECOLLECTION_CHANGED, refresh);
        window.addEventListener('storage', refresh);
        return () => {
            window.removeEventListener(RECOLLECTION_CHANGED, refresh);
            window.removeEventListener('storage', refresh);
        };
    }, [charId]);
    useLocalBackHandler(() => { onBack(); return true; }, 30);
    const status = snapshot && {
        refined: '已使用整理回忆', fallback: '整理失败，已使用召回原文',
        original: '已使用常驻记忆', empty: '本次没有召回记忆',
    }[snapshot.status];
    return <div className="h-full overflow-y-auto bg-violet-50/40 px-4 pb-8 text-slate-700"
        style={{ paddingTop: 'calc(var(--safe-top, 0px) + 16px)' }}>
        <button type="button" onClick={onBack} className="py-2 text-sm font-medium text-violet-600">← 返回记忆宫殿</button>
        <h2 className="mt-3 text-lg font-bold">{charName} · 最近使用的回忆</h2>
        <p className="mt-2 text-xs leading-6 text-slate-500">查看最近一次聊天请求实际使用的记忆文字与召回条目。</p>
        {!snapshot ? <div className="mt-6 rounded-2xl bg-white p-5 text-sm leading-7 text-slate-500">
            还没有使用记录。开启记忆宫殿后，下一次聊天请求发出时会在这里留下记录。
        </div> : <>
            <div className="mt-5 rounded-2xl bg-white p-4">
                <p className={`text-sm font-semibold ${snapshot.status === 'fallback' ? 'text-amber-700' : 'text-violet-700'}`}>{status}</p>
                <time className="mt-2 block text-xs text-slate-400">{new Date(snapshot.sentAt).toLocaleString()}</time>
            </div>
            <section className="mt-4 rounded-2xl bg-white p-4">
                <h3 className="text-sm font-bold">本次召回条目</h3>
                {snapshot.sources.length ? <ul className="mt-3 space-y-2 text-sm leading-6">
                    {snapshot.sources.map(source => <li key={`${source.kind}:${source.id}`} className="break-words">
                        <span className="mr-2 text-xs text-violet-400">{source.kind === 'event_box' ? '话题盒' : '独立记忆'}</span>{source.name}
                    </li>)}
                </ul> : <p className="mt-3 text-sm text-slate-400">本次没有召回往事条目。</p>}
            </section>
            <section className="mt-4 rounded-2xl bg-white p-4">
                <h3 className="text-sm font-bold">实际交给回复模型的回忆</h3>
                <div className="mt-4 whitespace-pre-wrap break-words text-sm leading-7" style={{ overflowWrap: 'anywhere' }}>
                    {snapshot.text || '本次没有注入回忆文字。'}
                </div>
            </section>
        </>}
    </div>;
}
