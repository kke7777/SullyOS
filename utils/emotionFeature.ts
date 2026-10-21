import type { CharacterProfile } from '../types';
import { isScheduleFeatureOn } from './scheduleFeature';

type EmotionCharacter = Pick<CharacterProfile, 'emotionConfig' | 'scheduleFeatureEnabled' | 'scheduleStyle'>;

/** Legacy records retain their effective state until migrated; new settings are independent. */
export function isEmotionFeatureOn(char: EmotionCharacter | null | undefined): boolean {
    return !!char?.emotionConfig?.enabled
        && (char.emotionConfig.independent === true || isScheduleFeatureOn(char));
}

export function normalizeEmotionConfig(char: EmotionCharacter): NonNullable<CharacterProfile['emotionConfig']> {
    if (char.emotionConfig?.independent === true) return char.emotionConfig;
    return {
        ...char.emotionConfig,
        enabled: char.emotionConfig?.enabled !== false && isScheduleFeatureOn(char),
        independent: true,
    };
}
