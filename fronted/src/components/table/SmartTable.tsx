import React, { useMemo, useState } from 'react'
import { IconEye, IconEdit, IconTrash } from '@/components/icons'

export type Column<T> = {
  key: keyof T | string
  title: string
  width?: number
  sortable?: boolean
  render?: (value: any, record: T, rowIndex: number) => React.ReactNode
  className?: string
}

export type SmartTableProps<T> = {
  columns: Column<T>[]
  data: T[]
  rowKey: (row: T, index: number) => string | number
  className?: string
  expandable?: {
    // 回傳子表格 JSX
    expandedRowRender: (record: T, index: number) => React.ReactNode
    // 預設展開
    defaultExpandedRowKeys?: Array<string | number>
  }
  onSortChange?: (key: string, order: 'asc' | 'desc' | null) => void
  // 自訂操作欄渲染，若未提供則顯示預設圖示
  renderActions?: (row: T, index: number) => React.ReactNode
  // 操作欄位額外 class，例如加寬 for 燈號
  actionsClassName?: string
  // 是否顯示操作欄位（預設 true）
  showActions?: boolean
}

export default function SmartTable<T extends Record<string, any>>({ columns, data, rowKey, className, expandable, onSortChange, renderActions, actionsClassName, showActions = true }: SmartTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | null>(null)
  const [expanded, setExpanded] = useState<Set<string | number>>(new Set(expandable?.defaultExpandedRowKeys ?? []))

  const onHeaderClick = (col: Column<T>) => {
    if (!col.sortable) return
    const key = String(col.key)
    let next: 'asc' | 'desc' | null = 'asc'
    if (sortKey === key && sortOrder === 'asc') next = 'desc'
    else if (sortKey === key && sortOrder === 'desc') next = null
    setSortKey(next ? key : null)
    setSortOrder(next)
    onSortChange?.(key, next)
  }

  const sorted = useMemo(() => {
    if (!sortKey || !sortOrder) return data
    const copy = [...data]
    copy.sort((a, b) => {
      const av = a[sortKey as keyof T]
      const bv = b[sortKey as keyof T]
      if (av === bv) return 0
      if (av == null) return sortOrder === 'asc' ? -1 : 1
      if (bv == null) return sortOrder === 'asc' ? 1 : -1
      if (av > bv) return sortOrder === 'asc' ? 1 : -1
      return sortOrder === 'asc' ? -1 : 1
    })
    return copy
  }, [data, sortKey, sortOrder])

  const toggle = (k: string | number) => {
    const s = new Set(expanded)
    s.has(k) ? s.delete(k) : s.add(k)
    setExpanded(s)
  }

  // 將 <tbody> 子節點攤平成 <tr> 陣列，避免 Fragment/雙重 key 在表格內造成 React 靜態旗標錯誤
  const renderBodyRows = () => {
    const rows: React.ReactNode[] = []
    for (let i = 0; i < sorted.length; i++) {
      const row = sorted[i]
      const key = rowKey(row, i)
      const isOpen = expanded.has(key)
      rows.push(
        <tr key={`row-${String(key)}`}>
          {expandable && (
            <td className="col-expander">
              <button className="icon-btn" onClick={() => toggle(key)} aria-expanded={isOpen} title={isOpen? '收合' : '展開'}>
                <span className={"chev "+(isOpen?'open':'')}>▸</span>
              </button>
            </td>
          )}
          {columns.map(col => (
            <td key={String(col.key)} className={col.className}>
              {col.render ? col.render(row[col.key as keyof T], row, i) : String(row[col.key as keyof T] ?? '')}
            </td>
          ))}
          {showActions && (
            <td className={"col-actions" + (actionsClassName ? (" " + actionsClassName) : "")}>
              {renderActions ? (
                renderActions(row, i)
              ) : (
                <>
                  <button className="icon-btn" title="查看" aria-label="查看"><IconEye /></button>
                  <button className="icon-btn" title="編輯" aria-label="編輯"><IconEdit /></button>
                  <button className="icon-btn" title="刪除" aria-label="刪除"><IconTrash /></button>
                </>
              )}
            </td>
          )}
        </tr>
      )
      if (expandable && isOpen) {
        const colCount = columns.length + (expandable ? 1 : 0) + (showActions ? 1 : 0)
        rows.push(
          <tr key={`sub-${String(key)}`} className="subrow">
            <td colSpan={colCount}>
              <div className="subtable">
                {expandable.expandedRowRender(row, i)}
              </div>
            </td>
          </tr>
        )
      }
    }
    return rows
  }

  return (
    <div className={"smart-table" + (className ? (" " + className) : "") }>
      <table>
        <thead>
          <tr>
            {expandable && <th className="col-expander" />}
            {columns.map(col => (
              <th
                key={String(col.key)}
                style={{ width: col.width }}
                className={col.sortable ? 'is-sortable' : undefined}
                onClick={() => onHeaderClick(col)}
              >
                <span>{col.title}</span>
                {sortKey === String(col.key) && sortOrder && (
                  <span className={"sort-ind " + sortOrder} aria-hidden>▴</span>
                )}
              </th>
            ))}
            {showActions && <th className={"col-actions" + (actionsClassName ? (" " + actionsClassName) : "")}>操作</th>}
          </tr>
        </thead>
        <tbody>
          {renderBodyRows()}
        </tbody>
      </table>
    </div>
  )
}
