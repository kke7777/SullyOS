import type { RecallSource } from './recallMaterial';

export interface RecollectionSnapshot {
    charId: string;
    text: string;
    sources: RecallSource[];
    status: 'refined' | 'fallback' | 'original' | 'empty';
}

export interface UsedRecollection extends RecollectionSnapshot {
    sentAt: number;
}

export const RECOLLECTION_CHANGED = 'memory-palace-recollection-changed';
const storageKey = (charId: string) => `os_mp_used_recollection_${charId}`;

export function readUsedRecollection(charId: string): UsedRecollection | null {
    try {
        const value = JSON.parse(localStorage.getItem(storageKey(charId)) || 'null');
        if (!value || value.charId !== charId || typeof value.text !== 'string'
            || !Number.isFinite(value.sentAt) || !Array.isArray(value.sources)
            || !['refined', 'fallback', 'original', 'empty'].includes(value.status)) return null;
        if (!value.sources.every((source: RecallSource) => source && typeof source.id === 'string'
            && typeof source.name === 'string' && ['event_box', 'memory'].includes(source.kind))) return null;
        return value;
    } catch { return null; }
}

/** Call at transport dispatch, never while preparing or completing the secondary request. */
export function saveUsedRecollection(snapshot?: RecollectionSnapshot): void {
    if (!snapshot) return;
    try {
        localStorage.setItem(storageKey(snapshot.charId), JSON.stringify({ ...snapshot, sentAt: Date.now() }));
        if (typeof window !== 'undefined') window.dispatchEvent(new Event(RECOLLECTION_CHANGED));
    } catch (error) {
        console.warn('[MemoryPalace] 最近使用的回忆保存失败', error);
    }
}

export function createRecollectionDispatch(snapshot?: RecollectionSnapshot): () => void {
    let dispatched = false;
    return () => {
        if (dispatched) return;
        dispatched = true;
        saveUsedRecollection(snapshot);
    };
}
