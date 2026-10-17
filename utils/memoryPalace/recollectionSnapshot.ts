import type { RecallSource } from './recallMaterial';

export interface RecollectionSnapshot {
    charId: string;
    text: string;
    sources: RecallSource[];
    status: 'refined' | 'fallback' | 'original' | 'empty';
    /** These fields belong only to this secondary request, never the main reply. */
    requestId?: string;
    recalledText?: string;
    secondaryOutput?: string;
    narrative?: string;
    fallbackReason?: string;
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
        for (const key of ['requestId', 'recalledText', 'secondaryOutput', 'narrative', 'fallbackReason']) {
            if (value[key] !== undefined && typeof value[key] !== 'string') return null;
        }
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
    // The transport owns a value snapshot. Later changes to a caller's object,
    // sources or reply state must not rewrite the already prepared round.
    const prepared = snapshot && { ...snapshot, sources: snapshot.sources.map(source => ({ ...source })) };
    let dispatched = false;
    return () => {
        if (dispatched) return;
        dispatched = true;
        saveUsedRecollection(prepared);
    };
}
