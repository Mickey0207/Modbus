import React from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';

// 通用玻璃態 Modal 組件（維持原有 API，優化外觀）
const GlassModal = ({
  isOpen,
  onClose,
  title,
  children,
  size = 'max-w-4xl',
  showCloseButton = true,
  headerClass = '',
  footer = null,
  actions = [],
  maxHeight = 'max-h-[90vh]',
  contentMaxHeight = 'max-h-[calc(90vh-80px)]',
  baseVh = 90,
  autoSize = true,
}) => {
  if (!isOpen) return null;

  // Map Tailwind-like size tokens to actual maxWidth values
  const sizeToMaxWidth = (s) => {
    const map = {
      'max-w-sm': 640,
      'max-w-md': 768,
      'max-w-lg': 896,
      'max-w-xl': 1024,
      'max-w-2xl': 1120,
      'max-w-3xl': 1280,
      'max-w-4xl': 1440,
      'max-w-5xl': 1600,
  // 讓預設彈窗更窄，同時扣除外層 padding，避免水平溢出
  'max-w-[98vw]': 'calc(92vw - 32px)',
    };
    return map[s] || (typeof s === 'number' ? s : 1120);
  };
  const computedMaxWidth = sizeToMaxWidth(size);
  // 動態計算內容區域高度，依據是否有標題與底部
  const headerH = title ? 56 : 0;
  const footerH = (footer || (actions && actions.length > 0)) ? 56 : 0;
  const contentHeight = `calc(${baseVh}vh - ${headerH + footerH}px)`;

  return (
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center p-4"
      style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 100000 }}
    >
      {/* 玻璃態背景遮罩 */}
      <div
        className="absolute inset-0"
        onClick={onClose}
        style={{ position: 'absolute', inset: 0, background: 'rgba(16,16,28,0.45)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
      />

      {/* 玻璃態彈出視窗 */}
      <div
        className={`relative ${size} ${autoSize ? '' : 'w-full'} ${maxHeight} overflow-hidden rounded-3xl bg-white/90 backdrop-blur-xl border border-white/40 shadow-2xl`}
        style={{
          position: 'relative',
          display: autoSize ? 'inline-block' : 'block',
          width: autoSize ? 'auto' : '100%',
          minWidth: 320,
          maxWidth: computedMaxWidth,
          maxHeight: `${baseVh}vh`,
          borderRadius: 22,
          background: 'rgba(255,255,255,0.92)',
          backdropFilter: 'saturate(120%) blur(14px)',
          WebkitBackdropFilter: 'saturate(120%) blur(14px)',
          border: '1px solid rgba(0,0,0,0.06)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.24)'
        }}
      >
        {/* 標題列 */}
        {title && (
          <div
            className={`px-6 py-4 rounded-t-3xl ${headerClass}`}
            style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white', borderBottom: '1px solid rgba(255,255,255,0.2)' }}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold font-chinese" style={{ margin: 0 }}>{title}</h2>
              {showCloseButton && (
                <button
                  onClick={onClose}
                  className="p-2 rounded-lg transition-colors"
                  style={{ padding: 8, borderRadius: 8, background: 'transparent', color: 'white' }}
                  title="關閉"
                >
                  <XMarkIcon className="w-6 h-6" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* 內容區域 */}
        <div
          className={`relative overflow-y-auto ${contentMaxHeight}`}
          style={{ padding: 12, overflowX: 'hidden', maxWidth: 'calc(100vw - 64px)', maxHeight: contentHeight, display: 'flex', flexDirection: 'column' }}
        >
          {children}
        </div>

        {/* 底部區域：優先使用 footer，其次渲染 actions */}
        {(footer || actions.length > 0) && (
          <div
            className="px-6 py-4 border-t flex justify-end gap-3"
            style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, padding: '12px 16px', borderTop: '1px solid rgba(0,0,0,0.06)', background: 'rgba(250,250,252,0.85)' }}
          >
            {footer || (
              actions.map((a, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={a.onClick}
                  disabled={a.disabled}
                  className={`px-4 py-2 rounded-md transition ${a.disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
                  style={{ color: a.variant === 'secondary' ? '#333' : '#fff', background: a.variant === 'secondary' ? 'rgba(255,255,255,0.9)' : 'var(--brand-primary)', border: a.variant === 'secondary' ? '1px solid #e5e7eb' : 'none' }}
                >
                  {a.label}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default GlassModal;