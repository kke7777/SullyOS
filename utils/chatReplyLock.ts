// 按角色同步占位，跨 Chat 卸载保留：异步回复仍会在后台继续落库。
// React state 要等下一次 render 才更新，不能拿来挡同一帧的重复点击。
export type ChatReplyPhase = 'preparing' | 'recollecting' | 'replying';
type ChatReplyLease = (() => void) & { setPhase: (phase: ChatReplyPhase) => void };
const activeReplies = new Map<string, ChatReplyPhase>();
const listeners = new Set<() => void>();

export const isChatReplyActive = (charId?: string): boolean => !!charId && activeReplies.has(charId);
export const getChatReplyPhase = (charId?: string): ChatReplyPhase | null => charId ? activeReplies.get(charId) ?? null : null;

export function subscribeChatReplies(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export function acquireChatReply(charId: string): ChatReplyLease | null {
    if (activeReplies.has(charId)) return null;
    activeReplies.set(charId, 'preparing');
    listeners.forEach(listener => listener());
    let released = false;
    const release = () => {
        if (released) return;
        released = true;
        activeReplies.delete(charId);
        listeners.forEach(listener => listener());
    };
    return Object.assign(release, { setPhase(phase: ChatReplyPhase) {
        if (released || activeReplies.get(charId) === phase) return;
        activeReplies.set(charId, phase);
        listeners.forEach(listener => listener());
    } });
}
