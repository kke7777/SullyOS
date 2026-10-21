import { expect, it } from 'vitest';
import { MemoryNodeDB, EventBoxDB } from './db';
import { expandAndFormat } from './formatter';
import type { RecallMaterial } from './recallMaterial';

it('captures only selected, expanded sources while leaving pinned memories outside the writing material', async () => {
    const charId = 'material-sources';
    const node = (id: string, content: string, extra = {}) => ({ id, charId, content, room: 'living_room', tags: [], importance: 5, mood: 'neutral', embedded: true, createdAt: Date.now(), lastAccessedAt: Date.now(), accessCount: 0, ...extra }) as any;
    const summary = node('material-summary', '整合回忆标记', { eventBoxId: 'material-box' });
    const live = node('material-live', '新增片段标记', { eventBoxId: 'material-box' });
    const separate = node('material-separate', '独立往事正文');
    const cut = node('material-cut', '被名额上限排除的往事');
    await MemoryNodeDB.saveMany([summary, live, separate, cut, node('material-pin', '置顶常驻标记', { pinnedUntil: Date.now() + 60_000 })]);
    await EventBoxDB.save({ id: 'material-box', charId, name: '看海话题盒', tags: [], summaryNodeId: summary.id,
        liveMemoryIds: [live.id], archivedMemoryIds: [], compressionCount: 1, createdAt: 1, updatedAt: 1 } as any);
    let batch: RecallMaterial | undefined;
    const result = await expandAndFormat([summary, live, separate, cut].map((n, index) => ({ node: n, finalScore: 10 - index }) as any),
        charId, [], '小明', 2, value => { batch = value; });
    expect(batch?.originalText).toBe(result);
    expect(batch?.memoryText).toContain('整合回忆标记');
    expect(batch?.memoryText).toContain('新增片段标记');
    expect(batch?.memoryText).not.toContain('置顶常驻标记');
    expect(batch?.prefix).toContain('置顶常驻标记');
    expect(batch?.sources.map(source => source.id)).toEqual(['material-box', 'material-separate']);
    expect(batch?.sources[0].name).toBe('看海话题盒');
    expect(batch?.sources[1].name).toContain('独立往事正文');
    expect(batch?.sources[1].name).toMatch(/\d{4}/);
    expect(result).not.toContain(cut.content);
});
