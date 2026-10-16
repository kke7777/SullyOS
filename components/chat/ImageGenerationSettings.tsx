import React, { useEffect, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { DEFAULT_IMAGE_CONFIG, OPENROUTER_IMAGE_DEFAULTS, ImageGenerationConfig, ImageReference, normalizeImageConfig, validateImageConfig } from '../../utils/imageGeneration';
import { putImageBlob } from '../../utils/blobRef';
import TokenImg from '../os/TokenImg';
import ModelPicker from '../settings/ModelPicker';
import { fetchImageModels } from '../../utils/imageModelList';

export default function ImageGenerationSettings({ charId, onSaved }: { charId?: string; onSaved?: () => void }) {
    const { apiConfig, updateApiConfig, characters, updateCharacter, addToast } = useOS();
    const char = characters.find(c => c.id === charId);
    const [draft, setDraft] = useState(() => normalizeImageConfig(apiConfig.imageGeneration));
    const [enabled, setEnabled] = useState(char?.chatImageGenerationEnabled === true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [models, setModels] = useState<string[]>([]);
    const [showModels, setShowModels] = useState(false);
    const [loadingModels, setLoadingModels] = useState(false);
    const [modelError, setModelError] = useState('');
    const modelRequest = useRef<AbortController | null>(null);
    useEffect(() => () => modelRequest.current?.abort(), []);
    const change = <K extends keyof ImageGenerationConfig>(key: K, value: ImageGenerationConfig[K]) => {
        if (key === 'baseUrl' || key === 'apiKey' || key === 'apiType') {
            modelRequest.current?.abort();
            modelRequest.current = null;
            setLoadingModels(false);
            setModels([]);
            setShowModels(false);
            setModelError('');
        }
        setDraft(d => key === 'apiType' ? {
            ...d, apiType: value as ImageGenerationConfig['apiType'],
            ...(value === 'openrouter' ? OPENROUTER_IMAGE_DEFAULTS : { baseUrl: DEFAULT_IMAGE_CONFIG.baseUrl, model: DEFAULT_IMAGE_CONFIG.model }),
            apiKey: '',
        } : { ...d, [key]: value });
        setError('');
    };
    const loadModels = async () => {
        modelRequest.current?.abort();
        const request = new AbortController();
        modelRequest.current = request;
        setLoadingModels(true);
        setModelError('');
        try {
            const result = await fetchImageModels(draft, request.signal);
            if (request.signal.aborted || modelRequest.current !== request) return;
            setModels(result);
            setShowModels(true);
        } catch (e: any) {
            if (!request.signal.aborted && modelRequest.current === request) setModelError(e.message || '模型拉取失败');
        } finally {
            if (modelRequest.current === request) setLoadingModels(false);
        }
    };
    const editReference = (id: string, patch: Partial<ImageReference>) => setDraft(d => ({ ...d, references: d.references.map(r => r.id === id ? { ...r, ...patch } : r) }));
    const upload = async (file?: File) => {
        if (!file) return;
        setError('');
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setError('请选择 PNG、JPG 或 WebP 图片'); return; }
        if (file.size > 20 * 1024 * 1024) { setError('参考图不能超过 20MB'); return; }
        if (draft.references.length >= 16) { setError('最多保存 16 张参考图'); return; }
        setBusy(true);
        try {
            // Keep the uploaded original; no extra lossy processing changes the face reference.
            const imageRef = await putImageBlob(file);
            setDraft(d => ({ ...d, references: [...d.references, {
                id: crypto.randomUUID(), name: file.name.replace(/\.[^.]+$/, ''), description: '仅参考人物长相；服装、动作与画风按本次要求。', imageRef,
            }] }));
        } catch { setError('参考图保存失败，请重试'); }
        finally { setBusy(false); }
    };
    const save = () => {
        setError('');
        try {
            const config = normalizeImageConfig(draft);
            // References may be prepared before buying/filling a key. Enabled chats require a complete config.
            if (enabled || config.apiKey) validateImageConfig(config);
            else if (config.references.some(r => !r.name.trim())) throw new Error('请填写每张参考图对应的人物名称');
            updateApiConfig({ imageGeneration: config });
            if (char) updateCharacter(char.id, { chatImageGenerationEnabled: enabled });
            addToast('生图设置已保存', 'success');
            onSaved?.();
        } catch (e: any) { setError(e.message || '设置保存失败'); }
    };
    const field = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800';
    return <div className="space-y-4">
        {char && <label className="flex items-center justify-between gap-3 rounded-2xl bg-violet-50 p-3">
            <span className="text-sm font-bold text-violet-700">当前聊天启用生图</span>
            <input aria-label="当前聊天启用生图" type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="h-5 w-5 accent-violet-600" />
        </label>}
        <p className="text-xs leading-relaxed text-slate-500">开启后，聊天模型会读取下方的生图说明和人物参考图。告诉 TA 想画什么，生成的图片会回到聊天并存入相册。关闭时不额外发送这些内容。</p>
        <p className="text-xs leading-relaxed text-amber-700">生图期间请保持小手机在前台。聊天模型需支持看图和工具调用。</p>
        <label className="block space-y-1 text-xs font-bold">接口类型<select aria-label="生图接口类型" value={draft.apiType} onChange={e => change('apiType', e.target.value as ImageGenerationConfig['apiType'])} className={field}>
            <option value="openai">OpenAI 兼容</option><option value="openrouter">OpenRouter</option>
        </select></label>
        <p className="text-[11px] text-slate-400">切换接口类型会填入默认地址和模型，并清空 Key。人物参考图、尺寸和质量保留，保存后生效。</p>
        <label className="block space-y-1 text-xs font-bold">API 地址<input aria-label="生图 API 地址" value={draft.baseUrl} onChange={e => change('baseUrl', e.target.value)} placeholder={draft.apiType === 'openrouter' ? OPENROUTER_IMAGE_DEFAULTS.baseUrl : DEFAULT_IMAGE_CONFIG.baseUrl} className={field} /></label>
        <label className="block space-y-1 text-xs font-bold">API Key<input aria-label="生图 API Key" type="password" autoComplete="new-password" value={draft.apiKey} onChange={e => change('apiKey', e.target.value)} className={field} /></label>
        <label className="block space-y-1 text-xs font-bold">模型名称<input aria-label="生图模型" list="nuomi-image-models" value={draft.model} onChange={e => change('model', e.target.value)} className={field} /></label>
        <datalist id="nuomi-image-models">{(draft.apiType === 'openrouter' ? ['openai/gpt-image-2.5-flare', 'openai/gpt-image-2.5-sunburst'] : ['[0.15]gpt-image-2', '[0.15]gpt-image-2.5-flare', '[0.15]gpt-image-2.5-sunburst']).map(m => <option key={m} value={m} />)}</datalist>
        <div className="flex gap-2">
            <button type="button" disabled={loadingModels} onClick={() => void loadModels()} className="rounded-xl bg-violet-50 px-3 py-2 text-xs font-bold text-violet-700 disabled:opacity-50">{loadingModels ? '正在拉取…' : models.length ? '刷新模型列表' : '拉取模型'}</button>
            {models.length > 0 && <button type="button" aria-expanded={showModels} onClick={() => setShowModels(v => !v)} className="rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-700">{showModels ? '收起模型列表' : `选择模型（${models.length}）`}</button>}
        </div>
        {modelError && <p role="alert" className="text-xs text-rose-600">{modelError}</p>}
        {showModels && <div className="rounded-2xl border border-slate-200 p-2">
            <p className="mb-2 text-[11px] text-slate-500">已拉取 {models.length} 个{draft.apiType === 'openrouter' ? '生图' : ''}模型，点击自动填入上方模型框。{draft.apiType !== 'openrouter' && '渠道可能同时返回聊天等其他模型，请选择支持生图的型号。'}</p>
            <ModelPicker availableModels={models} localModel={draft.model} setLocalModel={model => change('model', model)} confirmModelPicker={model => { change('model', model); setShowModels(false); }} />
        </div>}
        <p className="text-[11px] text-slate-400">{draft.apiType === 'openrouter' ? '使用 OpenRouter 专用生图接口，支持人物参考图。模型使用完整 ID，例如 openai/gpt-image-2.5-sunburst。' : '模型名称完整保留渠道前缀。接口使用 OpenAI Images 标准，参考图走带图接口。'}</p>
        <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-xs font-bold">图片尺寸<select aria-label="生图尺寸" value={draft.size} onChange={e => change('size', e.target.value)} className={field}>
                <option value="1024x1024">方图 1024×1024</option><option value="1536x1024">横图 1536×1024</option><option value="1024x1536">竖图 1024×1536</option>
            </select></label>
            <label className="space-y-1 text-xs font-bold">图片质量<select aria-label="生图质量" value={draft.quality} onChange={e => change('quality', e.target.value as ImageGenerationConfig['quality'])} className={field}>
                <option value="auto">自动</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option><option value="xhigh">超高（xhigh）</option>
            </select></label>
        </div>
        <p className="text-[11px] text-slate-400">xhigh 适用于支持该质量档位的生图线路；渠道不支持时会返回错误，请手动选择其他档位。</p>
        <div className="space-y-3 border-t border-slate-100 pt-3">
            <div className="text-sm font-bold">人物参考图</div>
            <p className="text-[11px] leading-relaxed text-slate-500">接口和参考图在各会话间共用，生图开关按会话保存。开启时，以下参考图会发给当前聊天模型；生图工具只转交它选中的原图。备注可写“仅参考五官，不参考服装和画风”。</p>
            {draft.references.map((ref, i) => <div key={ref.id} className="space-y-2 rounded-2xl border border-slate-200 p-3">
                <div className="flex items-center gap-3"><TokenImg value={ref.imageRef} alt={ref.name} className="h-20 w-20 rounded-xl object-contain bg-slate-100" /><button type="button" onClick={() => change('references', draft.references.filter(r => r.id !== ref.id))} className="ml-auto text-xs text-rose-500">移除</button></div>
                <input aria-label={`参考图${i + 1}人物名称`} placeholder="人物名称，例如露露、咲咲" value={ref.name} onChange={e => editReference(ref.id, { name: e.target.value })} className={field} />
                <textarea aria-label={`参考图${i + 1}备注`} value={ref.description} onChange={e => editReference(ref.id, { description: e.target.value })} rows={2} className={field} />
            </div>)}
            <label className={`block cursor-pointer rounded-xl border border-dashed border-violet-300 py-3 text-center text-sm font-bold text-violet-600 ${busy ? 'opacity-50' : ''}`}>
                {busy ? '正在保存参考图…' : '＋ 添加人物参考图'}
                <input aria-label="添加人物参考图" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || draft.references.length >= 16} className="hidden" onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
        </div>
        {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
        <button type="button" disabled={busy} onClick={save} className="w-full rounded-xl bg-violet-600 py-3 text-sm font-bold text-white disabled:opacity-50">保存设置</button>
    </div>;
}
