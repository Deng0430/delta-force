import type { CapturePoint, PointStatus, Side, StageConfig, TacticalBattleContext } from '../types'
import { IconChevronLeft, IconChevronRight } from './icons'
import { defaultObjectiveState, objectiveStateColor } from './PointMarkers'

const STATUS_TEXT: Record<PointStatus, string> = {
  active: '争夺中',
  captured: '已攻下',
  locked: '未激活',
}

/** 操作UI固定配色（问题7）：不随攻防视角变化，仅地图元素随视角变色；官方色：金=争夺中 / 暗绿=已攻下 / 灰=未激活 */
const UI_COLOR: Record<PointStatus, string> = {
  active: '#f4cf67',
  captured: '#2e9e5b',
  locked: '#586669',
}

interface PointPanelProps {
  stages: StageConfig[]
  capturedStageIndex: number
  view: Side
  selectedName: string | null
  selectedStageId: string | null
  open: boolean
  onToggle: () => void
  onSelectStage: (stageId: string) => void
  onSelect: (point: CapturePoint, stageId: string) => void
  onResetProgress: () => void
  battleContext: TacticalBattleContext
}

/** 右侧点位面板（问题3/7/8 + 问题4：移除载具补给站导航） */
export default function PointPanel({
  stages,
  capturedStageIndex,
  selectedName,
  selectedStageId,
  open,
  onToggle,
  onSelectStage,
  onSelect,
  onResetProgress,
  battleContext,
  view,
}: PointPanelProps) {
  if (!open) {
    return (
      <button className="collapse-float right" onClick={onToggle} title="展开点位面板" aria-label="展开点位面板">
        <IconChevronLeft size={16} />
      </button>
    )
  }

  return (
    <aside className="point-panel">
      <div className="point-head">
        <span>点位进度</span>
        <span className="point-head-actions">
          <button className="collapse-btn small" onClick={onToggle} title="收起点位面板">
            <IconChevronRight size={16} />
          </button>
        </span>
      </div>

      {/* 阶段步进条（固定色：绿=已查看 / 黄=当前激活 / 灰=未激活） */}
      <div className="stage-steps">
        {stages.map((st, idx) => {
          const status: PointStatus =
            idx < capturedStageIndex ? 'captured' : idx === capturedStageIndex ? 'active' : 'locked'
          return (
            <button
              type="button"
              key={st.id}
              className={`step ${status}`}
              onClick={() => onSelectStage(st.id)}
              title={`切换到${st.id} · ${st.label}`}
              aria-current={status === 'active' ? 'step' : undefined}
            >
              <span className="step-dot" style={{ background: UI_COLOR[status] }} />
              <span className="step-label">{st.id}</span>
            </button>
          )
        })}
      </div>

      {/* 切换提示（问题3：点击据点直接切换防线状态） */}
      <div className="point-hint">
        <span className="point-hint-dot" />
        点击下方任意据点，地图将聚焦并切换到该据点的防线状态
      </div>

      <div className="point-actions">
        <button className="btn" onClick={onResetProgress} title="重置，回到第一阶段">
          重置到第一阶段
        </button>
      </div>

      {/* 点位列表（固定配色） */}
      <div className="point-list">
        {stages.map((stage, idx) => {
          const status: PointStatus =
            idx < capturedStageIndex ? 'captured' : idx === capturedStageIndex ? 'active' : 'locked'
          return (
            <div key={stage.id} className={`stage-group ${status}`}>
              <div className="stage-title">
                <span className="stage-id">{stage.id}</span>
                <span className="stage-label">{stage.label}</span>
                <span className={`stage-status ${status}`}>{STATUS_TEXT[status]}</span>
              </div>
              {stage.points.map((point) => {
                const selected = selectedStageId === stage.id && selectedName === point.name
                // 未激活据点始终属于守方，不能被旧的手动状态覆盖。
                const objectiveState = status === 'locked'
                  ? { owner: 'defense' as const, capturingSide: null, progress: 100 }
                  : battleContext.objectiveStates[point.name] ?? defaultObjectiveState(status)
                const color = objectiveStateColor(objectiveState, view)
                return (
                  <button
                    key={point.name}
                    className={`point-item ${selected ? 'selected' : ''} ${status}`}
                    onClick={() => onSelect(point, stage.id)}
                  >
                    <span className="point-dot" style={{ background: color }} />
                    <span className="point-name">{point.name}</span>
                    <span className="point-owner-state">{objectiveState.owner === 'neutral' ? '中立' : objectiveState.owner === view ? '我方' : '敌方'}{objectiveState.capturingSide ? ` · ${Math.round(objectiveState.progress)}%` : ''}</span>
                    {point.note && <span className="point-note">{point.note}</span>}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </aside>
  )
}
