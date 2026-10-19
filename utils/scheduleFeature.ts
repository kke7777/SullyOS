import type { CharacterProfile } from '../types';

/**
 * 日程开关判定（情绪开关见 emotionFeature.ts）。
 * - 显式为 true / false 时直接使用。
 * - undefined 时走向后兼容：老用户若已选了 scheduleStyle，视为开启；否则默认关闭。
 * 日程生成与日程注入之前都应先过此闸门。
 */
export function isScheduleFeatureOn(
    char: Pick<CharacterProfile, 'scheduleFeatureEnabled' | 'scheduleStyle'> | null | undefined,
): boolean {
    if (!char) return false;
    if (char.scheduleFeatureEnabled === true) return true;
    if (char.scheduleFeatureEnabled === false) return false;
    return !!char.scheduleStyle;
}

/**
 * 时段 key 的实现住在 utils/scheduleInjection.ts —— 那是日程渲染的纯叶子，
 * 浏览器和 Cloudflare Worker（主动消息到点生成）共用同一份。这里转发一道，
 * 让「日程开关」这个入口继续能一次取到需要的两样。
 */
export { getFlowNarrativeKey } from './scheduleInjection';
