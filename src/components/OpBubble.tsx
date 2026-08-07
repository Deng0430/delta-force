import { useState } from 'react'
import type { OperatorClass, OperatorUnit } from '../types'
import { OPERATOR_CLASSES, operatorClassOf } from '../config/operators'
import { profileOf, profilesByClass } from '../config/operatorProfiles'

interface OpBubbleProps {
  /** 目标干员 */
  op: OperatorUnit
  /** 气泡位置（地图容器像素坐标，由 MapView 传入） */
  position: { x: number; y: number }
  /** 选择具体干员（职业由干员决定，自动跟随） */
  onOperatorChange: (uid: string, operatorId: string) => void
  /** 切换干员状态（存活/重伤/阵亡） */
  onStatusChange: (uid: string, status: OperatorUnit['status']) => void
  onClose: () => void
}

const STATUS_OPTIONS: { value: OperatorUnit['status']; label: string }[] = [
  { value: 'alive', label: '存活' },
  { value: 'injured', label: '重伤' },
  { value: 'killed', label: '阵亡' },
]

/** 三级下拉导航状态 */
type MenuState =
  | { level: 1 } // 第一级：职业 / 状态
  | { level: 2; kind: 'class' } // 第二级：四个职业
  | { level: 2; kind: 'status' } // 第二级：三个状态
  | { level: 3; cls: OperatorClass } // 第三级：某职业的干员列表

/**
 * 干员三级下拉栏（点击地图干员弹出）：
 * - 第一级：职业 / 状态 两个入口
 * - 选"职业" → 第二级四个职业 → 第三级该职业的干员列表，点击干员即切换并关闭
 * - 选"状态" → 第二级三个状态，点击即切换并关闭
 * - 每级均有返回箭头可回到上一级；点击地图空白处关闭
 */
export default function OpBubble({ op, position, onOperatorChange, onStatusChange, onClose }: OpBubbleProps) {
  const [menu, setMenu] = useState<MenuState>({ level: 1 })
  const clsConf = operatorClassOf(op.cls)
  const profile = profileOf(op.operatorId)
  const statusLabel = STATUS_OPTIONS.find((s) => s.value === op.status)?.label ?? '存活'

  // 干员靠近地图顶部时，气泡改在干员下方展开，避免溢出
  const placeAbove = position.y > 110

  /** 面包屑标题：当前所在层级 */
  const title =
    menu.level === 1
      ? `${profile.name} · ${clsConf.name}`
      : menu.level === 2
        ? menu.kind === 'class'
          ? '选择职业'
          : '选择状态'
        : `选择${operatorClassOf(menu.cls).name}干员`

  /** 返回上一级 */
  const goBack = () => {
    if (menu.level === 3) setMenu({ level: 2, kind: 'class' })
    else if (menu.level === 2) setMenu({ level: 1 })
  }

  return (
    <div
      className={`op-bubble ${placeAbove ? 'above' : 'below'}`}
      style={{ left: position.x, top: position.y }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 顶栏：面包屑 + 关闭 */}
      <div className="op-bubble-head">
        {menu.level > 1 && (
          <button type="button" className="op-bubble-back" onClick={goBack} aria-label="返回">
            ‹
          </button>
        )}
        <span className="op-bubble-head-title">{title}</span>
        <button type="button" className="op-bubble-close" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </div>

      {/* 第一级：职业 / 状态 */}
      {menu.level === 1 && (
        <div className="op-bubble-menu">
          <button
            type="button"
            className="op-bubble-item"
            onClick={() => setMenu({ level: 2, kind: 'class' })}
          >
            <span className="op-bubble-item-label">职业</span>
            <span className="op-bubble-item-val">{clsConf.name}</span>
            <span className="op-bubble-caret" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="op-bubble-item"
            onClick={() => setMenu({ level: 2, kind: 'status' })}
          >
            <span className="op-bubble-item-label">状态</span>
            <span className="op-bubble-item-val">{statusLabel}</span>
            <span className="op-bubble-caret" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* 第二级：四个职业 */}
      {menu.level === 2 && menu.kind === 'class' && (
        <div className="op-bubble-menu">
          {OPERATOR_CLASSES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`op-bubble-item cls-${c.id} ${op.cls === c.id ? 'active' : ''}`}
              title={c.desc}
              onClick={() => setMenu({ level: 3, cls: c.id })}
            >
              <span className="op-bubble-item-label">{c.name}</span>
              <span className="op-bubble-caret" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}

      {/* 第二级：三个状态 */}
      {menu.level === 2 && menu.kind === 'status' && (
        <div className="op-bubble-menu">
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s.value}
              type="button"
              className={`op-bubble-item st-${s.value} ${op.status === s.value ? 'active' : ''}`}
              onClick={() => {
                if (op.status !== s.value) onStatusChange(op.uid, s.value)
                onClose()
              }}
            >
              <span className="op-bubble-item-label">{s.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* 第三级：某职业的干员列表 */}
      {menu.level === 3 && (
        <div className="op-bubble-menu">
          {profilesByClass()[menu.cls].map((p) => (
            <button
              key={p.id}
              type="button"
              className={`op-bubble-item ${op.operatorId === p.id ? 'active' : ''}`}
              title={p.fullName}
              onClick={() => {
                if (op.operatorId !== p.id) onOperatorChange(op.uid, p.id)
                onClose()
              }}
            >
              <span className="op-bubble-item-label">{p.name}</span>
              {op.operatorId === p.id && <span className="op-bubble-item-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
