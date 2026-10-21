/** Local heuristic only, shared with character statistics; not a billing tokenizer. */
export function estimateContextTokens(text: string): number {
    let latin = 0, other = 0;
    for (const character of text) {
        if (character.codePointAt(0)! <= 127) latin++;
        else other++;
    }
    return Math.ceil(latin / 4 + other);
}

/** Keep the longest prefix within the same estimate, without splitting a Unicode character. */
export function truncateContextTokens(text: string, limit: number): string {
    let units = 0, end = 0;
    for (const character of text) {
        const next = units + (character.codePointAt(0)! <= 127 ? 1 : 4);
        if (next > limit * 4) break;
        units = next;
        end += character.length;
    }
    return text.slice(0, end);
}
