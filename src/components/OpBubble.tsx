import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { OperatorUnit } from '../types'
import { OPERATOR_CLASSES, operatorClassOf } from '../config/operators'
import { profileOf, profilesByClass } from '../config/operatorProfiles'
import { operatorSkillsOf } from '../config/operatorSkills'
import { tacticalItemsOf, TACTICAL_ITEM_TYPE_LABEL } from '../config/operatorTacticalItems'
import type { OperatorTacticalItemDefinition, TacticalItemUseMode } from '../config/operatorTacticalItems'
import { platform } from '../platform'

interface OpBubbleProps {
  op: OperatorUnit
  position: { x: number; y: number }
  onOperatorChange: (uid: string, operatorId: string) => void
  onStatusChange: (uid: string, status: OperatorUnit['status']) => void
  onSkillUse: (uid: string, slot?: 1 | 2 | 3 | 4) => void
  onTacticalItemUse: (uid: string, item: OperatorTacticalItemDefinition, mode: TacticalItemUseMode) => void
  onClose: () => void
}

const STATUS_OPTIONS: { value: OperatorUnit['status']; label: string; icon: string }[] = [
  { value: 'alive', label: '存活', icon: 'fa-heart-pulse' },
  { value: 'injured', label: '重伤', icon: 'fa-kit-medical' },
  { value: 'killed', label: '阵亡', icon: 'fa-skull' },
]

type Submenu = 'operator' | 'status' | 'skill' | 'tactical-item' | null

/** 桌面悬浮展开下一级；触屏点击进入。只有点击最终选项才执行操作。 */
export default function OpBubble({ op, position, onOperatorChange, onStatusChange, onSkillUse, onTacticalItemUse, onClose }: OpBubbleProps) {
  const [submenu, setSubmenu] = useState<Submenu>(null)
  const closeTimer = useRef<number | null>(null)
  const profile = profileOf(op.operatorId)
  const clsConf = operatorClassOf(op.cls)
  const groupedProfiles = profilesByClass()
  const statusLabel = STATUS_OPTIONS.find((status) => status.value === op.status)?.label ?? '存活'
  const skills = operatorSkillsOf(op.operatorId)
  const tacticalItems = tacticalItemsOf(op.cls)
  const androidTouch = platform.kind === 'android'
  const placeAbove = position.y > 110
  const openLeft = position.x > window.innerWidth - 430

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  useEffect(() => () => {
    if (closeTimer.current != null) window.clearTimeout(closeTimer.current)
  }, [])

  const openSubmenu = (next: Exclude<Submenu, null>) => {
    if (closeTimer.current != null) window.clearTimeout(closeTimer.current)
    closeTimer.current = null
    setSubmenu(next)
  }

  const scheduleClose = () => {
    if (closeTimer.current != null) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setSubmenu(null), 160)
  }

  const useTacticalItem = (item: OperatorTacticalItemDefinition, mode: TacticalItemUseMode) => {
    onTacticalItemUse(op.uid, item, mode)
    onClose()
  }

  return (
    <div
      className={`op-bubble op-cascade ${placeAbove ? 'above' : 'below'} ${openLeft ? 'open-left' : ''}`}
      style={{ left: position.x, top: position.y }}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="op-bubble-panel op-cascade-root">
        <div className="op-bubble-head">
          {submenu && <button type="button" className="op-bubble-back op-cascade-mobile-only" onClick={() => setSubmenu(null)} aria-label="返回"><i className="fa-solid fa-chevron-left" /></button>}
          <img className="op-cascade-current-avatar" src={profile.avatarUrl} alt="" draggable={false} />
          <span className="op-bubble-head-title">{profile.name} · {clsConf.name}</span>
          <button type="button" className="op-bubble-close" onClick={onClose} aria-label="关闭"><i className="fa-solid fa-xmark" /></button>
        </div>
        <div className={`op-bubble-menu op-cascade-main ${submenu ? 'has-submenu' : ''}`}>
          <button type="button" className={`op-bubble-item ${submenu === 'operator' ? 'active' : ''}`} onMouseEnter={androidTouch ? undefined : () => openSubmenu('operator')} onMouseLeave={androidTouch ? undefined : scheduleClose} onClick={() => openSubmenu('operator')}>
            <i className="fa-solid fa-user-group op-cascade-item-icon" />
            <span className="op-bubble-item-label">更换干员</span>
            <i className="fa-solid fa-chevron-right op-cascade-chevron" />
          </button>
          <button type="button" className={`op-bubble-item ${submenu === 'status' ? 'active' : ''}`} onMouseEnter={androidTouch ? undefined : () => openSubmenu('status')} onMouseLeave={androidTouch ? undefined : scheduleClose} onClick={() => openSubmenu('status')}>
            <i className="fa-solid fa-heart-pulse op-cascade-item-icon" />
            <span className="op-bubble-item-label">调整状态</span>
            <span className="op-bubble-item-val">{statusLabel}</span>
            <i className="fa-solid fa-chevron-right op-cascade-chevron" />
          </button>
          <button type="button" className={`op-bubble-item ${submenu === 'skill' ? 'active' : ''}`} onMouseEnter={androidTouch ? undefined : () => openSubmenu('skill')} onMouseLeave={androidTouch ? undefined : scheduleClose} onClick={() => openSubmenu('skill')}>
            <i className="fa-solid fa-bolt op-cascade-item-icon" />
            <span className="op-bubble-item-label">使用技能</span>
            {op.activeSkillSlot && <span className="op-bubble-item-val">技能 {op.activeSkillSlot}</span>}
            <i className="fa-solid fa-chevron-right op-cascade-chevron" />
          </button>
          <button type="button" className={`op-bubble-item ${submenu === 'tactical-item' ? 'active' : ''}`} onMouseEnter={androidTouch ? undefined : () => openSubmenu('tactical-item')} onMouseLeave={androidTouch ? undefined : scheduleClose} onClick={() => openSubmenu('tactical-item')}>
            <i className="fa-solid fa-toolbox op-cascade-item-icon" />
            <span className="op-bubble-item-label">使用战术道具</span>
            <span className="op-bubble-item-val">{tacticalItems.length}</span>
            <i className="fa-solid fa-chevron-right op-cascade-chevron" />
          </button>
        </div>
      </div>

      {submenu === 'operator' && <div className="op-bubble-panel op-cascade-submenu op-cascade-operators" onMouseEnter={androidTouch ? undefined : () => openSubmenu('operator')} onMouseLeave={androidTouch ? undefined : scheduleClose}>
        <div className="op-cascade-subtitle">更换干员</div>
        <div className="op-cascade-groups">
          {OPERATOR_CLASSES.map((operatorClass) => <section className="op-cascade-group" key={operatorClass.id}>
            <div className="op-cascade-group-title" style={{ '--op-class-color': operatorClass.color } as CSSProperties}>
              <img src={operatorClass.iconUrl} alt="" draggable={false} /><span>{operatorClass.name}</span>
            </div>
            <div className="op-cascade-operator-grid">
              {groupedProfiles[operatorClass.id].map((candidate) => <button type="button" key={candidate.id} className={`op-cascade-operator ${candidate.id === op.operatorId ? 'active' : ''}`} title={`${candidate.name} · ${candidate.fullName}`} onClick={() => {
                if (candidate.id !== op.operatorId) onOperatorChange(op.uid, candidate.id)
                onClose()
              }}>
                <img src={candidate.avatarUrl} alt="" draggable={false} /><span>{candidate.name}</span>
              </button>)}
            </div>
          </section>)}
        </div>
      </div>}

      {submenu === 'status' && <div className="op-bubble-panel op-cascade-submenu op-cascade-status" onMouseEnter={androidTouch ? undefined : () => openSubmenu('status')} onMouseLeave={androidTouch ? undefined : scheduleClose}>
        <div className="op-cascade-subtitle">调整状态</div>
        <div className="op-bubble-menu">
          {STATUS_OPTIONS.map((status) => <button type="button" key={status.value} className={`op-bubble-item st-${status.value} ${op.status === status.value ? 'active' : ''}`} onClick={() => {
            if (op.status !== status.value) onStatusChange(op.uid, status.value)
            onClose()
          }}>
            <i className={`fa-solid ${status.icon} op-cascade-item-icon`} /><span className="op-bubble-item-label">{status.label}</span>
            {op.status === status.value && <i className="fa-solid fa-check op-bubble-item-check" />}
          </button>)}
        </div>
      </div>}

      {submenu === 'skill' && <div className="op-bubble-panel op-cascade-submenu op-cascade-skills" onMouseEnter={androidTouch ? undefined : () => openSubmenu('skill')} onMouseLeave={androidTouch ? undefined : scheduleClose}>
        <div className="op-cascade-subtitle">{profile.name} · 使用技能</div>
        <div className="op-cascade-skill-grid">
          {skills.map((skill) => <button type="button" key={skill.slot} disabled={skill.kind === 'passive'} className={`op-cascade-skill ${skill.kind === 'passive' ? 'passive' : ''} ${op.activeSkillSlot === skill.slot ? 'active' : ''}`} onClick={() => {
            if (skill.kind === 'passive') return
            onSkillUse(op.uid, skill.slot)
            onClose()
          }} title={`${profile.name} · ${skill.name}${skill.kind === 'passive' ? '（被动，仅展示）' : ''}`}>
            <img src={skill.iconUrl} alt="" draggable={false} />
            <span>{skill.name}</span>
          </button>)}
        </div>
        {op.activeSkillSlot && <button type="button" className="op-cascade-skill-clear" onClick={() => { onSkillUse(op.uid, undefined); onClose() }}>清除当前技能</button>}
      </div>}

      {submenu === 'tactical-item' && <div className="op-bubble-panel op-cascade-submenu op-cascade-tactical-items" onMouseEnter={androidTouch ? undefined : () => openSubmenu('tactical-item')} onMouseLeave={androidTouch ? undefined : scheduleClose}>
        <div className="op-cascade-subtitle">{profile.name} · {clsConf.name}战术道具</div>
        <div className="op-tactical-item-list">
          {tacticalItems.map((item) => <article className={`op-tactical-item ${item.modes.length === 1 ? 'single-mode' : 'multi-mode'}`} key={item.id} title="点击卡片设为携带状态" onClick={() => {
            useTacticalItem(item, item.modes[0])
          }}>
            <img src={item.iconUrl} alt="" draggable={false} />
            <span className="op-tactical-item-info"><b>{item.name}</b><small>{item.useTypes.map((type) => TACTICAL_ITEM_TYPE_LABEL[type]).join(' · ')} · 点击携带</small></span>
            <span className="op-tactical-item-actions">
              {item.modes.filter((mode) => mode.type !== 'carry').map((mode) => <button type="button" key={`${item.id}-${mode.type}-${mode.label}`} onClick={(event) => {
                event.stopPropagation()
                useTacticalItem(item, mode)
              }}>{mode.label}</button>)}
            </span>
          </article>)}
        </div>
      </div>}
    </div>
  )
}
