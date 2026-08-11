import { useState, type CSSProperties } from 'react'
import type { BuildingUnit, BuildingUnitKind, OperatorConnection, OperatorTeam, OperatorUnit, Side, TeamMarker, VehicleItem, WargameState } from '../types'
import { TEAMS } from '../config/operators'
import { profileOf } from '../config/operatorProfiles'
import { vehiclesForMap, type CustomVehicleTemplate } from '../config/customVehicles'
import { BUILDING_UNIT_OPTIONS } from '../config/buildingUnits'
import { OperatorSelectGrouped } from './OperatorEditPopup'
import { Checkbox, IconChevronRight } from './icons'

interface WargamePanelProps {
  mapId: string
  view: Side
  /** 当前视角桶内全部干员（40 人 = 我方 20 + 敌方 20；按 op.side 分两个区块展示） */
  operators: OperatorUnit[]
  wargame: WargameState
  /** 协同关系数量（用于展示） */
  connectionCount: number
  /** 当前视角全部协同关系（用于驱动队伍按钮状态） */
  connections: OperatorConnection[]
  onWargameChange: (patch: Partial<WargameState>) => void
  /** 选择具体干员（如 红狼 → 蜂医）：职业由干员决定，自动跟随 */
  onOperatorChange: (uid: string, operatorId: string) => void
  /** 编辑干员昵称（如 A1 → 老K） */
  onRenameOperator: (uid: string, name: string) => void
  /** 切换干员状态 */
  onStatusChange: (uid: string, status: OperatorUnit['status']) => void
  /** 单干员部署/清除 toggle（第二十四轮） */
  onToggleOperatorDeploy: (uid: string) => void
  /** 部署该方该队全部干员到当前地图中心附近（视角桶内含双方，需指定 side） */
  onDeployTeam: (side: Side, team: OperatorTeam) => void
  /** 清除该方该队全部干员部署 */
  onClearTeam: (side: Side, team: OperatorTeam) => void
  /** 为该队已部署干员建立协同关系链 */
  onConnectTeam: (side: Side, team: OperatorTeam) => void
  /** 一键清除某方全部部署（回未部署） */
  onClearSideDeploy: (side: Side) => void
  /** 解除某方全部协同关系 */
  onClearSideConnections: (side: Side) => void
  /** 解除某队全部协同关系 */
  onClearTeamConnections: (side: Side, team: OperatorTeam) => void
  /** 一键重置推演（干员回初始 + 协同关系清空） */
  onReset: () => void
  // ---- 队标（第二十三轮：简化部署单位） ----
  /** 当前视角队标（含双方） */
  teams: TeamMarker[]
  /** 部署/新建某方某队的通用队标 */
  onDeployTeamMarker: (side: Side, team: OperatorTeam, name?: string) => void
  /** 删除单个队标 */
  onDeleteTeamMarker: (uid: string) => void
  /** 载具现在作为兵棋资源在推演面板内统一部署 */
  customOwn: boolean
  onCustomOwnChange: (own: boolean) => void
  onAddCustom: (tpl: CustomVehicleTemplate, own: boolean, team?: OperatorTeam) => void
  vehicleGroups: Record<string, boolean>
  onVehicleGroupChange: (group: string, open: boolean) => void
  vehicles: VehicleItem[]
  buildings: BuildingUnit[]
  onAddBuilding: (kind: BuildingUnitKind, own: boolean, team?: OperatorTeam) => void
}

const STATUS_OPTIONS: { value: OperatorUnit['status']; label: string }[] = [
  { value: 'alive', label: '存活' },
  { value: 'injured', label: '重伤' },
  { value: 'killed', label: '阵亡' },
]

/** 单侧队伍列表（我方或敌方），side 用于操作回调与区块配色 */
function SideTeams({
  side,
  view,
  operators,
  teams,
  connections,
  wargame,
  onWargameChange,
  onOperatorChange,
  onRenameOperator,
  onStatusChange,
  onToggleOperatorDeploy,
  onDeployTeam,
  onClearTeam,
  onConnectTeam,
  onClearSideDeploy,
  onClearSideConnections,
  onClearTeamConnections,
  onDeployTeamMarker,
  onDeleteTeamMarker,
}: {
  side: Side
  view: Side
  operators: OperatorUnit[]
  teams: TeamMarker[]
  connections: OperatorConnection[]
  wargame: WargameState
  onWargameChange: (patch: Partial<WargameState>) => void
  onOperatorChange: (uid: string, operatorId: string) => void
  onRenameOperator: (uid: string, name: string) => void
  onStatusChange: (uid: string, status: OperatorUnit['status']) => void
  onToggleOperatorDeploy: (uid: string) => void
  onDeployTeam: (side: Side, team: OperatorTeam) => void
  onClearTeam: (side: Side, team: OperatorTeam) => void
  onConnectTeam: (side: Side, team: OperatorTeam) => void
  onClearSideDeploy: (side: Side) => void
  onClearSideConnections: (side: Side) => void
  onClearTeamConnections: (side: Side, team: OperatorTeam) => void
  onDeployTeamMarker: (side: Side, team: OperatorTeam, name?: string) => void
  onDeleteTeamMarker: (uid: string) => void
}) {
  const own = side === view
  const deployedCount = operators.filter((o) => o.side === side && o.lat != null).length
  return (
    <div className={`wg-side ${own ? 'own' : 'enemy'}`}>
      <div className="wg-side-title" style={{ color: own ? 'var(--green)' : '#e0453a' }}>
        {own ? '我方' : '敌方'}（{side === 'attack' ? '攻' : '守'}）
        <span className="wg-side-meta">{deployedCount} 部署</span>
        <span className="wg-side-actions">
          <button
            type="button"
            className="wg-mini-btn"
            disabled={!wargame.enabled || deployedCount === 0}
            title="清除本方全部干员部署（回未部署）"
            onClick={() => onClearSideDeploy(side)}
          >
            清部署
          </button>
          <button
            type="button"
            className="wg-mini-btn"
            disabled={!wargame.enabled}
            title="解除本方全部协同关系"
            onClick={() => onClearSideConnections(side)}
          >
            清协同
          </button>
        </span>
      </div>
      <div className="wg-teams">
        {TEAMS.map((team) => {
          const members = operators.filter((o) => o.side === side && o.team === team.id)
          const alive = members.filter((o) => o.status !== 'killed').length
          const markers = teams.filter((t) => t.side === side && t.team === team.id)
          // 队标只表达队伍归属，不再区分步兵/载具职责。
          const deployedMarkers = markers.filter((m) => m.lat != null && m.lng != null)
          // 该队当前状态：是否已部署干员 / 是否已有可见协同关系。
          const teamDeployed = members.some((o) => o.lat != null && o.lng != null)
          const teamUids = new Set(members.map((o) => o.uid))
          const deployedUids = new Set(members.filter((o) => o.lat != null && o.lng != null).map((o) => o.uid))
          const teamHasConn = connections.some(
            (c) =>
              (teamUids.has(c.operatorAId) || teamUids.has(c.operatorBId)) &&
              deployedUids.has(c.operatorAId) &&
              deployedUids.has(c.operatorBId),
          )
          return (
            <details key={team.id} className="wg-team" open={team.id === 'A' && own}>
              <summary className="wg-team-title">
                {/* 显式展开按钮（与左侧面板 chevron 风格统一） */}
                <span className="wg-team-chevron" aria-hidden="true">
                  <IconChevronRight size={12} />
                </span>
                <span className="wg-team-dot" style={{ background: team.color }} />
                {team.name}
                {/* 小队名称：可编辑（存 wargame.teamRoles，缺省回退 team.desc）；队标名称与其同步 */}
                <input
                  className="wg-team-role"
                  value={wargame.teamRoles?.[team.id] ?? team.desc}
                  disabled={!wargame.enabled}
                  maxLength={12}
                  title="编辑小队名称（队标棋子名称同步）"
                  placeholder="小队名称"
                  onChange={(e) =>
                    onWargameChange({
                      teamRoles: { ...(wargame.teamRoles ?? {}), [team.id]: e.target.value },
                    })
                  }
                />
                <span className="wg-team-sub">{alive}/{members.length}</span>
                {/* 通用队标：载具归属由载具自身的队伍属性表达。 */}
                <span className="wg-tm-deploy-wrap">
                  <button
                    type="button"
                    className={`wg-tm-deploy ${deployedMarkers.length ? 'deployed' : ''}`}
                    disabled={!wargame.enabled}
                    title={deployedMarkers.length ? `清除${team.name}队标` : `部署${team.name}队标`}
                    onClick={() => deployedMarkers.length
                      ? onDeleteTeamMarker(deployedMarkers[0].uid)
                      : onDeployTeamMarker(side, team.id)}
                  >
                    <i className="fa-solid fa-flag" aria-hidden="true" />
                    {deployedMarkers.length ? '队标已部署' : '部署队标'}
                  </button>
                </span>
              </summary>
              <div className="wg-team-actions">
                <button
                  type="button"
                  className={teamDeployed ? 'toggle-active' : ''}
                  disabled={!wargame.enabled}
                  title={teamDeployed ? '清除该队全部干员部署（回未部署）' : '一键部署该队全部干员到地图中心附近'}
                  onClick={() => (teamDeployed ? onClearTeam(side, team.id) : onDeployTeam(side, team.id))}
                >
                  {teamDeployed ? '清除部署' : '一键部署'}
                </button>
                <button
                  type="button"
                  className={teamHasConn ? 'toggle-active' : ''}
                  disabled={!wargame.enabled || !wargame.showConnections || !teamDeployed}
                  title={
                    teamHasConn
                      ? '解除该队全部协同关系'
                      : '让该队已部署干员按顺序建立协同关系（1-2、2-3、3-4）'
                  }
                  onClick={() => (teamHasConn ? onClearTeamConnections(side, team.id) : onConnectTeam(side, team.id))}
                >
                  {teamHasConn ? '解除协同' : '一键协同'}
                </button>
              </div>
              <div className="wg-members">
                {members.map((op) => {
                  const profile = profileOf(op.operatorId)
                  const opDeployed = op.lat != null && op.lng != null
                  return (
                    <div key={op.uid} className={`wg-member ${op.status}`}>
                      {/* 一行：头像 + 昵称 + 两级下拉（职业→干员）+ 状态下拉 + 单干员部署 toggle */}
                      <img className="wg-avatar" src={profile.avatarUrl} alt={profile.name} draggable={false} />
                      <input
                        className="wg-op-name-input"
                        value={op.name}
                        disabled={!wargame.enabled}
                        maxLength={6}
                        title="编辑干员昵称"
                        style={{ color: team.color }}
                        onChange={(e) => onRenameOperator(op.uid, e.target.value)}
                      />
                      <OperatorSelectGrouped
                        value={op.operatorId}
                        disabled={!wargame.enabled}
                        onChange={(pid) => onOperatorChange(op.uid, pid)}
                      />
                      {/* 状态：单个下拉（第二十四轮：与干员下拉同款样式） */}
                      <select
                        className="wg-status-select"
                        value={op.status}
                        disabled={!wargame.enabled}
                        title="切换干员状态"
                        onChange={(e) => onStatusChange(op.uid, e.target.value as OperatorUnit['status'])}
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                      {/* 单干员部署 toggle：点一下部署、第二下清除 */}
                      <button
                        type="button"
                        className={`wg-op-deploy ${opDeployed ? 'deployed' : ''}`}
                        disabled={!wargame.enabled}
                        title={opDeployed ? `清除 ${op.name} 部署` : `部署 ${op.name} 到地图`}
                        onClick={() => onToggleOperatorDeploy(op.uid)}
                      >
                        {opDeployed ? '清除' : '部署'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </details>
          )
        })}
      </div>

    </div>
  )
}

/**
 * 兵棋推演面板（左侧工具栏区块）：
 * - 推演总开关 + 回合推进 + 连线开关/模式 + 重置
 * - 分「我方 / 敌方」两个区块（绿/红标题），各 A-E 五队 × 4 人：
 *   头像 + 代号 + 干员下拉（选择干员即确定职业）+ 状态切换 + 部署/清除/一键连线
 */
export default function WargamePanel({
  mapId,
  view,
  operators,
  teams,
  wargame,
  connectionCount,
  connections,
  onWargameChange,
  onOperatorChange,
  onRenameOperator,
  onStatusChange,
  onToggleOperatorDeploy,
  onDeployTeam,
  onClearTeam,
  onConnectTeam,
  onClearSideDeploy,
  onClearSideConnections,
  onClearTeamConnections,
  onReset,
  onDeployTeamMarker,
  onDeleteTeamMarker,
  customOwn,
  onCustomOwnChange,
  onAddCustom,
  vehicleGroups,
  onVehicleGroupChange,
  vehicles,
  buildings,
  onAddBuilding,
}: WargamePanelProps) {
  const sideLabel = view === 'attack' ? '攻方' : '守方'
  const enemySide: Side = view === 'attack' ? 'defense' : 'attack'
  const [vehicleTeam, setVehicleTeam] = useState<OperatorTeam | undefined>('A')
  const [buildingTeam, setBuildingTeam] = useState<OperatorTeam | undefined>(undefined)
  const [vehicleOpen, setVehicleOpen] = useState(true)
  const [activeUnit, setActiveUnit] = useState<'infantry' | 'vehicle' | 'building'>('infantry')
  const availableVehicles = vehiclesForMap(mapId)
  const deployedInfantry = operators.filter((operator) => operator.lat != null && operator.lng != null).length
  const deployedTeams = teams.filter((marker) => marker.lat != null && marker.lng != null).length

  return (
    <div className="wargame-panel">
      {/* 控制条 */}
      <div className="wg-controls">
        <Checkbox
          checked={wargame.enabled}
          label="兵棋推演"
          onChange={(v) => onWargameChange({ enabled: v })}
        />
        <div className="wg-round">
          回合 <b>{wargame.round}</b>
          <button
            type="button"
            className="wg-round-btn"
            disabled={!wargame.enabled}
            onClick={() => onWargameChange({ round: wargame.round + 1 })}
            title="推进一回合"
          >
            +1
          </button>
        </div>
        <button type="button" className="wg-reset" onClick={onReset} title="重置全部干员与协同关系">
          重置
        </button>
      </div>

      <div className="wg-unit-tabs" role="tablist" aria-label="兵棋单位类型">
        <button type="button" role="tab" aria-selected={activeUnit === 'infantry'} className={activeUnit === 'infantry' ? 'active' : ''} onClick={() => setActiveUnit('infantry')}>
          <i className="fa-solid fa-person-rifle" aria-hidden="true" />
          <span><b>步兵单位</b><small>干员 · 队标 · 协同</small></span>
          <em>{deployedInfantry + deployedTeams}</em>
        </button>
        <button type="button" role="tab" aria-selected={activeUnit === 'vehicle'} className={activeUnit === 'vehicle' ? 'active' : ''} onClick={() => setActiveUnit('vehicle')}>
          <i className="fa-solid fa-truck-monster" aria-hidden="true" />
          <span><b>载具单位</b><small>部署 · 编队 · 路线</small></span>
          <em>{vehicles.length}</em>
        </button>
        <button type="button" role="tab" aria-selected={activeUnit === 'building'} className={activeUnit === 'building' ? 'active' : ''} onClick={() => setActiveUnit('building')}>
          <i className="fa-solid fa-building-shield" aria-hidden="true" />
          <span><b>建筑单位</b><small>碉堡 · 固定火力</small></span>
          <em>{buildings.length}</em>
        </button>
      </div>

      {activeUnit === 'infantry' ? (
        <section className="wg-unit-pane infantry" role="tabpanel">
          <div className="wg-connect-controls">
            <Checkbox
              checked={wargame.showConnections}
              label={`显示协同关系（${connectionCount}）`}
              className={wargame.enabled ? '' : 'disabled'}
              onChange={(v) => onWargameChange({ showConnections: v })}
            />
            <Checkbox
              checked={wargame.connectMode}
              label="编辑协同（依次点击两名干员）"
              className={`small ${wargame.connectMode ? 'on' : ''} ${wargame.enabled && wargame.showConnections ? '' : 'disabled'}`}
              onChange={(v) => onWargameChange({ connectMode: v })}
            />
          </div>
          {!wargame.enabled && (
            <div className="wg-tip">启用推演后可部署 {sideLabel} 视角的双方干员，并标记协同关系。</div>
          )}
          <SideTeams
            side={view}
            view={view}
            operators={operators}
            teams={teams}
            connections={connections}
            wargame={wargame}
            onWargameChange={onWargameChange}
            onOperatorChange={onOperatorChange}
            onRenameOperator={onRenameOperator}
            onStatusChange={onStatusChange}
            onToggleOperatorDeploy={onToggleOperatorDeploy}
            onDeployTeam={onDeployTeam}
            onClearTeam={onClearTeam}
            onConnectTeam={onConnectTeam}
            onClearSideDeploy={onClearSideDeploy}
            onClearSideConnections={onClearSideConnections}
            onClearTeamConnections={onClearTeamConnections}
            onDeployTeamMarker={onDeployTeamMarker}
            onDeleteTeamMarker={onDeleteTeamMarker}
          />
          <SideTeams
            side={enemySide}
            view={view}
            operators={operators}
            teams={teams}
            connections={connections}
            wargame={wargame}
            onWargameChange={onWargameChange}
            onOperatorChange={onOperatorChange}
            onRenameOperator={onRenameOperator}
            onStatusChange={onStatusChange}
            onToggleOperatorDeploy={onToggleOperatorDeploy}
            onDeployTeam={onDeployTeam}
            onClearTeam={onClearTeam}
            onConnectTeam={onConnectTeam}
            onClearSideDeploy={onClearSideDeploy}
            onClearSideConnections={onClearSideConnections}
            onClearTeamConnections={onClearTeamConnections}
            onDeployTeamMarker={onDeployTeamMarker}
            onDeleteTeamMarker={onDeleteTeamMarker}
          />
        </section>
      ) : activeUnit === 'vehicle' ? (
        <section className="wg-unit-pane vehicle" role="tabpanel">
          <details
            className="wg-vehicles"
            open={vehicleOpen}
            onToggle={(e) => {
              if (e.target === e.currentTarget) setVehicleOpen(e.currentTarget.open)
            }}
          >
            <summary className="wg-subsection-title">
              <span className="caret" aria-hidden="true" />
              载具装备库 <em>{availableVehicles.length}</em>
            </summary>
            <div className="wg-vehicle-controls">
              <div className="veh-own-switch" role="radiogroup" aria-label="载具阵营">
                <button type="button" className={`veh-own-opt own ${customOwn ? 'active' : ''}`} onClick={() => onCustomOwnChange(true)} role="radio" aria-checked={customOwn}>
                  <span className="own-dot own" />本方
                </button>
                <button type="button" className={`veh-own-opt enemy ${!customOwn ? 'active' : ''}`} onClick={() => onCustomOwnChange(false)} role="radio" aria-checked={!customOwn}>
                  <span className="own-dot enemy" />敌方
                </button>
              </div>
              <div className="wg-team-picker" aria-label="载具所属队伍">
                <button type="button" className={`no-team ${vehicleTeam == null ? 'active' : ''}`} style={{ '--wg-team-color': customOwn ? '#01ff84' : '#e0453a' } as CSSProperties} onClick={() => setVehicleTeam(undefined)} title="不设置队伍，棋子使用阵营色">
                  无
                </button>
                {TEAMS.map((team) => (
                  <button type="button" key={team.id} className={vehicleTeam === team.id ? 'active' : ''} style={{ '--wg-team-color': team.color } as CSSProperties} onClick={() => setVehicleTeam(team.id)} title={`${team.name} · ${wargame.teamRoles?.[team.id] ?? team.desc}`}>
                    {team.id}
                  </button>
                ))}
              </div>
            </div>
            <div className="palette-tip">先选阵营和队伍，再从装备库部署；地图上可拖动、旋转并创建路线。</div>
            <div className="veh-list">
              {(['地面载具', '空中载具', '水上载具'] as const).map((group) => {
                const items = availableVehicles.filter((vehicle) => vehicle.group === group)
                if (!items.length) return null
                return (
                  <details key={group} className="veh-group" open={vehicleGroups[group] ?? true} onToggle={(e) => {
                    if (e.target === e.currentTarget) onVehicleGroupChange(group, e.currentTarget.open)
                  }}>
                    <summary className="veh-group-title"><span className="caret" aria-hidden="true" />{group}（{items.length}）</summary>
                    {items.map((vehicle) => (
                      <button type="button" key={vehicle.iconKey} className="tpl" disabled={!wargame.enabled} onClick={() => onAddCustom(vehicle, customOwn, vehicleTeam)}>
                        <img className="tpl-icon" src={vehicle.iconUrl} alt="" draggable={false} />
                        <span className="tpl-info"><span className="tpl-name">{vehicle.name}</span></span>
                        <span className="tpl-add">部署 · {vehicleTeam ?? '无队伍'}</span>
                      </button>
                    ))}
                  </details>
                )
              })}
            </div>
          </details>
        </section>
      ) : (
        <section className="wg-unit-pane building" role="tabpanel">
          <div className="wg-building-head">
            <div>
              <b>碉堡</b>
              <small>可选择阵营与队伍；无队伍时使用阵营色</small>
            </div>
          </div>
          <div className="wg-building-controls">
            <div className="veh-own-switch" role="radiogroup" aria-label="碉堡阵营">
              <button type="button" className={`veh-own-opt own ${customOwn ? 'active' : ''}`} onClick={() => onCustomOwnChange(true)} role="radio" aria-checked={customOwn}><span className="own-dot own" />本方</button>
              <button type="button" className={`veh-own-opt enemy ${!customOwn ? 'active' : ''}`} onClick={() => onCustomOwnChange(false)} role="radio" aria-checked={!customOwn}><span className="own-dot enemy" />敌方</button>
            </div>
            <div className="wg-team-picker" aria-label="建筑所属队伍">
              <button type="button" className={`no-team ${buildingTeam == null ? 'active' : ''}`} style={{ '--wg-team-color': customOwn ? '#01ff84' : '#e0453a' } as CSSProperties} onClick={() => setBuildingTeam(undefined)} title="不设置队伍，棋子使用阵营色">无</button>
              {TEAMS.map((team) => (
                <button type="button" key={team.id} className={buildingTeam === team.id ? 'active' : ''} style={{ '--wg-team-color': team.color } as CSSProperties} onClick={() => setBuildingTeam(team.id)} title={`${team.name} · ${wargame.teamRoles?.[team.id] ?? team.desc}`}>{team.id}</button>
              ))}
            </div>
          </div>
          <div className="wg-building-list">
            {BUILDING_UNIT_OPTIONS.map((item) => (
              <button type="button" key={item.kind} style={{ '--building-card-accent': item.accent } as CSSProperties} disabled={!wargame.enabled} onClick={() => onAddBuilding(item.kind, customOwn, buildingTeam)}>
                <span className="wg-building-preview"><img src={item.iconUrl} alt="" draggable={false} /></span>
                <span><b>{item.name}</b><small>{item.description}</small></span>
                <em>部署 · {buildingTeam ?? '无队伍'}</em>
              </button>
            ))}
          </div>
          <div className="palette-tip">部署后可拖动，悬停滚轮旋转图标，右键删除。</div>
        </section>
      )}
    </div>
  )
}
