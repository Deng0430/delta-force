import { OPERATOR_CLASSES, operatorClassOf } from '../config/operators'
import { OPERATOR_PROFILES, profileOf, profilesByClass } from '../config/operatorProfiles'
import type { OperatorUnit } from '../types'

interface OperatorEditPopupProps {
  /** 正在编辑的干员 */
  op: OperatorUnit
  onClose: () => void
  /** 修改为指定干员（红狼 → 蜂医，职业自动跟随） */
  onSetOperator: (uid: string, operatorId: string) => void
  /** 修改状态 */
  onSetStatus: (uid: string, status: OperatorUnit['status']) => void
}

const STATUS_OPTIONS: { value: OperatorUnit['status']; label: string }[] = [
  { value: 'alive', label: '存活' },
  { value: 'injured', label: '重伤' },
  { value: 'killed', label: '阵亡' },
]

/**
 * 干员编辑弹窗（点击地图干员标记弹出）：
 * - 当前干员信息（头像/代号/本名/职业）
 * - 职业分组干员选择网格（点击切换，如 红狼 → 蜂医）
 * - 状态切换（存活/重伤/阵亡）
 */
export default function OperatorEditPopup({ op, onClose, onSetOperator, onSetStatus }: OperatorEditPopupProps) {
  const profile = profileOf(op.operatorId)
  const byClass = profilesByClass()
  const current = op.cls

  return (
    <div className="op-edit-mask" onClick={onClose}>
      <div className="op-edit-popup" onClick={(e) => e.stopPropagation()}>
        {/* 头部：当前干员信息 */}
        <div className="op-edit-head">
          <img className="op-edit-avatar" src={profile.avatarUrl} alt={profile.name} draggable={false} />
          <div className="op-edit-info">
            <div className="op-edit-name">
              {profile.name}
              <span className="op-edit-code">（{op.name}）</span>
            </div>
            <div className="op-edit-fullname">{profile.fullName}</div>
            <div className="op-edit-cls">
              <span className={`op-edit-cls-tag ${op.cls}`}>{operatorClassOf(op.cls).name}</span>
              <span className="op-edit-desc">{operatorClassOf(op.cls).desc}</span>
            </div>
          </div>
          <button type="button" className="op-edit-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        {/* 状态切换 */}
        <div className="op-edit-section">
          <div className="op-edit-label">状态</div>
          <div className="op-edit-status">
            {STATUS_OPTIONS.map((s) => (
              <button
                key={s.value}
                type="button"
                className={`wg-status-btn ${s.value} ${op.status === s.value ? 'active' : ''}`}
                onClick={() => onSetStatus(op.uid, s.value)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* 职业分组干员选择 */}
        <div className="op-edit-section">
          <div className="op-edit-label">更换干员（职业随干员变化）</div>
          <div className="op-edit-groups">
            {OPERATOR_CLASSES.map((c) => {
              const list = byClass[c.id]
              if (list.length === 0) return null
              return (
                <div key={c.id} className={`op-edit-group ${current === c.id ? 'current' : ''}`}>
                  <div className="op-edit-group-title">
                    <span className="op-edit-group-dot" style={{ background: c.color }} />
                    {c.name}
                  </div>
                  <div className="op-edit-grid">
                    {list.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={`op-edit-grid-item ${op.operatorId === p.id ? 'active' : ''}`}
                        title={`${p.name} · ${p.fullName}`}
                        onClick={() => {
                          if (op.operatorId !== p.id) onSetOperator(op.uid, p.id)
                        }}
                      >
                        <img src={p.avatarUrl} alt={p.name} draggable={false} />
                        <span>{p.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

/** 干员选择分组列表（供左侧面板下拉复用） */
export function OperatorSelectGrouped({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (operatorId: string) => void
  disabled?: boolean
}) {
  return (
    <select
      className="wg-operator-select"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {OPERATOR_CLASSES.map((c) => {
        const list = OPERATOR_PROFILES.filter((p) => p.cls === c.id)
        if (list.length === 0) return null
        return (
          <optgroup key={c.id} label={c.name}>
            {list.map((p) => (
              <option key={p.id} value={p.id} title={`${p.name} · ${p.fullName}`}>
                {p.name}
              </option>
            ))}
          </optgroup>
        )
      })}
    </select>
  )
}
