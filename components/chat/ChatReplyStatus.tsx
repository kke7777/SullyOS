import React from 'react';
import type { ChatReplyPhase } from '../../utils/chatReplyLock';

/** Beside the pending avatar; preparation keeps the existing dots until a real stage starts. */
export default function ChatReplyStatus({ characterName, phase }: { characterName: string; phase: ChatReplyPhase }) {
    const louise = characterName.includes('露易丝') || characterName === '露露';
    const text = phase === 'recollecting'
        ? `${louise ? '露易丝' : characterName}在回忆ing`
        : phase === 'replying' ? `${louise ? '露露' : characterName}打字ing` : '';
    return <div role="status" aria-live="polite" className={`flex items-center gap-2 text-xs font-medium ${phase === 'recollecting' ? 'text-indigo-500' : 'text-slate-500'}`}>
        <span className="flex gap-1" aria-hidden="true">
            <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" />
            <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-75" />
            <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-150" />
        </span>
        {text && <span>{text}</span>}
    </div>;
}
