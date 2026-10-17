import React, { useRef, useState } from 'react';
import { DownloadSimple } from '@phosphor-icons/react';
import { Capacitor } from '@capacitor/core';
import { useOS } from '../../context/OSContext';
import { saveImageToDevice } from '../../utils/saveImage';

export default function SaveImageButton({ value, className = '' }: { value: string; className?: string }) {
    const { addToast } = useOS();
    const saving = useRef(false);
    const [busy, setBusy] = useState(false);
    const label = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android' ? '保存到手机相册' : '保存图片';
    const save = async () => {
        if (saving.current) return;
        saving.current = true;
        setBusy(true);
        try {
            const result = await saveImageToDevice(value);
            if (result !== 'cancelled') addToast(result === 'saved' ? '已保存到手机相册「糯米机」' : result === 'shared' ? '已打开系统保存/分享' : '图片已开始下载', 'success');
        } catch (e: any) {
            addToast(e.message || '保存图片失败，请重试', 'error');
        } finally { saving.current = false; setBusy(false); }
    };
    return <button type="button" aria-label={label} title={label} disabled={busy} onClick={() => void save()} className={`photo-save-button inline-flex items-center justify-center gap-1 rounded-full px-3 py-2 text-xs text-white disabled:opacity-50 ${className}`}>
        <DownloadSimple size={20} /><span>{busy ? '正在保存…' : label}</span>
    </button>;
}
