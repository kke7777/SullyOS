import { describe, expect, it } from 'vitest';
import { isEmotionFeatureOn, normalizeEmotionConfig } from './emotionFeature';
import { normalizeCharacterDefaults } from './impression';
import { ContextBuilder } from './context';
import { buildScheduleInjection } from './scheduleInjection';

const schedule: any = { slots: [{startTime:'00:00',activity:'画画',innerThought:'OLD_SLOT'}], flowNarrative: {morning:'OLD_AM',afternoon:'OLD_PM',evening:'OLD_NIGHT'} };
describe('independent schedule and emotion', () => {
    for (const scheduleOn of [false, true]) for (const emotionOn of [false, true]) {
        it(`schedule=${scheduleOn}, emotion=${emotionOn} in chat and home`, async () => {
            const char: any = {id:'matrix',scheduleFeatureEnabled:scheduleOn,emotionConfig:{enabled:emotionOn,independent:true},buffInjection:'BUFF_MARK'};
            expect(isEmotionFeatureOn(char)).toBe(emotionOn);
            const daily = await ContextBuilder.buildCurrentScheduleContext(char,true,Promise.resolve(schedule));
            expect(daily.includes('画画')).toBe(scheduleOn);
            expect(daily).not.toMatch(/OLD_/);
            for (const surface of ['chat','home'] as const) {
                const state = ContextBuilder.buildEmotionContext(char,{surface,innerState:'INNER_MARK'});
                expect(state.includes('BUFF_MARK')).toBe(emotionOn);
                expect(state.includes('INNER_MARK')).toBe(emotionOn);
            }
        });
    }
    it('never revives any legacy monologue, including a caller override', () => {
        for (const hour of [1,9,14,21]) {
            const out = buildScheduleInjection(schedule,'OLD_OVERRIDE',new Date(2026,0,1,hour),{includeFullDay:true});
            expect(out).toContain('画画');
            expect(out).not.toMatch(/OLD_/);
        }
    });
    it('migrates effective legacy settings once without losing API config', () => {
        for (const scheduleOn of [false,true]) for (const enabled of [undefined,false,true]) {
            const char: any = {id:'legacy',scheduleFeatureEnabled:scheduleOn,emotionConfig:enabled===undefined?undefined:{enabled,api:{baseUrl:'test',apiKey:'test',model:'test'}}};
            const migrated = normalizeCharacterDefaults(char);
            expect(isEmotionFeatureOn(migrated)).toBe(scheduleOn && enabled!==false);
            expect(migrated.emotionConfig?.api).toEqual(char.emotionConfig?.api);
            expect(normalizeCharacterDefaults(migrated)).toBe(migrated);
            expect(isEmotionFeatureOn({...migrated,scheduleFeatureEnabled:!scheduleOn})).toBe(scheduleOn && enabled!==false);
        }
    });
    it('legacy style-only records migrate without implicitly changing the setting', () => {
        expect(normalizeEmotionConfig({scheduleStyle:'mindful',emotionConfig:{enabled:true}}).enabled).toBe(true);
        expect(normalizeEmotionConfig({emotionConfig:{enabled:true}}).enabled).toBe(false);
    });
});
