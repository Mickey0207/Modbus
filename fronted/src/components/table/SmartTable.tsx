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
}

export default function SmartTable<T extends Record<string, any>>({ columns, data, rowKey, expandable, onSortChange, renderActions, actionsClassName }: SmartTableProps<T>) {
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

  type RowProps = {
    row: T
    i: number
    keyVal: string | number
    isOpen: boolean
    columns: Column<T>[]
    actionsClassName?: string
    expandable?: SmartTableProps<T>['expandable']
    renderActions?: SmartTableProps<T>['renderActions']
    onToggle: (k: string | number) => void
  }

  const RowComponent = ({ row, i, keyVal, isOpen, columns, actionsClassName, expandable, renderActions, onToggle }: RowProps) => (
    <React.Fragment>
      <tr>
        {expandable && (
          <td className="col-expander">
            <button className="icon-btn" onClick={() => onToggle(keyVal)} aria-expanded={isOpen} title={isOpen? '收合' : '展開'}>
              <span className={"chev "+(isOpen?'open':'')}>▸</span>
            </button>
          </td>
        )}
        {columns.map(col => (
          <td key={String(col.key)} className={col.className}>
            {col.render ? col.render(row[col.key as keyof T], row, i) : String(row[col.key as keyof T] ?? '')}
          </td>
        ))}
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
      </tr>
      {expandable && isOpen && (
        <tr className="subrow">
          <td colSpan={(columns.length + 2)}>
            <div className="subtable">
              {expandable.expandedRowRender(row, i)}
            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  )

  const MemoRow = React.memo(RowComponent, (prev, next) => {
    return (
      prev.row === next.row &&
      prev.isOpen === next.isOpen &&
      prev.columns === next.columns &&
      prev.renderActions === next.renderActions &&
      prev.actionsClassName === next.actionsClassName &&
      prev.expandable === next.expandable
    )
  })

  return (
    <div className="smart-table">
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
            <th className={"col-actions" + (actionsClassName ? (" " + actionsClassName) : "")}>操作</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => {
            const key = rowKey(row, i)
            const isOpen = expanded.has(key)
            return (
              <MemoRow
                key={String(key)}
                row={row}
                i={i}
                keyVal={key}
                isOpen={isOpen}
                columns={columns}
                actionsClassName={actionsClassName}
                expandable={expandable}
                renderActions={renderActions}
                onToggle={toggle}
              />
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
