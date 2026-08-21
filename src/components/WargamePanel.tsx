import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { BuildingUnit, BuildingUnitKind, FieldSupportDefinition, ModeVehicleRefreshRule, OperatorConnection, OperatorTeam, OperatorUnit, Side, TeamMarker, VehicleItem, WargameState } from '../types'
import { FIELD_SUPPORTS } from '../config/fieldSupports'
import { TEAMS } from '../config/operators'
import { profileOf } from '../config/operatorProfiles'
import { vehiclesForMap, type CustomVehicleTemplate } from '../config/customVehicles'
import { BUILDING_UNIT_OPTIONS } from '../config/buildingUnits'
import { OperatorSelectGrouped } from './OperatorEditPopup'
import { Checkbox, IconChevronRight } from './icons'
import { formatClockSeconds, parseClockSeconds } from '../utils/vehicleRefreshRuntime'
import { renderTacticalMarkdown } from '../utils/tacticalMarkdown'
import MarkdownWysiwygEditor from './MarkdownWysiwygEditor'

const escapeDocumentHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char))

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
  stageLabel: string
  stageOptions: Array<{ id: string; label: string }>
  onStageChange: (stageId: string) => void
  onRoundChange: (round: number) => void
  roundOptions: number[]
  onCreateRound: (copy: boolean) => void
  onDeleteRound: () => void
  objectiveNames: string[]
  vehicleRefreshRules: Omit<ModeVehicleRefreshRule, 'verification'>[]
  fieldSupports: import('../types').FieldSupportInstance[]
  onAddFieldSupport: (definition: FieldSupportDefinition, side: Side) => void
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
  stageLabel,
  stageOptions,
  onStageChange,
  onRoundChange,
  roundOptions,
  onCreateRound,
  onDeleteRound,
  objectiveNames,
  vehicleRefreshRules,
  fieldSupports,
  onAddFieldSupport,
}: WargamePanelProps) {
  const sideLabel = view === 'attack' ? '攻方' : '守方'
  const enemySide: Side = view === 'attack' ? 'defense' : 'attack'
  const [vehicleTeam, setVehicleTeam] = useState<OperatorTeam | undefined>('A')
  const [buildingTeam, setBuildingTeam] = useState<OperatorTeam | undefined>(undefined)
  const [vehicleOpen, setVehicleOpen] = useState(true)
  const [activeUnit, setActiveUnit] = useState<'infantry' | 'vehicle' | 'building' | 'support'>('infantry')
  const availableVehicles = vehiclesForMap(mapId)
  const deployedInfantry = operators.filter((operator) => operator.lat != null && operator.lng != null).length
  const deployedTeams = teams.filter((marker) => marker.lat != null && marker.lng != null).length
  const [matchTimeDraft, setMatchTimeDraft] = useState(() => formatClockSeconds(wargame.battleContext.matchTimeSeconds))
  const [countdownDrafts, setCountdownDrafts] = useState<Record<string, string>>({})
  const [notesPreview, setNotesPreview] = useState(false)
  const [notesCollapsed, setNotesCollapsed] = useState(true)
  const [notesScope, setNotesScope] = useState<'stage' | 'all'>('stage')
  const [notesExpanded, setNotesExpanded] = useState(false)
  const [notesStageMenuOpen, setNotesStageMenuOpen] = useState(false)
  const noteImageInputRef = useRef<HTMLInputElement>(null)
  const activeNotesStageId = stageLabel.split(' · ')[0] || 'S1'
  const [notesStageId, setNotesStageId] = useState(activeNotesStageId)
  const stageNote = wargame.stageNotes?.[notesStageId] ?? ''
  const completeNotes = stageOptions.map((stage) => ({ ...stage, note: wargame.stageNotes?.[stage.id] ?? '' }))
  useEffect(() => setNotesStageId(activeNotesStageId), [activeNotesStageId])
  const updateStageNote = (stageId: string, next: string) => {
    const current = wargame.stageNotes?.[stageId] ?? ''
    if (next === current) return
    onWargameChange({ stageNotes: { ...(wargame.stageNotes ?? {}), [stageId]: next } })
  }
  const insertNoteText = (text: string) => {
    updateStageNote(notesStageId, `${stageNote}${stageNote ? '\n' : ''}${text}`)
  }
  const insertNoteImage = () => noteImageInputRef.current?.click()
  const handleNoteImageFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') return
      const id = `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      onWargameChange({ noteImages: { ...(wargame.noteImages ?? {}), [id]: reader.result } })
      insertNoteText(`![${file.name.replace(/[\[\]]/g, '') || '图片'}](note-image:${id})`)
    }
    reader.readAsDataURL(file)
  }
  const compressNoteImage = (source: string): Promise<string> => new Promise((resolve) => {
    if (!source.startsWith('data:image/')) {
      resolve(source)
      return
    }
    const image = new Image()
    image.onload = () => {
      const maxSize = 1600
      const scale = Math.min(1, maxSize / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale))
      canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale))
      const context = canvas.getContext('2d')
      if (!context) {
        resolve(source)
        return
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.82))
    }
    image.onerror = () => resolve(source)
    image.src = source
  })

  const exportNotes = async () => {
    const stageById = new Map(stageOptions.map((stage) => [stage.id, stage]))
    const exportedStages = notesScope === 'all'
      ? completeNotes
      : [{ ...(stageById.get(notesStageId) ?? { id: notesStageId, label: notesStageId }), note: stageNote }]
    const referencedIds = new Set<string>()
    exportedStages.forEach((stage) => {
      for (const match of stage.note.matchAll(/note-image:([\w-]+)/g)) referencedIds.add(match[1])
    })
    const compressedImages = Object.fromEntries(await Promise.all(Array.from(referencedIds, async (id) => [id, await compressNoteImage(wargame.noteImages?.[id] ?? '')])))
    const body = exportedStages.map((stage) => `<section class="stage-note"><h1>${escapeDocumentHtml(stage.id)} · ${escapeDocumentHtml(stage.label)}</h1>${renderTacticalMarkdown(stage.note, compressedImages)}</section>`).join('')
    const title = `${mapId}-${notesScope === 'all' ? '全部阶段' : notesStageId}-推演备注`
    const documentHtml = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeDocumentHtml(title)}</title><style>
      :root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f4f5f6;color:#202426;font:16px/1.75 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}main{width:min(900px,calc(100% - 32px));margin:32px auto;padding:40px 48px;background:#fff;box-shadow:0 2px 14px rgba(0,0,0,.08)}.stage-note+.stage-note{margin-top:48px;padding-top:32px;border-top:1px solid #dfe3e5}h1{margin:0 0 24px;font-size:28px;line-height:1.3;border-bottom:2px solid #202426;padding-bottom:12px}h2{margin:28px 0 12px;font-size:22px}h3{margin:22px 0 10px;font-size:18px}p{margin:12px 0}ul,ol{padding-left:28px}li{margin:5px 0}code{padding:2px 5px;border-radius:3px;background:#eef1f2;font-family:Consolas,monospace}.tactical-note-image{display:block;max-width:100%;height:auto;margin:18px auto;border:1px solid #d8dddf;border-radius:4px}@media(max-width:640px){main{width:100%;margin:0;padding:24px 18px;box-shadow:none}h1{font-size:23px}}
    </style></head><body><main>${body}</main></body></html>`
    const blobUrl = URL.createObjectURL(new Blob([documentHtml], { type: 'text/html;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = blobUrl
    anchor.download = `${title}.html`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
  }
  const copyNotesRichText = async () => {
    const stageById = new Map(stageOptions.map((stage) => [stage.id, stage]))
    const copiedStages = notesScope === 'all'
      ? completeNotes
      : [{ ...(stageById.get(notesStageId) ?? { id: notesStageId, label: notesStageId }), note: stageNote }]
    const plainText = copiedStages.map((stage) => `# ${stage.id} · ${stage.label}\n\n${stage.note}`).join('\n\n')
    const html = copiedStages.map((stage) => `<section><h1>${stage.id} · ${stage.label}</h1>${renderTacticalMarkdown(stage.note, wargame.noteImages)}</section>`).join('')
    try {
      if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plainText], { type: 'text/plain' }),
        })])
      } else {
        await navigator.clipboard.writeText(plainText)
      }
    } catch {
      await navigator.clipboard?.writeText(plainText)
    }
  }
  const refreshCountdownObjectives = Array.from(new Set(vehicleRefreshRules.filter((rule) => rule.trigger.type === 'objective-countdown').map((rule) => rule.objective).filter(Boolean)))
  const refreshEvents = Array.from(new Set(vehicleRefreshRules.filter((rule) => rule.trigger.type === 'map-event').map((rule) => String(rule.trigger.value).trim() || rule.objective).filter(Boolean)))

  useEffect(() => {
    setMatchTimeDraft(formatClockSeconds(wargame.battleContext.matchTimeSeconds))
    setCountdownDrafts(Object.fromEntries(Object.entries(wargame.battleContext.objectiveCountdowns).map(([key, value]) => [key, formatClockSeconds(value)])))
  }, [mapId, wargame.battleContext.matchTimeSeconds, wargame.battleContext.objectiveCountdowns])

  const updateBattleContext = (patch: Partial<WargameState['battleContext']>) => onWargameChange({ battleContext: { ...wargame.battleContext, ...patch } })

  return (
    <div className="wargame-panel">
      {/* 控制条 */}
      <div className="wg-controls">
        <label className="wg-round">阶段<select value={stageLabel.split(' · ')[0]} onChange={(event) => onStageChange(event.target.value)}>{stageOptions.map((stage) => <option key={stage.id} value={stage.id}>{stage.id}</option>)}</select></label>
        <div className="wg-round">
          回合 <select value={wargame.round} onChange={(event) => onRoundChange(Math.max(1, Number(event.target.value)))}>{roundOptions.map((round) => <option key={round} value={round}>{round}</option>)}</select>
          <button
            type="button"
            className="wg-round-btn"
            disabled={!wargame.enabled}
            onClick={() => onCreateRound(false)}
            title="推进一回合"
          >
            <i className="fa-solid fa-forward-step" aria-hidden="true" />
          </button>
          <button type="button" className="wg-round-btn" onClick={() => onCreateRound(true)} title="复制当前回合" aria-label="复制当前回合"><i className="fa-regular fa-copy" aria-hidden="true" /></button>
          <button type="button" className="wg-round-btn" disabled={wargame.round <= 1} onClick={onDeleteRound} title="删除当前回合" aria-label="删除当前回合"><i className="fa-solid fa-trash-can" aria-hidden="true" /></button>
        </div>
        <button type="button" className="wg-reset" onClick={onReset} title="重置全部干员与协同关系">
          <i className="fa-solid fa-rotate-left" aria-hidden="true" />
        </button>
      </div>

      <div className="wg-display-controls" aria-label="兵棋显示与协同控制">
        <Checkbox
          checked={wargame.showFireLines}
          label="显示已开启的兵棋枪线"
          className={wargame.enabled ? '' : 'disabled'}
          onChange={(value) => onWargameChange({ showFireLines: value })}
        />
        <Checkbox
          checked={wargame.showRouteLabels}
          label="显示兵棋路线标签"
          className={wargame.enabled ? '' : 'disabled'}
          onChange={(value) => onWargameChange({ showRouteLabels: value })}
        />
        <Checkbox
          checked={wargame.showConnections}
          label={`显示协同关系（${connectionCount}）`}
          className={wargame.enabled ? '' : 'disabled'}
          onChange={(value) => onWargameChange({ showConnections: value })}
        />
        <Checkbox
          checked={wargame.connectMode}
          label="编辑协同（依次点击两名干员）"
          className={`small ${wargame.connectMode ? 'on' : ''} ${wargame.enabled && wargame.showConnections ? '' : 'disabled'}`}
          onChange={(value) => onWargameChange({ connectMode: value })}
        />
      </div>

      <details className="wg-battle-context">
        <summary><span className="caret" aria-hidden="true" /><i className="fa-solid fa-gauge-high" />对局状态<em>{stageLabel}</em></summary>
        <div className="wg-battle-context-body">
          <div className="wg-battle-context-tip">用于判断载具刷新条件；据点归属和占领进度请直接点击地图据点设置。</div>
          <div className="wg-battle-fields">
            <label><span>我方兵力</span>{view === 'attack'
              ? <input type="number" min="0" value={wargame.battleContext.tickets.attack ?? ''} placeholder="未设置" onChange={(event) => updateBattleContext({ tickets: { ...wargame.battleContext.tickets, attack: event.target.value === '' ? null : Math.max(0, Number(event.target.value)), defense: null } })} />
              : <input type="text" value="无限" disabled title="守方兵力无限" />}
            </label>
            <label><span>敌方兵力</span>{enemySide === 'attack'
              ? <input type="number" min="0" value={wargame.battleContext.tickets.attack ?? ''} placeholder="未设置" onChange={(event) => updateBattleContext({ tickets: { ...wargame.battleContext.tickets, attack: event.target.value === '' ? null : Math.max(0, Number(event.target.value)), defense: null } })} />
              : <input type="text" value="无限" disabled title="守方兵力无限" />}
            </label>
            <label><span>比赛时间</span><input type="text" inputMode="numeric" value={matchTimeDraft} placeholder="00:00" onChange={(event) => setMatchTimeDraft(event.target.value)} onBlur={() => { const seconds = matchTimeDraft.trim() ? parseClockSeconds(matchTimeDraft) : null; updateBattleContext({ matchTimeSeconds: seconds }); setMatchTimeDraft(formatClockSeconds(seconds)) }} /></label>
          </div>
          {objectiveNames.length > 0 ? <div className="wg-objective-state-summary">{objectiveNames.map((name) => {
            const state = wargame.battleContext.objectiveStates[name]
            const owner = state?.owner ?? 'neutral'
            const label = owner === 'neutral' ? '中立' : owner === view ? '我方' : '敌方'
            return <span key={name} className={owner === 'neutral' ? 'neutral' : owner === view ? 'own' : 'enemy'}><b>{name}</b>{label}{state?.capturingSide ? ` · ${state.capturingSide === view ? '我方' : '敌方'}占领 ${Math.round(state.progress)}%` : ''}</span>
          })}</div> : null}
          {refreshCountdownObjectives.map((objective) => <label className="wg-countdown-field" key={objective}><span>{objective}剩余倒计时</span><input type="text" inputMode="numeric" value={countdownDrafts[objective] ?? ''} placeholder="00:00" onChange={(event) => setCountdownDrafts((current) => ({ ...current, [objective]: event.target.value }))} onBlur={() => { const draft = countdownDrafts[objective] ?? ''; const seconds = draft.trim() ? parseClockSeconds(draft) : null; updateBattleContext({ objectiveCountdowns: { ...wargame.battleContext.objectiveCountdowns, [objective]: seconds } }); setCountdownDrafts((current) => ({ ...current, [objective]: formatClockSeconds(seconds) })) }} /></label>)}
          {refreshEvents.length > 0 ? <div className="wg-event-grid">{refreshEvents.map((eventName) => {
            const active = wargame.battleContext.mapEvents.includes(eventName)
            return <button type="button" key={eventName} className={active ? 'active' : ''} onClick={() => updateBattleContext({ mapEvents: active ? wargame.battleContext.mapEvents.filter((item) => item !== eventName) : [...wargame.battleContext.mapEvents, eventName] })}><i className={`fa-solid ${active ? 'fa-circle-check' : 'fa-circle'}`} />{eventName}</button>
          })}</div> : null}
          <button type="button" className="wg-clear-battle" onClick={() => { setMatchTimeDraft(''); setCountdownDrafts({}); onWargameChange({ battleContext: { tickets: { attack: null, defense: null }, matchTimeSeconds: null, objectiveStates: {}, objectiveCountdowns: {}, mapEvents: [] } }) }}>清空对局状态</button>
        </div>
      </details>

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
      <button type="button" className={`wg-support-entry ${activeUnit === 'support' ? 'active' : ''}`} onClick={() => setActiveUnit('support')} aria-pressed={activeUnit === 'support'}>
        <i className="fa-solid fa-bullseye" aria-hidden="true" /><span><b>阵地支援</b><small>部署范围支援技能</small></span><em>{fieldSupports.length}</em>
      </button>

      {createPortal(
        <section className={`wg-notes-dock ${notesCollapsed ? 'collapsed' : ''} ${notesExpanded ? 'expanded' : ''}`} aria-label="阶段备注">
          <header>
            <span><i className="fa-regular fa-note-sticky" aria-hidden="true" />推演备注</span>
            <em>{notesScope === 'all' ? '全部阶段' : notesStageId}</em>
            {!notesCollapsed && <button type="button" onClick={copyNotesRichText} title="复制富文本（移植到其他协作平台优先使用此功能）" aria-label="复制富文本（移植到其他协作平台优先使用此功能）"><i className="fa-regular fa-copy" aria-hidden="true" /></button>}
            {!notesCollapsed && <button type="button" onClick={exportNotes} title={notesScope === 'all' ? '导出完整备注为富文本 HTML' : `导出 ${notesStageId} 富文本 HTML`} aria-label={notesScope === 'all' ? '导出完整备注为富文本 HTML' : `导出 ${notesStageId} 富文本 HTML`}><i className="fa-solid fa-file-code" aria-hidden="true" /></button>}
            {!notesCollapsed && <button type="button" onClick={() => setNotesExpanded((value) => !value)} title={notesExpanded ? '还原备注窗口' : '放大备注窗口'} aria-label={notesExpanded ? '还原备注窗口' : '放大备注窗口'}><i className={`fa-solid ${notesExpanded ? 'fa-compress' : 'fa-expand'}`} aria-hidden="true" /></button>}
            <button type="button" onClick={() => {
              setNotesCollapsed((value) => {
                const collapsed = !value
                if (collapsed) setNotesExpanded(false)
                return collapsed
              })
            }} title={notesCollapsed ? '展开备注' : '收起备注'} aria-label={notesCollapsed ? '展开备注' : '收起备注'}><i className={`fa-solid ${notesCollapsed ? 'fa-chevron-up' : 'fa-chevron-down'}`} aria-hidden="true" /></button>
          </header>
          {!notesCollapsed && <div className="wg-notes-body">
            <input ref={noteImageInputRef} type="file" accept="image/*" hidden onChange={handleNoteImageFile} />
            <div className="wg-notes-tabs"><div className="wg-notes-stage-picker" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setNotesStageMenuOpen(false) }}><button type="button" className="wg-notes-stage-trigger" aria-label="查看备注阶段" aria-haspopup="listbox" aria-expanded={notesStageMenuOpen} onClick={() => setNotesStageMenuOpen((open) => !open)}>{notesStageId}<i className="fa-solid fa-caret-down" aria-hidden="true" /></button>{notesStageMenuOpen && <div className="wg-notes-stage-menu" role="listbox">{stageOptions.map((stage) => <button type="button" role="option" aria-selected={stage.id === notesStageId} className={stage.id === notesStageId ? 'selected' : ''} key={stage.id} onClick={() => { setNotesStageId(stage.id); setNotesScope('stage'); setNotesStageMenuOpen(false) }}>{stage.id}</button>)}</div>}</div><button type="button" className={notesScope === 'all' ? 'active' : ''} onClick={() => setNotesScope((scope) => scope === 'all' ? 'stage' : 'all')}>完整备注</button><button type="button" className={!notesPreview ? 'active' : ''} onClick={() => setNotesPreview(false)}>编辑</button><button type="button" className={notesPreview ? 'active' : ''} onClick={() => setNotesPreview(true)}>预览</button>{!notesPreview && <button type="button" onClick={insertNoteImage} title={`向 ${notesStageId} 插入图片`} aria-label={`向 ${notesStageId} 插入图片`}><i className="fa-regular fa-image" aria-hidden="true" /></button>}</div>
            {notesScope === 'all' ? notesPreview ? <div className="wg-notes-preview wg-notes-all">{completeNotes.map((stage) => <section key={stage.id}><h1>{stage.id} · {stage.label}</h1><MarkdownWysiwygEditor readOnly value={stage.note} noteImages={wargame.noteImages ?? {}} placeholder="暂无备注" /></section>)}</div> : <div className="wg-notes-all-edit">{completeNotes.map((stage) => <section key={stage.id}><h1>{stage.id} · {stage.label}</h1><MarkdownWysiwygEditor value={stage.note} noteImages={wargame.noteImages ?? {}} placeholder={`记录 ${stage.id} 阶段的推演说明…`} onChange={(markdown) => updateStageNote(stage.id, markdown)} onStoreImage={(id, dataUrl) => onWargameChange({ noteImages: { ...(wargame.noteImages ?? {}), [id]: dataUrl } })} /></section>)}</div> : notesPreview ? <div className="wg-notes-preview"><MarkdownWysiwygEditor readOnly value={stageNote} noteImages={wargame.noteImages ?? {}} placeholder="暂无备注" /></div> : <MarkdownWysiwygEditor value={stageNote} noteImages={wargame.noteImages ?? {}} placeholder={`记录 ${notesStageId} 阶段的推演说明…`} onChange={(markdown) => updateStageNote(notesStageId, markdown)} onStoreImage={(id, dataUrl) => onWargameChange({ noteImages: { ...(wargame.noteImages ?? {}), [id]: dataUrl } })} />}
          </div>}
        </section>
      , document.body)}

      {activeUnit === 'infantry' ? (
        <section className="wg-unit-pane infantry" role="tabpanel">
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
      ) : activeUnit === 'support' ? (
        <section className="wg-unit-pane support" role="tabpanel">
          <div className="wg-building-head"><div><b>阵地支援</b><small>选择敌我阵营后点击图标部署范围</small></div></div>
          <div className="veh-own-switch" role="radiogroup" aria-label="阵地支援阵营">
            <button type="button" className={`veh-own-opt own ${customOwn ? 'active' : ''}`} onClick={() => onCustomOwnChange(true)}><span className="own-dot own" />本方</button>
            <button type="button" className={`veh-own-opt enemy ${!customOwn ? 'active' : ''}`} onClick={() => onCustomOwnChange(false)}><span className="own-dot enemy" />敌方</button>
          </div>
          <div className="wg-support-list">
            {FIELD_SUPPORTS.map((support) => <button type="button" key={support.id} className={support.id === 'vehicle-airdrop' ? 'vehicle-airdrop' : undefined} disabled={!wargame.enabled} onClick={() => onAddFieldSupport(support, customOwn ? view : (view === 'attack' ? 'defense' : 'attack'))}>
              <img src={support.iconUrl} alt="" draggable={false} /><span><b>{support.name}</b><small>{support.description}</small></span><em>部署</em>
            </button>)}
          </div>
          <div className="palette-tip">部署后可拖动，右键中心图标删除。</div>
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
