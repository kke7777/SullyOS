// @vitest-environment jsdom
import {act, createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {expect, it, vi} from 'vitest';
import EmotionSettingsPanel from '../components/chat/EmotionSettingsPanel';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
it('emotion can toggle with schedule off and saving API does not enable it', async () => {
 const host=document.createElement('div'),root=createRoot(host),onToggle=vi.fn(),onSave=vi.fn();
 const char:any={id:'panel',scheduleFeatureEnabled:false,emotionConfig:{enabled:false,independent:true}};
 try {
  await act(async()=>root.render(createElement(EmotionSettingsPanel,{char,apiPresets:[{id:'p',name:'Test API',config:{baseUrl:'https://test.invalid',apiKey:'test',model:'test'}}] as any,addApiPreset:vi.fn(),onToggle,onSave,onClearBuffs:vi.fn()})));
  const toggle=host.querySelector('[role="switch"]') as HTMLButtonElement;
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  await act(async()=>toggle.click());expect(onToggle).toHaveBeenCalledOnce();expect(onSave).not.toHaveBeenCalled();
  await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent?.includes('Test API'))!.click());
  await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='保存副 API 配置')!.click());
  expect(onSave).toHaveBeenCalledWith({enabled:false,independent:true,api:{baseUrl:'https://test.invalid',apiKey:'test',model:'test'}});
 } finally {await act(async()=>root.unmount());}
});
