import React, { useEffect, useRef, useState } from 'react';
import Modal from '../os/Modal';
import { isEmojiImage } from '../../utils/emojiImport';

interface EmojiImportDialogProps {
    existingNames: string[];
    linkText: string;
    onLinkTextChange: (value: string) => void;
    onImportLinks: () => void | Promise<void>;
    onImportImage: (file: File, name: string) => Promise<void>;
    onClose: () => void;
}

const EmojiImportDialog: React.FC<EmojiImportDialogProps> = ({
    existingNames, linkText, onLinkTextChange, onImportLinks, onImportImage, onClose,
}) => {
    const [mode, setMode] = useState<'album' | 'links'>('album');
    const [file, setFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState('');
    const [previewReady, setPreviewReady] = useState(false);
    const [name, setName] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const fileInput = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!file) { setPreviewUrl(''); return; }
        const url = URL.createObjectURL(file);
        setPreviewUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [file]);

    const duplicate = !!name.trim() && existingNames.includes(name.trim());
    const disabled = saving || (mode === 'album'
        ? !file || !previewReady || !name.trim() || duplicate
        : !linkText.trim());
    const save = async () => {
        if (disabled || savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        setError('');
        try {
            if (mode === 'album' && file) await onImportImage(file, name.trim());
            else await onImportLinks();
        } catch (err) {
            setError(err instanceof Error ? err.message : '保存失败，请重试');
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };

    return <Modal title="添加表情包" isOpen onClose={() => { if (!savingRef.current) onClose(); }}
        footer={<>
            <button type="button" onClick={onClose} disabled={saving}
                className="px-4 py-4 bg-slate-100 text-slate-600 font-bold rounded-2xl disabled:opacity-40">取消</button>
            <button type="button" onClick={save} disabled={disabled}
                className="flex-1 py-4 bg-primary text-white font-bold rounded-2xl disabled:opacity-40">
                {saving ? '正在保存…' : '添加至当前分类'}
            </button>
        </>}>
        <div className="space-y-4">
            <div className="flex gap-2" role="group" aria-label="添加方式">
                {([['album', '从相册选择'], ['links', '链接导入']] as const).map(([value, label]) =>
                    <button key={value} type="button" disabled={saving} aria-pressed={mode === value}
                        onClick={() => { setMode(value); setError(''); }}
                        className={`flex-1 py-2 rounded-xl text-sm font-bold ${mode === value ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600'}`}>
                        {label}
                    </button>)}
            </div>
            <p className="text-xs text-slate-500">表情将添加到当前选中的分类。</p>
            {mode === 'album' ? <div className="space-y-3">
                <input ref={fileInput} type="file" accept="image/*" className="hidden" aria-label="选择表情图片"
                    disabled={saving} onChange={event => {
                        const selected = event.target.files?.[0];
                        event.target.value = '';
                        if (!selected) return;
                        setPreviewReady(false);
                        setError('');
                        if (!isEmojiImage(selected) || !selected.size) {
                            setFile(null);
                            setError('请选择有效的图片文件');
                            return;
                        }
                        setFile(selected);
                        setName(selected.name.replace(/\.[^.]+$/, ''));
                    }} />
                <button type="button" disabled={saving} onClick={() => fileInput.current?.click()}
                    className="w-full py-3 bg-slate-100 text-slate-700 font-bold rounded-2xl">
                    {file ? '重新选择图片' : '选择图片'}
                </button>
                {previewUrl && <div className="flex justify-center rounded-2xl bg-slate-50 p-3">
                    <img key={previewUrl} src={previewUrl} alt="表情包预览" className="w-32 h-32 object-contain"
                        onLoad={() => { setPreviewReady(true); setError(''); }}
                        onError={() => { setPreviewReady(false); setError('这张图片无法预览，请换一张图片'); }} />
                </div>}
                <label className="block text-sm text-slate-600">
                    表情包名称
                    <input type="text" value={name} disabled={saving} aria-invalid={duplicate}
                        onChange={event => { setName(event.target.value); setError(''); }}
                        placeholder="例如：小狗委屈求抱抱"
                        className="mt-2 w-full bg-slate-100 rounded-2xl px-4 py-3 text-slate-700" />
                </label>
                {duplicate && <p role="alert" className="text-xs text-red-500">已有同名表情包，请换一个名称。</p>}
                <p className="text-xs text-slate-500">起个能描述画面或情绪的名字，方便角色选用。支持 GIF 动图。</p>
            </div> : <textarea aria-label="表情包链接" value={linkText} disabled={saving}
                onChange={event => onLinkTextChange(event.target.value)} placeholder="名称--图片链接（每行一个）"
                className="w-full h-40 bg-slate-100 rounded-2xl p-4 resize-none" />}
            {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
        </div>
    </Modal>;
};

export default EmojiImportDialog;
