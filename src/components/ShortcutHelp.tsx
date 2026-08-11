import { useEffect, useState } from 'react'

const SHORTCUTS = [
  ['Backspace', '删除当前选中内容'],
  ['Ctrl + C', '复制当前选中对象'],
  ['Ctrl + V', '粘贴已复制对象'],
  ['Ctrl + Z', '撤回上一步'],
  ['Ctrl + Y', '恢复上一步'],
  ['Ctrl + 单击', '增选或取消单个对象'],
  ['Shift + 单击', '在对象列表中连续多选'],
] as const

export default function ShortcutHelp({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [open])

  return (
    <div className={`shortcut-help${compact ? ' compact' : ''}`}>
      <button type="button" className="shortcut-help-trigger" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="dialog" title="查看快捷键">
        <i className="fa-regular fa-keyboard" aria-hidden="true" /><span>快捷键</span>
      </button>
      {open ? (
        <div className="shortcut-help-popover" role="dialog" aria-label="快捷键列表">
          <header><strong>快捷键</strong><button type="button" onClick={() => setOpen(false)} aria-label="关闭快捷键列表">×</button></header>
          <dl>
            {SHORTCUTS.map(([keys, label]) => <div key={keys}><dt>{keys}</dt><dd>{label}</dd></div>)}
          </dl>
          <small>输入框聚焦时保留系统文字编辑行为。</small>
        </div>
      ) : null}
    </div>
  )
}
