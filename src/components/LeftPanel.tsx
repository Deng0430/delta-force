import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { BuildingUnit, BuildingUnitKind, LayerVisibility, OperatorConnection, OperatorTeam, OperatorUnit, PropVisibility, Side, TeamMarker, VehicleItem, WargameState } from '../types'
import type { CustomVehicleTemplate } from '../config/customVehicles'
import { Checkbox, IconChevronLeft, IconChevronRight } from './icons'
import WargamePanel from './WargamePanel'

const LAYER_ITEMS: { key: keyof LayerVisibility; label: string; parent?: keyof LayerVisibility }[] = [
  { key: 'spawns', label: '复活点' },
  { key: 'zones', label: '活动区域' },
]

const POINT_LAYER_ITEMS: { key: keyof LayerVisibility; label: string }[] = [
  { key: 'pointsLabels', label: '据点标识' },
  { key: 'pointsCapture', label: '据点占领区域' },
  { key: 'pointsFrontline', label: '据点所在防线' },
]

/** 道具类型清单（问题2：按类型独立开关，与 MAP_PROPS 名称一致） */
const PROP_TYPES = ['载具补给站', '固定防空炮', '固定机枪', '岸防炮', '滑索', '电梯', '固定弹药箱']

/** 左侧面板折叠区块 key（展开状态持久化，收缩侧栏不重置） */
export type PanelSectionKey = 'layers' | 'props' | 'points' | 'vehicles' | 'wargame' | 'vehGroups'

const LEFT_PANEL_MIN_WIDTH = 250
const LEFT_PANEL_DEFAULT_WIDTH = 300
const LEFT_PANEL_MAX_WIDTH = 440

function clampLeftPanelWidth(value: number): number {
  const viewportMax = Math.max(LEFT_PANEL_MIN_WIDTH, window.innerWidth - 80)
  return Math.round(Math.min(LEFT_PANEL_MAX_WIDTH, viewportMax, Math.max(LEFT_PANEL_MIN_WIDTH, value)))
}

interface LeftPanelProps {
  mapId: string
  open: boolean
  onToggle: () => void
  width: number
  onWidthChange: (width: number) => void
  layers: LayerVisibility
  onLayerChange: (key: keyof LayerVisibility, value: boolean) => void
  /** 道具按类型显示开关（问题2） */
  propVis: PropVisibility
  onPropVisChange: (name: string, value: boolean) => void
  /** 折叠区块展开状态（由 App 持久化） */
  sections: {
    layers: boolean
    props: boolean
    points: boolean
    vehicles: boolean
    wargame: boolean
    vehGroups: Record<string, boolean>
  }
  /** 分组名用于 vehGroups 键（如 地面载具/空中载具/水上载具），其他区块忽略 */
  onSectionChange: (key: PanelSectionKey, value: boolean, group?: string) => void
  /** 自定义载具部署阵营：本方（绿底）/ 敌方（红底） */
  customOwn: boolean
  onCustomOwnChange: (own: boolean) => void
  /** 问题3：玩家自定义部署载具（放到地图中心） */
  onAddCustom: (tpl: CustomVehicleTemplate, own: boolean, team?: OperatorTeam) => void
  // ---- 兵棋推演（透传 WargamePanel） ----
  view: Side
  operators: OperatorUnit[]
  wargame: WargameState
  connectionCount: number
  /** 当前视角全部协同关系 */
  connections: OperatorConnection[]
  onWargameChange: (patch: Partial<WargameState>) => void
  /** 选择具体干员（如 红狼 → 蜂医）：职业由干员决定，自动跟随 */
  onOperatorChange: (uid: string, operatorId: string) => void
  /** 编辑干员昵称（如 A1 → 老K） */
  onOperatorRename: (uid: string, name: string) => void
  onOperatorStatusChange: (uid: string, status: OperatorUnit['status']) => void
  /** 单干员部署/清除 toggle（第二十四轮） */
  onToggleOperatorDeploy: (uid: string) => void
  onDeployTeam: (side: Side, team: OperatorTeam) => void
  onClearTeam: (side: Side, team: OperatorTeam) => void
  /** 一键建立该队协同关系 */
  onConnectTeam: (side: Side, team: OperatorTeam) => void
  /** 一键清除某方全部部署（回未部署） */
  onClearSideDeploy: (side: Side) => void
  /** 解除某方全部协同关系 */
  onClearSideConnections: (side: Side) => void
  /** 解除某队全部协同关系 */
  onClearTeamConnections: (side: Side, team: OperatorTeam) => void
  onWargameReset: () => void
  // ---- 队标（第二十三轮） ----
  teams: TeamMarker[]
  onDeployTeamMarker: (side: Side, team: OperatorTeam, name?: string) => void
  onDeleteTeamMarker: (uid: string) => void
  vehicles: VehicleItem[]
  buildings: BuildingUnit[]
  onAddBuilding: (kind: BuildingUnitKind, own: boolean, team?: OperatorTeam) => void
}

/**
 * 左侧综合面板（重构：绘制工具已拆分为 DrawBar 悬浮框）：
 * 地图分层控制（道具/据点/复活点/区域开关 + 道具按类型开关，SVG 勾选框）
 * + 自定义载具栏（官网图例图标）。
 * 完全复刻官网左侧面板布局，暗色军事风。
 * 折叠区块展开状态为受控组件（App 持久化），收缩/展开侧栏不会重置。
 */
export default function LeftPanel({
  mapId,
  open,
  onToggle,
  width,
  onWidthChange,
  layers,
  onLayerChange,
  propVis,
  onPropVisChange,
  sections,
  onSectionChange,
  customOwn,
  onCustomOwnChange,
  onAddCustom,
  view,
  operators,
  wargame,
  connectionCount,
  connections,
  onWargameChange,
  onOperatorChange,
  onOperatorRename,
  onOperatorStatusChange,
  onToggleOperatorDeploy,
  onDeployTeam,
  onClearTeam,
  onConnectTeam,
  onClearSideDeploy,
  onClearSideConnections,
  onClearTeamConnections,
  onWargameReset,
  teams,
  onDeployTeamMarker,
  onDeleteTeamMarker,
  vehicles,
  buildings,
  onAddBuilding,
}: LeftPanelProps) {
  const [liveWidth, setLiveWidth] = useState(() => clampLeftPanelWidth(width))
  const [resizing, setResizing] = useState(false)
  const propFlags = PROP_TYPES.map((name) => propVis[name] ?? true)
  const propsAllVisible = layers.props && propFlags.every(Boolean)
  const propsPartiallyVisible = layers.props && propFlags.some(Boolean) && !propsAllVisible
  const pointFlags = POINT_LAYER_ITEMS.map((item) => layers[item.key])
  const pointsAllVisible = layers.points && pointFlags.every(Boolean)
  const pointsPartiallyVisible = layers.points && pointFlags.some(Boolean) && !pointsAllVisible
  const resizeSession = useRef<{
    pointerId: number
    startX: number
    startWidth: number
    lastWidth: number
    app: HTMLElement | null
  } | null>(null)

  const applyLiveWidth = (nextWidth: number, app: HTMLElement | null) => {
    setLiveWidth(nextWidth)
    app?.style.setProperty('--left-panel-width', `${nextWidth}px`)
  }

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    resizeSession.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: liveWidth,
      lastWidth: liveWidth,
      app: event.currentTarget.closest('.app'),
    }
    setResizing(true)
  }

  const resize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = resizeSession.current
    if (!session || session.pointerId !== event.pointerId) return
    const nextWidth = clampLeftPanelWidth(session.startWidth + event.clientX - session.startX)
    if (nextWidth === session.lastWidth) return
    session.lastWidth = nextWidth
    applyLiveWidth(nextWidth, session.app)
  }

  const finishResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = resizeSession.current
    if (!session || session.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    resizeSession.current = null
    setResizing(false)
    onWidthChange(session.lastWidth)
  }

  const resizeWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    let nextWidth = liveWidth
    if (event.key === 'ArrowLeft') nextWidth -= 10
    else if (event.key === 'ArrowRight') nextWidth += 10
    else if (event.key === 'Home') nextWidth = LEFT_PANEL_MIN_WIDTH
    else if (event.key === 'End') nextWidth = LEFT_PANEL_MAX_WIDTH
    else return
    event.preventDefault()
    nextWidth = clampLeftPanelWidth(nextWidth)
    applyLiveWidth(nextWidth, event.currentTarget.closest('.app'))
    onWidthChange(nextWidth)
  }

  if (!open) {
    return (
      <button className="collapse-float left" onClick={onToggle} title="展开战术面板" aria-label="展开战术面板">
        <IconChevronRight size={16} />
      </button>
    )
  }

  return (
    <aside className={`left-panel ${resizing ? 'resizing' : ''}`} style={{ width: liveWidth }}>
      <div
        className="left-panel-resizer"
        role="separator"
        aria-label="调整左侧栏宽度"
        aria-orientation="vertical"
        aria-valuemin={LEFT_PANEL_MIN_WIDTH}
        aria-valuemax={LEFT_PANEL_MAX_WIDTH}
        aria-valuenow={liveWidth}
        tabIndex={0}
        title="拖动调整侧栏宽度 · 双击恢复默认宽度"
        onPointerDown={beginResize}
        onPointerMove={resize}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        onDoubleClick={(event) => {
          const nextWidth = clampLeftPanelWidth(LEFT_PANEL_DEFAULT_WIDTH)
          applyLiveWidth(nextWidth, event.currentTarget.closest('.app'))
          onWidthChange(nextWidth)
        }}
        onKeyDown={resizeWithKeyboard}
      />
      <div className="panel-head">
        <span className="panel-title">战术面板</span>
        <button className="collapse-btn small" onClick={onToggle} title="收起面板">
          <IconChevronLeft size={16} />
        </button>
      </div>

      {/* 面板主体（问题5：独立滚动容器，所有模块都可访问） */}
      <div className="panel-body">
        {/* 地图分层（下拉栏：折叠区块 + 道具总开关子列表） */}
        <details
          className="panel-sec collapsible"
          open={sections.layers}
          onToggle={(e) => {
            // 阻断内层 <details> toggle 事件冒泡：仅处理自身切换
            if (e.target !== e.currentTarget) return
            onSectionChange('layers', e.currentTarget.open)
          }}
        >
          <summary className="sec-title">
            <span className="caret" aria-hidden="true" />
            地图分层
          </summary>
          <div className="layer-list">
            {/* 地图道具总开关：勾选联动子项，右侧箭头展开/收起道具类型列表 */}
            <div className="layer-group">
              <div className="layer-group-head">
                <Checkbox
                  checked={propsAllVisible}
                  indeterminate={propsPartiallyVisible}
                  onChange={(v) => onLayerChange('props', v)}
                  label="地图道具"
                />
                <button
                  type="button"
                  className={`layer-group-toggle ${sections.props ? 'open' : ''}`}
                  onClick={() => onSectionChange('props', !sections.props)}
                  title={sections.props ? '收起道具类型' : '展开道具类型'}
                  aria-expanded={sections.props}
                >
                  <span className="caret" aria-hidden="true" />
                </button>
              </div>
              {sections.props && (
                <div className="prop-type-list">
                  {PROP_TYPES.map((name) => (
                    <Checkbox
                      key={name}
                      className="prop-type"
                      checked={propVis[name] ?? true}
                      onChange={(v) => onPropVisChange(name, v)}
                      label={name}
                    />
                  ))}
                </div>
              )}
            </div>
            {/* 据点与防线：总开关 + 三个可独立控制的子图层。 */}
            <div className="layer-group">
              <div className="layer-group-head">
                <Checkbox
                  checked={pointsAllVisible}
                  indeterminate={pointsPartiallyVisible}
                  onChange={(v) => onLayerChange('points', v)}
                  label="据点与防线"
                />
                <button
                  type="button"
                  className={`layer-group-toggle ${sections.points ? 'open' : ''}`}
                  onClick={() => onSectionChange('points', !sections.points)}
                  title={sections.points ? '收起据点与防线子图层' : '展开据点与防线子图层'}
                  aria-expanded={sections.points}
                >
                  <span className="caret" aria-hidden="true" />
                </button>
              </div>
              {sections.points && (
                <div className="prop-type-list point-type-list">
                  {POINT_LAYER_ITEMS.map((item) => (
                    <Checkbox
                      key={item.key}
                      className="prop-type"
                      checked={layers[item.key]}
                      onChange={(v) => onLayerChange(item.key, v)}
                      label={item.label}
                    />
                  ))}
                </div>
              )}
            </div>
            {LAYER_ITEMS.map((it) => (
              <Checkbox
                key={it.key}
                checked={layers[it.key]}
                disabled={it.parent ? !layers[it.parent] : false}
                onChange={(v) => onLayerChange(it.key, v)}
                label={it.label}
                className={it.parent ? 'indent' : ''}
              />
            ))}
          </div>
        </details>

      {/* 兵棋推演（干员队伍 + 联线控制） */}
      <details
        className="panel-sec collapsible"
        open={sections.wargame}
        onToggle={(e) => {
          // 阻断内部 toggle 冒泡：仅处理自身
          if (e.target !== e.currentTarget) return
          onSectionChange('wargame', e.currentTarget.open)
        }}
      >
        <summary className="sec-title">
          <span className="caret" aria-hidden="true" />
          兵棋推演
        </summary>
        <WargamePanel
          mapId={mapId}
          view={view}
          operators={operators}
          wargame={wargame}
          connectionCount={connectionCount}
          connections={connections}
          onWargameChange={onWargameChange}
          onOperatorChange={onOperatorChange}
          onRenameOperator={onOperatorRename}
          onStatusChange={onOperatorStatusChange}
          onToggleOperatorDeploy={onToggleOperatorDeploy}
          onDeployTeam={onDeployTeam}
          onClearTeam={onClearTeam}
          onConnectTeam={onConnectTeam}
          onClearSideDeploy={onClearSideDeploy}
          onClearSideConnections={onClearSideConnections}
          onClearTeamConnections={onClearTeamConnections}
          onReset={onWargameReset}
          // 队标（第二十三轮）
          teams={teams}
          onDeployTeamMarker={onDeployTeamMarker}
          onDeleteTeamMarker={onDeleteTeamMarker}
          customOwn={customOwn}
          onCustomOwnChange={onCustomOwnChange}
          onAddCustom={onAddCustom}
          vehicleGroups={sections.vehGroups}
          onVehicleGroupChange={(group, open) => onSectionChange('vehGroups', open, group)}
          vehicles={vehicles}
          buildings={buildings}
          onAddBuilding={onAddBuilding}
        />
      </details>
      </div>
    </aside>
  )
}
