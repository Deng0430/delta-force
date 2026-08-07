import { useEffect, useRef } from 'react'

interface OpRenameBarProps {
  /** 目标干员 uid */
  uid: string
  /** 当前昵称 */
  initial: string
  /** 位置（地图容器像素坐标） */
  position: { x: number; y: number }
  onSubmit: (uid: string, name: string) => void
  onClose: () => void
}

/**
 * 干员昵称快捷编辑浮层（双击地图棋子顶部代号弹出）：
 * - 自动聚焦并全选，回车提交、Esc 取消、失焦提交
 * - 空值/未修改不提交；提交或取消后立即关闭（防重复触发）
 */
export default function OpRenameBar({ uid, initial, position, onSubmit, onClose }: OpRenameBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const doneRef = useRef(false)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const commit = (value: string) => {
    if (doneRef.current) return
    doneRef.current = true
    const v = value.trim()
    if (v && v !== initial) onSubmit(uid, v)
    onClose()
  }

  return (
    <div
      className="op-rename"
      style={{ left: position.x, top: position.y }}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        defaultValue={initial}
        maxLength={6}
        placeholder="干员昵称"
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value)
          if (e.key === 'Escape') {
            doneRef.current = true
            onClose()
          }
        }}
        onBlur={(e) => commit(e.target.value)}
      />
    </div>
  )
}
