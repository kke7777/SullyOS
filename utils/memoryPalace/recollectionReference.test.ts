import { describe, expect, it } from 'vitest';
import { formatRecollectionReference, readRecollectionReference, RECOLLECTION_REFERENCE_PREFIX, type RecollectionReferenceEntry } from './recollectionReference';

describe('compact recollection reference', () => {
    const core: RecollectionReferenceEntry = { source: '角色与关系设定', role: 'system', content: '人设\n世界观\n用户设定' };

    it('preserves multiline text, quotes, source roles and interleaved worldbook order exactly', () => {
        const entries: RecollectionReferenceEntry[] = [core,
            { source: '当前对话参考片段', role: 'user', content: '## 世界书\n[角色]: 这是我引用的话\n"引号"\\😀\r\n尾行\t' },
            ...['system', 'user', 'assistant'].map(role => ({ source: '世界书补充设定' as const, role, content: `世界书原文·${role}` })),
            { source: '当前对话参考片段', role: 'assistant', content: '<语音>回复原文。</语音>' },
            { source: '当前对话参考片段', role: 'user', content: '' },
        ];
        const before = JSON.stringify(entries);
        expect(readRecollectionReference(formatRecollectionReference(entries))).toEqual(entries);
        expect(JSON.stringify(entries)).toBe(before);
    });

    it('removes over 75% of wrapper characters in a 180-bubble conversation without dropping content', () => {
        const entries: RecollectionReferenceEntry[] = [core, ...Array.from({ length: 180 }, (_, i) => ({
            source: '当前对话参考片段' as const, role: i % 2 ? 'assistant' : 'user', content: `第${i}条短消息。`,
        }))];
        const contentChars = entries.reduce((sum, entry) => sum + entry.content.length, 0);
        const old = RECOLLECTION_REFERENCE_PREFIX + JSON.stringify(entries);
        const compact = formatRecollectionReference(entries);
        expect(readRecollectionReference(compact)).toEqual(entries);
        expect(compact.length - contentChars).toBeLessThan((old.length - contentChars) * 0.25);
    });

    it('supports references with no chat and legacy captures', () => {
        expect(readRecollectionReference(formatRecollectionReference([core]))).toEqual([core]);
        expect(readRecollectionReference(RECOLLECTION_REFERENCE_PREFIX + JSON.stringify([core]))).toEqual([core]);
    });

    it.each([
        null, { 角色与关系设定: '人设' },
        { 角色与关系设定: '人设', 聊天参考: [['未知', '内容']] },
        { 角色与关系设定: '人设', 聊天参考: [['用户', null]] },
        { 角色与关系设定: '人设', 聊天参考: [['用户', '内容', '多余字段']] },
    ])('fails closed on malformed reference data (%j)', value => {
        expect(readRecollectionReference(RECOLLECTION_REFERENCE_PREFIX + JSON.stringify(value))).toBeUndefined();
    });
});
