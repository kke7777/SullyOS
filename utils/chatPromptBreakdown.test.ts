import { describe, expect, it } from 'vitest';
import { buildPromptBreakdown } from './apiCallLog';
import { buildChatRequestPayload } from './chatRequestPayload';

const role = '### 你的身份 (Character)\n';
const rules = '### 聊天 App 行为规范 (Chat App Rules)\n';

describe('main chat input categories', () => {
    it.each(['\n', '\r\n'])('keeps nested headings in their source, preserves large histories and accounts for every character (%j)', newline => {
        const persona = role + Array.from({ length: 80 }, (_, i) => `## 人设部分${i}\n具体经历${i}\n`).join('');
        const profile = '### 互动对象 (User)\n用户资料\n## 喜好\n漫画\n';
        const world = '### 扩展设定集 (Worldbooks)\n#### 条目\n## 内部标题\n世界书正文\n---\n\n';
        const fixed = rules + '### 1. 沉浸感\n规则\n### 2. 行为模式\n规则\n';
        const voice = '### 🎤 语音消息功能\n语音规则\n## 演绎\n语音细则';
        const normalize = (text: string) => text.replace(/\n/g, newline);
        const history = '## 用户写的小标题\n' + '这一段属于聊天原文。'.repeat(1500) + '\n## 后续\n结束';
        const body = { messages: [
            { role: 'system', content: normalize(persona + profile + world + fixed + voice) },
            { role: 'user', content: history },
            { role: 'assistant', content: '聊天回复'.repeat(4000) },
            { role: 'system', content: '### 记忆宫殿 (Memory Palace)\n回忆\n## 那一天\n细节' },
            { role: 'system', content: '【主动消息排程·仅你可见】\n安排\n## 规则\n排程细则' },
        ] };
        const before = JSON.stringify(body);
        const blocks = buildPromptBreakdown(body)!;
        expect(blocks).toContainEqual({ label: '角色人设', chars: normalize(persona).length });
        expect(blocks).toContainEqual({ label: '用户设定', chars: normalize(profile).length });
        expect(blocks).toContainEqual({ label: '世界观与世界书', chars: normalize(world).length });
        expect(blocks).toContainEqual({ label: '固定聊天规则', chars: normalize(fixed).length });
        expect(blocks).toContainEqual({ label: '语音功能提示词', chars: normalize(voice).length });
        expect(blocks).toContainEqual({ label: '聊天历史·用户消息 ×1', chars: history.length });
        expect(blocks).toContainEqual({ label: '聊天历史·角色消息 ×1', chars: body.messages[2].content.length });
        expect(blocks).toContainEqual({ label: '记忆·本次召回', chars: body.messages[3].content.length });
        expect(blocks).toContainEqual({ label: '主动消息提示词', chars: body.messages[4].content.length });
        expect(blocks).toHaveLength(9);
        expect(blocks.reduce((sum, block) => sum + block.chars, 0)).toBe(body.messages.reduce((sum, msg) => sum + msg.content.length, 0));
        expect(JSON.stringify(body)).toBe(before);
    });

    it('ignores example boundaries inside fences and merges repeated categories across messages', () => {
        const fixed = rules + '```\n### 🎤 语音消息功能\n示例\n```\n规则结束';
        const messages = [
            { role: 'system', content: role + '人设\n' + fixed },
            { role: 'system', content: '### 最后，回到你自己\n共享原则' },
            { role: 'system', content: '[CRITICAL: 双语输出模式 - 必须严格遵守]\n规则' },
            { role: 'system', content: '[Reminder: 每句话必须使用翻译标签]' },
        ];
        const blocks = buildPromptBreakdown({ messages })!;
        expect(blocks.find(b => b.label === '语音功能提示词')).toBeUndefined();
        expect(blocks).toContainEqual({ label: '固定聊天规则', chars: fixed.length });
        expect(blocks).toContainEqual({ label: '双语功能提示词', chars: messages[2].content.length + messages[3].content.length });
        expect(blocks.reduce((sum, b) => sum + b.chars, 0)).toBe(messages.reduce((sum, m) => sum + m.content.length, 0));
    });

    it('keeps large late blocks visible when generic requests exceed the storage limit', () => {
        const messages = [
            { role: 'system', content: Array.from({ length: 90 }, (_, i) => `### 零碎${i}\n字\n`).join('') + '### 大块回忆\n' + '记'.repeat(20000) },
            { role: 'user', content: '聊'.repeat(10000) },
            { role: 'assistant', content: '答'.repeat(12000) },
        ];
        const blocks = buildPromptBreakdown({ messages })!;
        expect(blocks).toHaveLength(48);
        expect(blocks).toContainEqual({ label: '大块回忆', chars: '### 大块回忆\n'.length + 20000 });
        expect(blocks).toContainEqual({ label: '聊天历史·用户消息 ×1', chars: 10000 });
        expect(blocks).toContainEqual({ label: '聊天历史·角色消息 ×1', chars: 12000 });
        expect(blocks.reduce((sum, b) => sum + b.chars, 0)).toBe(messages.reduce((sum, m) => sum + m.content.length, 0));
    });

    it('classifies the real chat payload including voice and memory without a shared principles block', async () => {
        localStorage.clear();
        const payload = await buildChatRequestPayload({
            char: { id: 'breakdown-main', name: '露易丝', systemPrompt: '## 外貌\n亚麻灰色头发\n### 性格\n温柔',
                chatVoiceEnabled: true, timeAwarenessEnabled: false, contextRangeMode: 'manual', contextLimit: 10,
                worldview: '巴黎', mountedWorldbooks: [{ id: 'book', title: '设定', constant: true, content: '## 书内标题\n鸢尾花', position: 1 }] } as any,
            userProfile: { name: '咲咲', bio: '## 喜好\n漫画' } as any,
            groups: [], emojis: [], categories: [], contextLimit: 10, contextHighWaterMark: 0, recallEntryPoint: 'chat_app',
            historyMsgs: [{ id: 1, role: 'user', type: 'text', content: '早上好', timestamp: 1 }] as any[],
        });
        const before = JSON.stringify(payload.fullMessages);
        const blocks = buildPromptBreakdown({ messages: payload.fullMessages })!;
        const labels = blocks.map(block => block.label);
        for (const label of ['角色人设', '用户设定', '世界观与世界书', '记忆·长期记录', '固定聊天规则', '语音功能提示词', '聊天历史·用户消息 ×1']) expect(labels).toContain(label);
        expect(labels).not.toContain('共享表达原则');
        for (const heading of ['外貌', '性格', '喜好', '书内标题']) expect(labels).not.toContain(heading);
        expect(blocks.reduce((sum, block) => sum + block.chars, 0)).toBe(payload.fullMessages.reduce((sum, msg) => sum + String(msg.content).length, 0));
        expect(JSON.stringify(payload.fullMessages)).toBe(before);
        localStorage.clear();
    });
});
