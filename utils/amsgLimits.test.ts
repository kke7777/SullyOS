import { describe, expect, it } from 'vitest';
import {
  buildAmsgLimitsRecord,
  buildLimitsBrief,
  bumpDailySends,
  checkSelfScheduleRules,
  dayKeyInZone,
  earliestSlotAfter,
  findGapConflict,
  parseAmsgLimitsRecord,
  parseDailySends,
  pickPacingSettings,
  resolveAmsgLimits,
  sendsOnDay,
} from './amsgLimits';

const MIN = 60_000;

describe('resolveAmsgLimits — 用户没设时的默认值', () => {
  // 默认值是这次改动的核心承诺：用户什么都不动，角色也不会一分钟一条地刷、不会自己
  // 建每天都响的任务。改默认值要改的是产品决定，不是顺手调参——这条钉住它。
  it('默认：连发 3 次、隔 10 分钟、每天不限、重复的 3 次没回就停、同时 5 个、不许排重复和到点必发', () => {
    expect(resolveAmsgLimits(undefined)).toEqual({
      maxUnansweredSends: 3,
      minSendGapMs: 10 * MIN,
      dailySendCap: Infinity,
      recurringStopAfter: 3,
      maxActiveTasks: 5,
      allowSelfRecurring: false,
      allowSelfForce: false,
    });
  });

  it('0 的意思：连发 / 每日 / 重复停发是「不限」，间隔是「不额外限制」', () => {
    const limits = resolveAmsgLimits({
      maxUnansweredSends: 0, dailySendCap: 0, recurringStopAfter: 0, minSendGapMinutes: 0,
    });
    expect(limits.maxUnansweredSends).toBe(Infinity);
    expect(limits.dailySendCap).toBe(Infinity);
    expect(limits.recurringStopAfter).toBe(Infinity);
    expect(limits.minSendGapMs).toBe(0);
  });

  it('坏值回落默认值；任务名额封在 1~10、没有「不限」', () => {
    expect(resolveAmsgLimits({ maxUnansweredSends: -1 }).maxUnansweredSends).toBe(3);
    expect(resolveAmsgLimits({ minSendGapMinutes: Number.NaN }).minSendGapMs).toBe(10 * MIN);
    expect(resolveAmsgLimits({ maxActiveTasks: 0 }).maxActiveTasks).toBe(5);
    expect(resolveAmsgLimits({ maxActiveTasks: 50 }).maxActiveTasks).toBe(10);
    expect(resolveAmsgLimits({ maxActiveTasks: 2 }).maxActiveTasks).toBe(2);
  });
});

describe('limits 记录', () => {
  it('只带上限字段和开关，读回来一样', () => {
    const record = buildAmsgLimitsRecord({
      enabled: true, tasks: [], maxTokens: 120, dailySendCap: 5, allowSelfForce: true,
    } as any, true);
    expect(record).toEqual({ v: 1, selfScheduleEnabled: true, dailySendCap: 5, allowSelfForce: true });
    expect(parseAmsgLimitsRecord(JSON.stringify(record))).toEqual(record);
  });

  it('形状不对 → null（worker 按默认值走）', () => {
    expect(parseAmsgLimitsRecord('')).toBeNull();
    expect(parseAmsgLimitsRecord('{')).toBeNull();
    expect(parseAmsgLimitsRecord(JSON.stringify({ v: 1 }))).toBeNull();
  });

  it('pickPacingSettings 不带没设的项', () => {
    expect(pickPacingSettings({ maxUnansweredSends: undefined, minSendGapMinutes: 30 })).toEqual({ minSendGapMinutes: 30 });
  });
});

describe('每日计数', () => {
  // 「今天」是用户那边的今天：同一个时刻，上海已经是第二天，纽约还是前一天。
  it('按时区取日期', () => {
    const at = Date.parse('2026-07-25T20:00:00Z');
    expect(dayKeyInZone(at, 'Asia/Shanghai')).toBe('2026-07-26');
    expect(dayKeyInZone(at, 'America/New_York')).toBe('2026-07-25');
  });

  it('同一天累加，换日从零数起', () => {
    let record = bumpDailySends(null, '2026-07-25', { sends: 1, llmCalls: 2 });
    record = bumpDailySends(record, '2026-07-25', { sends: 1 });
    expect(record).toEqual({ v: 1, day: '2026-07-25', sends: 2, llmCalls: 2 });
    expect(sendsOnDay(record, '2026-07-26')).toBe(0);
    expect(bumpDailySends(record, '2026-07-26', { sends: 1 })).toEqual({ v: 1, day: '2026-07-26', sends: 1 });
    expect(parseDailySends(JSON.stringify(record))).toEqual(record);
  });

  it('同一次触发只算一次「发了」，模型调用照加', () => {
    let record = bumpDailySends(null, '2026-07-25', { sends: 1, llmCalls: 1, sentId: 'c@1' });
    record = bumpDailySends(record, '2026-07-25', { sends: 1, llmCalls: 1, sentId: 'c@1' });
    expect(record).toMatchObject({ sends: 1, llmCalls: 2, counted: ['c@1'] });
  });
});

describe('间隔', () => {
  it('找冲突：离哪个时刻不够远', () => {
    expect(findGapConflict(100 * MIN, 10 * MIN, [95 * MIN, 200 * MIN])).toBe(95 * MIN);
    expect(findGapConflict(100 * MIN, 10 * MIN, [80 * MIN, 120 * MIN])).toBeNull();
    expect(findGapConflict(100 * MIN, 0, [100 * MIN])).toBeNull();
  });

  it('最早能排的时刻：一路往后挪到跟每个都隔够', () => {
    expect(earliestSlotAfter(0, 10 * MIN, [0, 12 * MIN])).toBe(22 * MIN);
    expect(earliestSlotAfter(0, 10 * MIN, [30 * MIN])).toBe(0);
  });
});

describe('checkSelfScheduleRules', () => {
  const base = {
    sendAtMs: 60 * MIN,
    recurrence: 'none' as const,
    expirePolicy: 'expire' as const,
    busy: [] as number[],
    earliestMs: MIN,
    formatTime: (ms: number) => `T+${Math.round(ms / MIN)}分`,
  };

  it('不许排重复的 → 打回', () => {
    const out = checkSelfScheduleRules({ ...base, limits: resolveAmsgLimits(undefined), recurrence: 'daily' });
    expect(out).toMatchObject({ ok: false, reason: 'recurring_not_allowed' });
    expect(checkSelfScheduleRules({
      ...base, limits: resolveAmsgLimits({ allowSelfRecurring: true }), recurrence: 'daily',
    }).ok).toBe(true);
  });

  it('离已排的太近 → 打回，并报最早能排的时刻', () => {
    const out = checkSelfScheduleRules({ ...base, limits: resolveAmsgLimits(undefined), busy: [55 * MIN] });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe('min_gap');
      expect(out.message).toContain('T+65分');
    }
  });

  it('到点必发没放开 → 不打回，按普通的排；放开了原样', () => {
    const locked = checkSelfScheduleRules({ ...base, limits: resolveAmsgLimits(undefined), expirePolicy: 'force' });
    expect(locked).toEqual({ ok: true, expirePolicy: 'expire' });
    const open = checkSelfScheduleRules({
      ...base, limits: resolveAmsgLimits({ allowSelfForce: true }), expirePolicy: 'force',
    });
    expect(open).toEqual({ ok: true, expirePolicy: 'force' });
  });
});

describe('buildLimitsBrief', () => {
  it('把额度说成事实：还能排几条、最早几点、今天还剩几条', () => {
    const text = buildLimitsBrief({
      limits: resolveAmsgLimits({ dailySendCap: 5 }),
      committedSends: 1,
      activeTasks: 2,
      earliestText: '21:40',
      dailyRemaining: 3,
    });
    expect(text).toContain('目前还能安排 2 次');
    expect(text).toContain('最早可安排在 21:40');
    expect(text).toContain('今天还能主动联系 3 次');
    expect(text).toContain('目前有 2 个');
    expect(text).toContain('仅支持一次性任务');
  });

  it('额度用完了直说；不限的项不出现', () => {
    const full = buildLimitsBrief({ limits: resolveAmsgLimits(undefined), committedSends: 3, activeTasks: 0 });
    expect(full).toContain('目前剩余 0 次，等对方回复后再安排');
    const loose = buildLimitsBrief({
      limits: resolveAmsgLimits({ maxUnansweredSends: 0, minSendGapMinutes: 0, allowSelfRecurring: true, allowSelfForce: true }),
      committedSends: 9,
      activeTasks: 0,
    });
    expect(loose).not.toContain('对方未回复期间');
    expect(loose).not.toContain('至少间隔');
    expect(loose).not.toContain('仅支持一次性任务');
    expect(loose).not.toContain('到点必发');
  });

  it('自定义额度、任务名额和小时级间隔按设置生成，不保留默认数字', () => {
    const text = buildLimitsBrief({
      limits: resolveAmsgLimits({ maxUnansweredSends: 7, minSendGapMinutes: 90, maxActiveTasks: 8 }),
      committedSends: 4,
      activeTasks: 6,
    });
    expect(text).toContain('最多主动联系 7 次');
    expect(text).toContain('目前还能安排 3 次');
    expect(text).toContain('至少间隔 1 小时 30 分钟');
    expect(text).toContain('最多同时保留 8 个任务，目前有 6 个');
    expect(text).not.toContain('最多主动联系 3 次');
    expect(text).not.toContain('最多同时保留 5 个任务');
  });

  it('超过连发额度仍显示零；每日额度用完时保留明天再安排的动态分支', () => {
    const text = buildLimitsBrief({
      limits: resolveAmsgLimits({ dailySendCap: 2 }),
      committedSends: 5,
      activeTasks: 2,
      dailyRemaining: 0,
    });
    expect(text).toContain('目前剩余 0 次');
    expect(text).not.toContain('安排 -2 次');
    expect(text).toContain('今日主动联系额度已用完，请安排在明天');
  });
});
