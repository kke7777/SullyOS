// @vitest-environment jsdom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import MessageItem from '../components/chat/MessageItem';
import ChatInputArea from '../components/chat/ChatInputArea';
import { PRESET_THEMES } from '../components/chat/ChatConstants';

const noop = () => {};

it('renders an old message normally while hiding its saved heart metadata', () => {
  const markup = renderToStaticMarkup(<MessageItem
    msg={{ id: 1, charId: 'test', role: 'assistant', type: 'text', content: '普通回复仍然保留。',
      timestamp: Date.now(), metadata: { thinkingChain: '旧备份里的心象内容' } } as any}
    isFirstInGroup isLastInGroup activeTheme={PRESET_THEMES.default}
    charAvatar="" userAvatar="" charName="测试角色" onLongPress={noop} onReply={noop}
    selectionMode={false} isSelected={false} onToggleSelect={noop}
  />);
  expect(markup).toContain('普通回复仍然保留。');
  expect(markup).not.toContain('旧备份里的心象内容');
  expect(markup).not.toContain('sully-psyche');
});

it('keeps the chat action panel usable without the heart entry', () => {
  const markup = renderToStaticMarkup(<ChatInputArea
    input="" setInput={noop} isTyping={false} selectionMode={false} showPanel="actions"
    setShowPanel={noop} onSend={noop} onDeleteSelected={noop} selectedCount={0}
    emojis={[]} onPanelAction={noop} onImageSelect={noop} isSummarizing={false}
    onReroll={noop} canReroll={false}
  />);
  expect(markup).toContain('聊天装扮');
  expect(markup).not.toContain('展示思考');
  expect(markup).not.toContain('思考已开');
});
