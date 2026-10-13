
import React, { useState } from 'react';
import { useOS } from '../../context/OSContext';
import Modal from './Modal';
import { NETWORK_SELF_CHECK_STEPS } from '../../utils/networkFailureDiagnosis';

// Top time/battery indicators are omitted for this layout. Keep diagnostics
// independent; the OS clock and AI time-awareness are owned by OSContext.
const StatusBar: React.FC = () => {
  const { systemLogs, clearLogs } = useOS();
  const [showLogModal, setShowLogModal] = useState(false);

  const hasError = systemLogs.length > 0;
  const hasIndexedDbBackingStoreError = systemLogs.some(log => {
    const text = `${log.message} ${log.detail || ''}`.toLowerCase();
    return text.includes('backing store') || text.includes('indexeddb.open');
  });
  // 「连不上」这类错误光看日志没用，多半要用户自己在设备上试几刀才能定位，
  // 所以顺手把自查顺序摆在终端里，省得每次都要去群里问。
  const hasNetworkFailure = systemLogs.some(log => log.type === 'network' && log.source === 'Network');

  return (
    <>
      {/* Independent Error Indicator */}
      {hasError && (
          <button 
              onClick={() => setShowLogModal(true)} 
              className="fixed left-1/2 -translate-x-1/2 z-[60] bg-red-500/90 text-white rounded-full px-4 py-1.5 text-[10px] font-bold shadow-lg animate-pulse flex items-center gap-1.5 backdrop-blur-md border border-white/20 pointer-events-auto"
              style={{ top: 'calc(var(--chrome-top) + 1rem)' }}
          >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                  <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
              </svg>
              <span>SYSTEM ERROR</span>
          </button>
      )}

      <Modal 
          isOpen={showLogModal} 
          title="系统调试终端" 
          onClose={() => setShowLogModal(false)}
          footer={
              <div className="flex gap-2 w-full">
                  <button onClick={() => { navigator.clipboard.writeText(JSON.stringify(systemLogs, null, 2)); }} className="flex-1 py-3 bg-slate-100 font-bold rounded-xl text-slate-600">复制 JSON</button>
                  <button onClick={clearLogs} className="flex-1 py-3 bg-red-500 text-white font-bold rounded-xl shadow-lg shadow-red-200">清空日志</button>
              </div>
          }
      >
          {hasIndexedDbBackingStoreError && (
              <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
                  <div className="font-bold mb-1">检测到浏览器存储无法打开</div>
                  <div>请先不要清除浏览器数据、格式化或重置 SullyOS·糯米机。彻底关闭浏览器后重启设备，并确认仍从原来的网址进入；若恢复打开，请立即完整导出备份。此错误通常来自浏览器/WebView 的站点存储，而不是应用主动删除数据。</div>
              </div>
          )}
          {hasNetworkFailure && (
              <details className="mb-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs leading-relaxed text-sky-900">
                  <summary className="font-bold cursor-pointer select-none">网络连接失败？按这个顺序自查</summary>
                  <ol className="mt-2 list-decimal pl-4 space-y-1">
                      {NETWORK_SELF_CHECK_STEPS.map(step => <li key={step}>{step}</li>)}
                  </ol>
                  <div className="mt-2 opacity-80">日志里的「初判」和「连通性复检」两行已经替你缩小了范围，先看那两行再动手。</div>
              </details>
          )}
          <div className="h-64 bg-slate-900 rounded-xl p-3 overflow-y-auto font-mono text-[10px] space-y-2 no-scrollbar shadow-inner">
              {systemLogs.length === 0 ? (
                  <div className="text-slate-500 text-center mt-20">系统运行正常，暂无错误日志。</div>
              ) : (
                  systemLogs.map(log => (
                      <div key={log.id} className="border-b border-white/10 pb-2 mb-2 last:border-0 last:mb-0 last:pb-0">
                          <div className="flex justify-between items-start text-white/50 mb-1">
                              <span>[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                              <span className={`uppercase font-bold ${log.type === 'error' ? 'text-red-400' : 'text-orange-400'}`}>{log.type}</span>
                          </div>
                          <div className="text-white font-bold mb-1 break-words">{log.message}</div>
                          {log.detail && (
                              <pre className="text-slate-400 whitespace-pre-wrap break-all bg-black/30 p-2 rounded">{log.detail}</pre>
                          )}
                          <div className="text-white/30 text-right mt-1">Src: {log.source}</div>
                      </div>
                  ))
              )}
          </div>
      </Modal>
    </>
  );
};

export default StatusBar;
