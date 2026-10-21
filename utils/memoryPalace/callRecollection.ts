import type { CharacterProfile, Message, UserProfile } from '../../types';
import type { ContextRangeSnapshot } from '../chatContextRange';
import { expandHomeContextHistory } from '../homeContextSegments';
import { injectMemoryPalace } from './pipeline';
import type { RecallMaterial } from './recallMaterial';
import { prepareRecollection } from './recollection';
import { createRecollectionDispatch } from './recollectionSnapshot';

/** One call turn owns its injection; never write it back onto the shared character. */
export async function prepareCallRecollection(input: {
    char: CharacterProfile;
    user: UserProfile;
    range: ContextRangeSnapshot;
    text: string;
    skipDbId?: number;
    signal: AbortSignal;
}) {
    const { char, user, range, text, skipDbId, signal } = input;
    signal.throwIfAborted();
    const requestChar = { ...char, memoryPalaceInjection: '', roomPlatesInjection: '' };
    const skipped = range.messages.find(message => message.id === skipDbId);
    // Regeneration must not use the answer being replaced or its later conversation.
    const history = range.messages.filter(message => message.id !== skipDbId
        && !(skipped?.role === 'assistant' && message.id >= skipped.id));
    const last = history.at(-1);
    const alreadyPresent = skipped?.role === 'assistant' && last?.role === 'user' && last.content === text;
    const pending: Message = {
        id: -1, charId: char.id, role: 'user', type: 'text', content: text,
        timestamp: skipped?.timestamp ?? Date.now(), metadata: { source: 'call' },
    };
    const recallMessages = alreadyPresent ? history : [...history, pending];
    let material: RecallMaterial | undefined;
    if (char.memoryPalaceEnabled) {
        await injectMemoryPalace(requestChar, recallMessages, undefined, user?.name, {
            onMaterial: value => { material = value; },
        });
    }
    signal.throwIfAborted();
    const snapshot = await prepareRecollection({
        char: requestChar, user,
        messages: expandHomeContextHistory(recallMessages.filter(message => message === pending || message.id > range.hwm)),
        material, originalText: requestChar.memoryPalaceInjection, signal,
    });
    signal.throwIfAborted();
    requestChar.memoryPalaceInjection = snapshot.text;
    return { char: requestChar, history, onDispatch: createRecollectionDispatch(snapshot) };
}
