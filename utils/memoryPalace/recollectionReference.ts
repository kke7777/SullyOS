export const RECOLLECTION_REFERENCE_PREFIX = '参考资料（角色设定、当前对话及补充设定）：\n';

export interface RecollectionReferenceEntry {
    source: '角色与关系设定' | '当前对话参考片段' | '世界书补充设定';
    role: string;
    content: string;
}

/** Keep reference data quoted, but write field names once instead of on every chat bubble. */
export function formatRecollectionReference(entries: RecollectionReferenceEntry[]): string {
    return RECOLLECTION_REFERENCE_PREFIX + JSON.stringify({
        角色与关系设定: entries[0].content,
        聊天参考: entries.slice(1).map(entry => [
            entry.source === '世界书补充设定' ? `世界书·${entry.role}`
                : entry.role === 'user' ? '用户' : '角色',
            entry.content,
        ]),
    });
}

/** Decode only known reference formats for statistics; raw source text is never reinterpreted. */
export function readRecollectionReference(text: string): RecollectionReferenceEntry[] | undefined {
    if (!text.startsWith(RECOLLECTION_REFERENCE_PREFIX)) return undefined;
    try {
        const data = JSON.parse(text.slice(RECOLLECTION_REFERENCE_PREFIX.length));
        // v12/v13 requests remain readable when their full captures are inspected.
        if (Array.isArray(data)) {
            return data.every(entry => entry && typeof entry.content === 'string'
                && ['角色与关系设定', '当前对话参考片段', '世界书补充设定'].includes(entry.source)
                && ['system', 'user', 'assistant'].includes(entry.role)) ? data : undefined;
        }
        if (!data || typeof data.角色与关系设定 !== 'string' || !Array.isArray(data.聊天参考)) return undefined;
        const entries: RecollectionReferenceEntry[] = [{
            source: '角色与关系设定', role: 'system', content: data.角色与关系设定,
        }];
        for (const item of data.聊天参考) {
            if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== 'string' || typeof item[1] !== 'string') return undefined;
            const [label, content] = item;
            if (label === '用户' || label === '角色') {
                entries.push({ source: '当前对话参考片段', role: label === '用户' ? 'user' : 'assistant', content });
            } else if (/^世界书·(system|user|assistant)$/.test(label)) {
                entries.push({ source: '世界书补充设定', role: label.slice('世界书·'.length), content });
            } else return undefined;
        }
        return entries;
    } catch { return undefined; }
}
