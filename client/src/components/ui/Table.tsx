import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Table as AntTable } from 'antd';
import type { ColumnsType, TableProps } from 'antd/es/table';

export type AppTableProps<RecordType extends object = any> = TableProps<RecordType> & {
  // 自定義標題（若傳入非 function，我們會在表格外部自製 Header 區塊顯示，避免 antd 誤判）
  titleText?: string;
  // 顯示 CSV 匯出按鈕
  showExport?: boolean;
  // 匯出檔名（不含副檔名）
  exportFileName?: string;
  // 開啟欄位可調寬
  resizableColumns?: boolean;
  // 密度（對應 antd size）
  density?: 'default' | 'compact' | 'comfortable';
};

// 取得欄位唯一 key
function getColKey(c: any, i: number): string {
  const di = Array.isArray(c?.dataIndex) ? c.dataIndex.join('.') : c?.dataIndex;
  return String(c?.key ?? di ?? i);
}

// 依 dataIndex 支援陣列 path 的讀取
function getValueByDataIndex(row: any, dataIndex: any): any {
  if (!dataIndex) return undefined;
  if (Array.isArray(dataIndex)) {
    return dataIndex.reduce((acc, k) => (acc == null ? acc : acc[k]), row);
  }
  return row?.[dataIndex];
}

// 產生 CSV 內容（最佳努力：若無 dataIndex 則留空）
function toCSV(rows: any[], columns: ColumnsType<any>) {
  const colArr = (columns as any[]) || [];
  const headers = colArr.map(c => {
    const t = c?.title;
    if (typeof t === 'string') return t;
    if (typeof t === 'number') return String(t);
    return (Array.isArray(c?.dataIndex) ? c.dataIndex.join('.') : c?.dataIndex) ?? '';
  }).join(',');
  const lines = rows.map(row => colArr.map(c => {
    const v = getValueByDataIndex(row, c?.dataIndex);
    const s = v == null ? '' : String(v);
    return s.includes(',') || s.includes('\n') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(','));
  return [headers, ...lines].join('\n');
}

export default function Table<RecordType extends object = any>(props: AppTableProps<RecordType>) {
  const {
    title: incomingTitle,
    titleText,
    showExport,
    exportFileName = 'export',
    className,
    columns,
    dataSource,
    rowKey = 'id',
    resizableColumns = true,
    density = 'default',
    pagination: incomingPagination,
    tableLayout: incomingTableLayout,
    size: incomingSize,
    ...rest
  } = props as AppTableProps<RecordType> & { title?: TableProps<RecordType>['title'] | React.ReactNode };

  // 標題正規化：若傳入為 function，交給 antd；否則在外層自繪 Header，避免 antd 某些情況嘗試呼叫非函數導致的錯誤
  const antdTitle = (typeof incomingTitle === 'function' ? incomingTitle : undefined) as TableProps<RecordType>['title'] | undefined;
  const headerTitleNode: React.ReactNode = titleText ?? (typeof incomingTitle !== 'function' ? incomingTitle : undefined);

  // 匯出 CSV
  const handleExport = () => {
    if (!dataSource || !columns) return;
    const csv = toCSV(dataSource as any[], columns as ColumnsType<any>);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${exportFileName}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 欄位寬度狀態
  const initialWidths = useMemo(() => {
    const widths: Record<string, number> = {};
    (columns as any[] | undefined)?.forEach((c, i) => {
      const key = getColKey(c, i);
      if (c && typeof c.width === 'number') widths[key] = c.width as number;
    });
    return widths;
  }, [columns]);
  const [colWidths, setColWidths] = useState<Record<string, number>>(initialWidths);
  const dragRef = useRef<{ key: string; startX: number; startW: number } | null>(null);

  // 當 columns 或其 width 設定變動時，重置內部欄寬狀態，讓「初始寬度」改動能即時生效
  useEffect(() => {
    setColWidths(initialWidths);
  }, [initialWidths]);

  const startDrag = (key: string, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const startW = colWidths[key] ?? 160;
    dragRef.current = { key, startX: e.clientX, startW };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const next = { ...colWidths };
      next[dragRef.current.key] = Math.max(80, dragRef.current.startW + dx);
      setColWidths(next);
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // 產生帶有拖拉手把與固定寬度樣式的欄位
  const columnsWithResize = useMemo(() => {
    if (!columns) return columns as any;
    if (!resizableColumns) return columns as any;
    return (columns as any[]).map((c, i) => {
      const key = getColKey(c, i);
      const width = colWidths[key] ?? (typeof c.width === 'number' ? c.width : undefined);
      const resizable = c?.resizable !== false; // 允許每欄位關閉拖拉

      const titleNode = (
        <div style={{ position: 'relative', paddingRight: 12 }}>
          <span>{c.title}</span>
          {resizable && (
            <span
              onMouseDown={(e) => startDrag(key, e)}
              style={{
                position: 'absolute',
                right: 0,
                top: 0,
                width: 8,
                height: '100%',
                cursor: 'col-resize',
                userSelect: 'none',
                zIndex: 1,
              }}
            />
          )}
        </div>
      );

      const mergeHeader = (c.onHeaderCell as any) || (() => ({}));
      const mergeCell = (c.onCell as any) || (() => ({}));

      const fixedStyle = width ? { width, minWidth: width, maxWidth: width } : undefined;
      return {
        ...c,
        title: titleNode,
        width,
        onHeaderCell: (col: any) => {
          const base = mergeHeader(col) || {};
          return { ...base, style: { ...(base.style || {}), ...(fixedStyle || {}) } };
        },
        onCell: (row: any) => {
          const base = mergeCell(row) || {};
          return { ...base, style: { ...(base.style || {}), ...(fixedStyle || {}) } };
        },
      };
    });
  }, [columns, resizableColumns, colWidths]);

  // 依總欄寬推導 scroll.x（尊重使用者自行傳入）
  const tableScroll = useMemo(() => {
    const userScroll = (rest as any).scroll || {};
    if (!resizableColumns || !columnsWithResize) return userScroll;
    const total = (columnsWithResize as any[])
      .reduce((acc, c) => acc + (Number(c.width) || 0), 0);
    if (total > 0) return { ...userScroll, x: Math.max(total, userScroll.x || 0) };
    return userScroll;
  }, [resizableColumns, columnsWithResize, rest]);

  // 密度對應 antd size
  const sizeMap: Record<NonNullable<AppTableProps['density']>, 'small' | 'middle' | 'large'> = {
    compact: 'small',
    default: 'middle',
    comfortable: 'large',
  } as const;
  const tableSize = (incomingSize as any) ?? sizeMap[density];
  const tableLayoutProp = incomingTableLayout ?? (resizableColumns ? 'fixed' : undefined);
  const pagination = incomingPagination ?? false; // 預設無分頁，但尊重外部傳入

  return (
    <div className={`glass rounded-2xl shadow-md overflow-visible ${density === 'compact' ? 'density-compact' : ''} ${className || ''}`}>
      {(headerTitleNode || showExport) && (
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <div className="text-lg font-semibold text-gray-900 font-chinese" style={{ margin: 0 }}>
            {typeof headerTitleNode === 'string' ? (
              <h3 style={{ margin: 0 }}>{headerTitleNode}</h3>
            ) : (
              headerTitleNode
            )}
          </div>
          {showExport && (
            <button
              className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors flex items-center gap-2 font-chinese"
              onClick={handleExport}
              type="button"
            >
              匯出
            </button>
          )}
        </div>
      )}
      <div style={{ maxWidth: '100%' }}>
        <AntTable<RecordType>
          rowKey={rowKey as any}
          columns={(resizableColumns ? (columnsWithResize as any) : columns) as any}
          dataSource={dataSource}
          pagination={pagination as any}
          title={antdTitle}
          scroll={tableScroll}
          size={tableSize as any}
          tableLayout={tableLayoutProp as any}
          {...rest}
        />
      </div>
    </div>
  );
}