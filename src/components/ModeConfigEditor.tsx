import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type {
  GameModeProfile,
  ModeConfigVerification,
  ModeEditorSession,
  ModeEditorSelection,
  ModeEditorSelectionItem,
  ModeMapProp,
  ModeMapOverride,
  ModeObjectivePoint,
  ModeSpawnPoint,
  ModeVehicleRefreshPoint,
  ModeZone,
  ModeZoneKind,
  ModeZoneRole,
} from '../types'
import { genUid } from '../utils/geo'
import { DEPLOY_VEHICLE_CATALOG, type DeployVehicleEntry } from '../config/deployVehicles'
import { POINT_ICON_BASE } from '../config/points'
import { refreshTriggerLabel } from '../utils/vehicleRefreshRules'
import type { ModePaletteAsset } from './ModeAssetPalette'
import TacticalCheckbox from './TacticalCheckbox'

type ModeEditorPanel = 'properties' | 'objects' | 'vehicle-refresh' | 'settings'
type VehicleRuleFilter = 'pending' | 'all' | 'completed'
type VehicleImportMode = 'single' | 'batch'

const ZONE_KIND_OPTIONS: { value: ModeZoneKind; label: string; color: string }[] = [
  { value: 'own', label: '己方区域', color: '#01ff84' },
  { value: 'enemy', label: '敌方区域', color: '#e0453a' },
  { value: 'neutral', label: '中立区域', color: '#f4cf67' },
  { value: 'restricted', label: '限制区域', color: '#9a9b9b' },
]

const ZONE_ROLE_OPTIONS: { value: ModeZoneRole; label: string; kind: ModeZoneKind; color: string }[] = [
  { value: 'attack-base', label: '进攻活动区', kind: 'own', color: '#01ff84' },
  { value: 'defense-base', label: '防守活动区', kind: 'enemy', color: '#e0453a' },
  { value: 'capture', label: '据点占领区', kind: 'neutral', color: '#f4cf67' },
  { value: 'frontline', label: '阶段防线', kind: 'neutral', color: '#f4cf67' },
  { value: 'custom', label: '自定义区域', kind: 'neutral', color: '#9a9b9b' },
]

const OBJECTIVE_ICON_OPTIONS = [
  'q_jd_a', 'q_jd_a1', 'q_jd_a2', 'q_jd_b', 'q_jd_b1', 'q_jd_b2', 'q_jd_b3',
  'q_jd_c', 'q_jd_c1', 'q_jd_c2', 'q_jd_c3', 'q_jd_d', 'q_jd_d1', 'q_jd_d2',
  'q_jd_d3', 'q_jd_e', 'q_jd_e1', 'q_jd_e2',
]

const PROP_OPTIONS = [
  { name: '固定弹药箱', icon: 'q_gddyx' },
  { name: '载具补给站', icon: 'q_zjbjz' },
  { name: '固定防空炮', icon: 'q_gdaap' },
  { name: '密集阵', icon: 'q_mjz' },
  { name: '固定机枪', icon: 'q_gdjq' },
  { name: '岸防炮', icon: 'q_afp' },
  { name: '滑索', icon: 'q_hs' },
  { name: '电梯', icon: 'q_dt' },
] as const

function copiedZoneName(zones: ModeZone[], targetStageId: string, sourceName: string): string {
  const names = new Set(zones.filter((zone) => zone.stageId === targetStageId).map((zone) => zone.name))
  const baseName = `${sourceName}（副本）`
  if (!names.has(baseName)) return baseName
  let sequence = 2
  while (names.has(`${sourceName}（副本 ${sequence}）`)) sequence += 1
  return `${sourceName}（副本 ${sequence}）`
}

function PermissionControl({ value, onChange }: { value: ModeConfigVerification; onChange: (value: ModeConfigVerification) => void }) {
  return (
    <label className="mode-config-field mode-config-permission">
      <span>编辑权限</span>
      <select value={value} onChange={(event) => onChange(event.target.value as ModeConfigVerification)}>
        <option value="draft">草稿 · 完全可编辑</option>
        <option value="confirmed">确认 · 防误触锁定</option>
      </select>
    </label>
  )
}

function CommitTextInput({ value, onCommit, placeholder }: { value: string; onCommit: (value: string) => void; placeholder?: string }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    if (draft !== value) onCommit(draft)
  }
  return (
    <input
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.currentTarget.blur()
      }}
    />
  )
}

function CommitTextarea({ value, onCommit, placeholder, rows = 2 }: { value: string; onCommit: (value: string) => void; placeholder?: string; rows?: number }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <textarea
      rows={rows}
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft)
      }}
    />
  )
}

interface ModeConfigEditorProps {
  mapId: string
  mapName: string
  stageOptions: { id: string; label: string }[]
  profiles: GameModeProfile[]
  profile: GameModeProfile
  mapConfig: ModeMapOverride
  session: ModeEditorSession
  onSessionChange: (patch: Partial<ModeEditorSession>) => void
  onSelectItem: (
    selection: ModeEditorSelection,
    options?: { additive?: boolean; range?: boolean; order?: ModeEditorSelectionItem[] },
  ) => void
  onCreateProfile: (name: string) => void
  onDeleteProfile: (id: string) => void
  onUpdateProfile: (id: string, patch: Partial<Pick<GameModeProfile, 'name' | 'description'>>) => void
  onMapConfigChange: (config: ModeMapOverride) => void
  onSyncAttackDefense: () => void
  selectedVehicleRefreshRuleIds: string[]
  onSelectedVehicleRefreshRuleIdsChange: (uids: string[]) => void
  onImportVehicleRefreshRules: (text: string) => { imported: number; ignored: number; errors: string[] }
  onFinishZoneDraft: () => void
  onDeleteSelection: () => void
  onRequestConfirm: (title: string, message: string, onConfirm: () => void) => void
  onRequestPrompt: (title: string, initialValue: string, onSubmit: (value: string) => void) => void
  requestedPaletteAsset: ModePaletteAsset | null
  collapsed: boolean
  onToggleCollapsed: () => void
}

export default function ModeConfigEditor({
  mapId,
  mapName,
  stageOptions,
  profiles,
  profile,
  mapConfig,
  session,
  onSessionChange,
  onSelectItem,
  onCreateProfile,
  onDeleteProfile,
  onUpdateProfile,
  onMapConfigChange,
  onSyncAttackDefense,
  selectedVehicleRefreshRuleIds,
  onSelectedVehicleRefreshRuleIdsChange,
  onImportVehicleRefreshRules,
  onFinishZoneDraft,
  onDeleteSelection,
  onRequestConfirm,
  onRequestPrompt,
  requestedPaletteAsset,
  collapsed,
  onToggleCollapsed,
}: ModeConfigEditorProps) {
  const copyZoneStageRef = useRef<HTMLSelectElement>(null)
  const selectedZone =
    session.selected?.kind === 'zone'
      ? mapConfig.zones.find((zone) => zone.uid === session.selected?.uid) ?? null
      : null
  const selectedSpawn =
    session.selected?.kind === 'spawn'
      ? mapConfig.spawns.find((spawn) => spawn.uid === session.selected?.uid) ?? null
      : null
  const selectedObjective =
    session.selected?.kind === 'objective'
      ? mapConfig.objectives.find((point) => point.uid === session.selected?.uid) ?? null
      : null
  const selectedProp =
    session.selected?.kind === 'prop'
      ? mapConfig.props.find((prop) => prop.uid === session.selected?.uid) ?? null
      : null
  const selectedVehicleRefreshPoint =
    session.selected?.kind === 'vehicle-refresh-point'
      ? mapConfig.vehicleRefreshPoints.find((point) => point.uid === session.selected?.uid) ?? null
      : null
  const stageZones = mapConfig.zones.filter((zone) => zone.stageId === session.stageId)
  const stageSpawns = mapConfig.spawns.filter((spawn) => spawn.stageId === session.stageId)
  const stageObjectives = mapConfig.objectives.filter((point) => point.stageId === session.stageId)
  const stageProps = mapConfig.props.filter((prop) => prop.stageId === '*' || prop.stageId === session.stageId)
  const listSelectionOrder: ModeEditorSelectionItem[] = [
    ...stageZones.map((item) => ({ kind: 'zone' as const, uid: item.uid })),
    ...stageObjectives.map((item) => ({ kind: 'objective' as const, uid: item.uid })),
    ...stageSpawns.map((item) => ({ kind: 'spawn' as const, uid: item.uid })),
    ...stageProps.map((item) => ({ kind: 'prop' as const, uid: item.uid })),
    ...mapConfig.vehicleRefreshPoints.map((item) => ({ kind: 'vehicle-refresh-point' as const, uid: item.uid })),
  ]
  const selectedItemKeys = new Set((session.selectedItems.length > 0 ? session.selectedItems : session.selected ? [session.selected] : []).map((item) => `${item.kind}:${item.uid}`))
  const selectListItem = (event: ReactMouseEvent<HTMLButtonElement>, selection: ModeEditorSelectionItem) => {
    setActivePanel('properties')
    onSelectItem(selection, {
      additive: event.ctrlKey || event.metaKey,
      range: event.shiftKey,
      order: listSelectionOrder,
    })
  }
  const currentStageLabel = mapConfig.stages.find((stage) => stage.id === session.stageId)?.label ?? ''
  const [stageLabelDraft, setStageLabelDraft] = useState(currentStageLabel)
  const [vehicleRefreshTableDraft, setVehicleRefreshTableDraft] = useState('')
  const [vehicleImportMode, setVehicleImportMode] = useState<VehicleImportMode>('single')
  const [singleVehicleRule, setSingleVehicleRule] = useState({
    objective: 'A',
    side: '攻',
    trigger: '',
    vehicle: DEPLOY_VEHICLE_CATALOG[0]?.name ?? '',
    note: '',
  })
  const [activePanel, setActivePanel] = useState<ModeEditorPanel>('properties')
  const supportsVehicleRefresh = profile.id !== 'attack-defense'

  useEffect(() => {
    if (!supportsVehicleRefresh && activePanel === 'vehicle-refresh') setActivePanel('properties')
  }, [activePanel, supportsVehicleRefresh])
  const [vehicleRuleFilter, setVehicleRuleFilter] = useState<VehicleRuleFilter>('pending')
  const [vehicleImportFeedback, setVehicleImportFeedback] = useState<{ tone: 'success' | 'warning'; title: string; detail: string } | null>(null)
  const selectedIdentity = session.selected ? `${session.selected.kind}:${session.selected.uid}` : ''
  const completedVehicleRuleCount = mapConfig.vehicleRefreshRules.filter((rule) => rule.action === 'disable' || Boolean(rule.refreshPointUid)).length
  const pendingVehicleRuleCount = mapConfig.vehicleRefreshRules.length - completedVehicleRuleCount
  const selectedLocatedVehicleRuleCount = mapConfig.vehicleRefreshRules.filter((rule) =>
    selectedVehicleRefreshRuleIds.includes(rule.uid) && rule.action === 'refresh' && Boolean(rule.refreshPointUid),
  ).length
  const visibleVehicleRefreshRules = mapConfig.vehicleRefreshRules.filter((rule) => {
    const completed = rule.action === 'disable' || Boolean(rule.refreshPointUid)
    if (vehicleRuleFilter === 'pending') return !completed
    if (vehicleRuleFilter === 'completed') return completed
    return true
  })

  // 阶段名称先在输入框内本地编辑，失焦时再提交到整份地图配置。
  // 避免每个输入字符都重建历史、保存并重绘整张地图，尤其可防止中文输入法组合文本抖动。
  useEffect(() => {
    setStageLabelDraft(currentStageLabel)
  }, [currentStageLabel, mapId, profile.id, session.stageId])

  useEffect(() => {
    if (selectedIdentity) setActivePanel('properties')
  }, [selectedIdentity])

  useEffect(() => {
    if (session.tool === 'vehicle-refresh' || requestedPaletteAsset?.kind === 'vehicle-refresh') setActivePanel('vehicle-refresh')
  }, [requestedPaletteAsset, session.tool])

  const commitStageLabel = useCallback(() => {
    if (stageLabelDraft === currentStageLabel) return
    onMapConfigChange({
      ...mapConfig,
      stages: mapConfig.stages.map((stage) => stage.id === session.stageId ? { ...stage, label: stageLabelDraft } : stage),
      updatedAt: Date.now(),
    })
  }, [currentStageLabel, mapConfig, onMapConfigChange, session.stageId, stageLabelDraft])

  const replaceZone = (uid: string, patch: Partial<ModeZone>) => {
    onMapConfigChange({
      ...mapConfig,
      zones: mapConfig.zones.map((zone) => (zone.uid === uid ? { ...zone, ...patch } : zone)),
      updatedAt: Date.now(),
    })
  }

  const replaceSpawn = (uid: string, patch: Partial<ModeSpawnPoint>) => {
    onMapConfigChange({
      ...mapConfig,
      spawns: mapConfig.spawns.map((spawn) => (spawn.uid === uid ? { ...spawn, ...patch } : spawn)),
      updatedAt: Date.now(),
    })
  }

  const replaceObjective = (uid: string, patch: Partial<ModeObjectivePoint>) => {
    onMapConfigChange({
      ...mapConfig,
      objectives: mapConfig.objectives.map((point) => (point.uid === uid ? { ...point, ...patch } : point)),
      updatedAt: Date.now(),
    })
  }

  const replaceProp = (uid: string, patch: Partial<ModeMapProp>) => {
    onMapConfigChange({
      ...mapConfig,
      props: mapConfig.props.map((prop) => (prop.uid === uid ? { ...prop, ...patch } : prop)),
      updatedAt: Date.now(),
    })
  }

  const replaceVehicleRefreshPoint = (uid: string, patch: Partial<ModeVehicleRefreshPoint>) => {
    onMapConfigChange({
      ...mapConfig,
      vehicleRefreshPoints: mapConfig.vehicleRefreshPoints.map((point) => point.uid === uid ? { ...point, ...patch } : point),
      updatedAt: Date.now(),
    })
  }

  useEffect(() => {
    const onBackspace = (event: KeyboardEvent) => {
      if (event.key !== 'Backspace') return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (!session.selected && session.selectedItems.length === 0) return
      event.preventDefault()
      onDeleteSelection()
    }
    window.addEventListener('keydown', onBackspace)
    return () => window.removeEventListener('keydown', onBackspace)
  }, [onDeleteSelection, session.selected, session.selectedItems.length])

  const toggleDeployVehicle = (entry: DeployVehicleEntry) => {
    if (!selectedSpawn) return
    const selected = selectedSpawn.deployVehicles.some((vehicle) => vehicle.name === entry.name)
    const deployVehicles = selected
      ? selectedSpawn.deployVehicles.filter((vehicle) => vehicle.name !== entry.name)
      : [...selectedSpawn.deployVehicles, {
          name: entry.name,
          icon: entry.icon,
          iconUrl: entry.iconUrl,
          legendKey: entry.legendKey,
          badge: entry.badge,
          category: entry.category,
          cd: entry.cd,
          num: entry.num,
          allowTeammate: entry.allowTeammate,
        }]
    replaceSpawn(selectedSpawn.uid, {
      vehicleDeploy: deployVehicles.length > 0,
      deployVehicles,
      vehicleCategories: [...new Set(deployVehicles.map((vehicle) => vehicle.category))],
    })
  }

  const replaceDeployVehicle = (name: string, patch: Partial<ModeSpawnPoint['deployVehicles'][number]>) => {
    if (!selectedSpawn) return
    replaceSpawn(selectedSpawn.uid, {
      deployVehicles: selectedSpawn.deployVehicles.map((vehicle) => vehicle.name === name ? { ...vehicle, ...patch } : vehicle),
    })
  }

  const bindCaptureZone = (zoneUid: string, objectiveUid: string) => {
    onMapConfigChange({
      ...mapConfig,
      zones: mapConfig.zones.map((zone) => ({
        ...zone,
        objectiveUid: zone.uid === zoneUid ? objectiveUid || undefined : zone.objectiveUid === objectiveUid ? undefined : zone.objectiveUid,
      })),
      objectives: mapConfig.objectives.map((point) => ({
        ...point,
        captureZoneUid: point.uid === objectiveUid ? zoneUid : point.captureZoneUid === zoneUid ? '' : point.captureZoneUid,
      })),
      updatedAt: Date.now(),
    })
  }

  const changeZoneRole = (zone: ModeZone, role: ModeZoneRole) => {
    const meta = ZONE_ROLE_OPTIONS.find((item) => item.value === role)!
    onMapConfigChange({
      ...mapConfig,
      zones: mapConfig.zones.map((item) => item.uid === zone.uid
        ? { ...item, role, kind: meta.kind, color: meta.color, objectiveUid: role === 'capture' ? item.objectiveUid : undefined }
        : item),
      objectives: role === 'capture' || !zone.objectiveUid
        ? mapConfig.objectives
        : mapConfig.objectives.map((point) => point.uid === zone.objectiveUid ? { ...point, captureZoneUid: '' } : point),
      updatedAt: Date.now(),
    })
  }

  const copySelectedZone = useCallback(() => {
    if (!selectedZone) return
    const targetStageId = copyZoneStageRef.current?.value ?? selectedZone.stageId
    if (!stageOptions.some((stage) => stage.id === targetStageId)) return
    const uid = genUid('mode_zone')
    const copiedZone: ModeZone = {
      ...selectedZone,
      uid,
      stageId: targetStageId,
      name: copiedZoneName(mapConfig.zones, targetStageId, selectedZone.name),
      points: selectedZone.points.map(([lat, lng]) => [lat, lng] as [number, number]),
      objectiveUid: undefined,
      verification: 'draft',
    }
    onMapConfigChange({
      ...mapConfig,
      zones: [...mapConfig.zones, copiedZone],
      updatedAt: Date.now(),
    })
    onSessionChange({
      stageId: targetStageId,
      tool: 'select',
      selected: { kind: 'zone', uid },
      selectedItems: [{ kind: 'zone', uid }],
      zoneDraft: [],
    })
  }, [mapConfig, onMapConfigChange, onSessionChange, selectedZone, stageOptions])

  const toggleVehicleRefreshRuleSelection = (uid: string) => {
    if (mapConfig.vehicleRefreshRules.find((rule) => rule.uid === uid)?.action === 'disable') return
    onSelectedVehicleRefreshRuleIdsChange(selectedVehicleRefreshRuleIds.includes(uid)
      ? selectedVehicleRefreshRuleIds.filter((item) => item !== uid)
      : [...selectedVehicleRefreshRuleIds, uid])
  }

  const deleteSelectedVehicleRefreshRules = () => {
    if (selectedVehicleRefreshRuleIds.length === 0) return
    const selectedIds = new Set(selectedVehicleRefreshRuleIds)
    // 规则列表中的删除是明确操作；即使规则来自已固化数据，也必须允许移除。
    // 否则 confirmed 规则没有解锁入口，会出现按钮可点但规则永远删不掉的假操作。
    const rules = mapConfig.vehicleRefreshRules.filter((rule) => !selectedIds.has(rule.uid))
    const usedPointIds = new Set(rules.map((rule) => rule.refreshPointUid).filter(Boolean))
    onMapConfigChange({
      ...mapConfig,
      vehicleRefreshRules: rules,
      // 刷新位置没有独立语义；最后一条引用规则删除后同步移除，避免留下无法选中的空 Marker。
      vehicleRefreshPoints: mapConfig.vehicleRefreshPoints.filter((point) => usedPointIds.has(point.uid)),
      updatedAt: Date.now(),
    })
    onSelectedVehicleRefreshRuleIdsChange([])
    onSessionChange({ tool: 'select' })
  }

  const unbindSelectedVehicleRefreshRules = () => {
    if (selectedLocatedVehicleRuleCount === 0) return
    const selectedIds = new Set(selectedVehicleRefreshRuleIds)
    const rules = mapConfig.vehicleRefreshRules.map((rule) =>
      selectedIds.has(rule.uid) && rule.action === 'refresh' && rule.refreshPointUid
        ? { ...rule, refreshPointUid: '' }
        : rule,
    )
    const usedPointIds = new Set(rules.map((rule) => rule.refreshPointUid).filter(Boolean))
    onMapConfigChange({
      ...mapConfig,
      vehicleRefreshRules: rules,
      // 共用位置仍被其他规则引用时保留；无人引用的草稿位置自动清理。
      vehicleRefreshPoints: mapConfig.vehicleRefreshPoints.filter((point) =>
        point.verification === 'confirmed' || usedPointIds.has(point.uid),
      ),
      updatedAt: Date.now(),
    })
    onSelectedVehicleRefreshRuleIdsChange([])
    onSessionChange({ tool: 'select', selected: null, selectedItems: [] })
    setVehicleRuleFilter('pending')
  }

  const importVehicleRefreshTable = () => {
    if (!vehicleRefreshTableDraft.trim()) return
    const result = onImportVehicleRefreshRules(vehicleRefreshTableDraft)
    const summary = [
      result.imported ? `新增 ${result.imported} 条` : '',
      result.ignored ? `忽略 ${result.ignored} 条重复项` : '',
      result.errors.length ? `${result.errors.length} 行需要检查` : '',
    ].filter(Boolean).join('，') || '没有可导入的规则'
    setVehicleImportFeedback({
      tone: result.errors.length > 0 ? 'warning' : 'success',
      title: result.imported > 0 ? '表格导入完成' : '未导入新规则',
      detail: result.errors.length > 0 ? `${summary}。${result.errors.slice(0, 3).join('；')}` : `${summary}。`,
    })
    if (result.imported > 0) setVehicleRefreshTableDraft('')
  }

  const importSingleVehicleRefreshRule = () => {
    const objective = singleVehicleRule.objective.trim().toUpperCase()
    const trigger = singleVehicleRule.trigger.trim()
    if (!objective || !trigger || !singleVehicleRule.vehicle) return
    const row = [mapName, '胜者为王', objective, singleVehicleRule.side, trigger, singleVehicleRule.vehicle, singleVehicleRule.note.trim()].join('\t')
    const result = onImportVehicleRefreshRules(row)
    const detail = result.errors.length > 0
      ? result.errors.join('；')
      : result.imported > 0 ? `已向“${mapName}”新增 1 条刷新规则。` : '该规则已存在，未重复导入。'
    setVehicleImportFeedback({
      tone: result.errors.length > 0 ? 'warning' : 'success',
      title: result.imported > 0 ? '单条规则已导入' : result.errors.length > 0 ? '无法导入这条规则' : '规则已经存在',
      detail,
    })
    if (result.imported > 0) {
      setSingleVehicleRule((current) => ({ ...current, objective: '', trigger: '', note: '' }))
    }
  }

  const addStage = () => {
    const maxNumber = mapConfig.stages.reduce((max, stage) => {
      const match = /^S(\d+)$/i.exec(stage.id)
      return match ? Math.max(max, Number(match[1])) : max
    }, 0)
    const id = `S${maxNumber + 1}`
    onRequestPrompt('新阶段名称', `第${maxNumber + 1}阶段`, (value) => {
      const label = value.trim()
      if (!label) return
      onMapConfigChange({ ...mapConfig, stages: [...mapConfig.stages, { id, label }], updatedAt: Date.now() })
      onSessionChange({ stageId: id, tool: 'select', selected: null, selectedItems: [], zoneDraft: [] })
    })
  }

  const deleteCurrentStage = () => {
    if (mapConfig.stages.length <= 1) return
    const stage = mapConfig.stages.find((item) => item.id === session.stageId)
    if (!stage) return
    onRequestConfirm('删除当前阶段', `删除“${stage.id} · ${stage.label}”及其全部区域、据点、复活点和阶段道具？`, () => {
      const nextStages = mapConfig.stages.filter((item) => item.id !== stage.id)
      onMapConfigChange({
        ...mapConfig,
        stages: nextStages,
        zones: mapConfig.zones.filter((zone) => zone.stageId !== stage.id),
        objectives: mapConfig.objectives.filter((point) => point.stageId !== stage.id),
        spawns: mapConfig.spawns.filter((spawn) => spawn.stageId !== stage.id),
        props: mapConfig.props.filter((prop) => prop.stageId === '*' || prop.stageId !== stage.id),
        updatedAt: Date.now(),
      })
      onSessionChange({ stageId: nextStages[0]?.id ?? 'S1', tool: 'select', selected: null, selectedItems: [], zoneDraft: [] })
    })
  }

  return (
    <>
    {collapsed ? <button className="collapse-float right mode-config-panel-float" type="button" onClick={onToggleCollapsed} title="展开右侧工具栏" aria-label="展开右侧工具栏">
      <i className="fa-solid fa-chevron-left" aria-hidden="true" />
    </button> : null}
    <section className={`mode-config-editor${collapsed ? ' collapsed' : ''}`} aria-label="模式配置编辑器" onMouseDown={(event) => event.stopPropagation()}>
      <header className="mode-config-editor-head">
        <div>
          <strong>编辑地图内容</strong>
          <span>{mapName} · {session.stageId} · {profile.name}</span>
        </div>
        <div className="mode-config-editor-head-actions">
          <button
            type="button"
            onClick={onToggleCollapsed}
            title={collapsed ? '展开右侧工具栏' : '收起右侧工具栏'}
            aria-label={collapsed ? '展开右侧工具栏' : '收起右侧工具栏'}
            aria-expanded={!collapsed}
          >
            <i className={`fa-solid ${collapsed ? 'fa-chevron-left' : 'fa-chevron-right'}`} />
          </button>
        </div>
      </header>

      <nav className="mode-config-editor-tabs" aria-label="编辑面板">
        <button className={activePanel === 'properties' ? 'active' : ''} onClick={() => setActivePanel('properties')}><i className="fa-solid fa-sliders" /><span>属性</span></button>
        <button className={activePanel === 'objects' ? 'active' : ''} onClick={() => setActivePanel('objects')}><i className="fa-solid fa-list" /><span>对象</span><b>{listSelectionOrder.length}</b></button>
        {supportsVehicleRefresh ? <button className={activePanel === 'vehicle-refresh' ? 'active' : ''} onClick={() => setActivePanel('vehicle-refresh')}><i className="fa-solid fa-truck-fast" /><span>载具规则</span>{pendingVehicleRuleCount > 0 ? <b className="warning">{pendingVehicleRuleCount}</b> : null}</button> : null}
        <button className={activePanel === 'settings' ? 'active' : ''} onClick={() => setActivePanel('settings')}><i className="fa-solid fa-gear" /><span>设置</span></button>
      </nav>

      {activePanel === 'settings' ? (
        <div className="mode-config-panel mode-config-settings-panel">
          <div className="mode-config-panel-intro"><i className="fa-solid fa-gear" /><span><strong>模式与阶段设置</strong><small>低频管理操作集中在这里，地图和阶段可在顶部快速切换。</small></span></div>
          <section className="mode-config-settings-card">
            <header><strong>当前模式</strong><span>{profile.id}</span></header>
            <div className="mode-config-profile-actions">
              <button onClick={() => onRequestPrompt('新模式名称', '新模式', (value) => { const name = value.trim(); if (name) onCreateProfile(name) })}><i className="fa-solid fa-plus" />新建模式</button>
              <button className="danger" disabled={profiles.length <= 1 || profile.id === 'attack-defense'} onClick={() => onRequestConfirm('删除模式', `删除模式“${profile.name}”及其全部地图配置？`, () => onDeleteProfile(profile.id))}><i className="fa-solid fa-trash" />删除模式</button>
            </div>
            <label className="mode-config-field"><span>模式名称</span><CommitTextInput value={profile.name} onCommit={(name) => onUpdateProfile(profile.id, { name })} /></label>
            <label className="mode-config-field"><span>模式说明</span><CommitTextarea value={profile.description} placeholder="记录规则、数据来源或待核对内容" onCommit={(description) => onUpdateProfile(profile.id, { description })} rows={3} /></label>
          </section>
          <section className="mode-config-settings-card">
            <header><strong>当前阶段</strong><span>{session.stageId}</span></header>
            <label className="mode-config-field"><span>阶段名称</span><input value={stageLabelDraft} onChange={(event) => setStageLabelDraft(event.target.value)} onBlur={commitStageLabel} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.currentTarget.blur() }} /></label>
            <div className="mode-config-stage-actions">
              <button onClick={addStage}><i className="fa-solid fa-plus" />新增阶段</button>
              <button className="danger" disabled={mapConfig.stages.length <= 1} onClick={deleteCurrentStage}><i className="fa-solid fa-trash" />删除当前阶段</button>
            </div>
            <button className="mode-config-secondary-action" onClick={() => onRequestConfirm('重新生成底稿', `重新从攻防模式同步“${mapName}”的全部阶段？当前地图的模式配置将被覆盖。`, onSyncAttackDefense)}><i className="fa-solid fa-rotate" />从攻防模式重新生成底稿</button>
          </section>
          <section className="mode-config-settings-card">
            <header><strong>地图备注</strong><span>{mapName}</span></header>
            <CommitTextarea value={mapConfig.notes} onCommit={(notes) => onMapConfigChange({ ...mapConfig, notes, updatedAt: Date.now() })} placeholder="记录数据来源、核对状态或发布说明" rows={4} />
          </section>
        </div>
      ) : null}

      {session.tool === 'zone' ? (
        <div className="mode-config-active-task">
          <div><i className="fa-solid fa-draw-polygon" /><span><strong>正在绘制区域</strong><small>依次点击地图添加顶点，至少需要 3 个顶点。</small></span></div>
          <label><span>区域用途</span><select value={session.zoneRole} onChange={(event) => onSessionChange({ zoneRole: event.target.value as ModeZoneRole, zoneDraft: [] })}>{ZONE_ROLE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <div className="mode-config-draft-bar"><span>已标记 <b>{session.zoneDraft.length}</b> 个顶点</span><button className="primary" disabled={session.zoneDraft.length < 3} onClick={onFinishZoneDraft}>完成区域</button><button onClick={() => onSessionChange({ zoneDraft: [] })}>重新绘制</button><button onClick={() => onSessionChange({ tool: 'select', zoneDraft: [] })}>取消</button></div>
        </div>
      ) : null}

      {supportsVehicleRefresh && activePanel === 'vehicle-refresh' ? (
        <div className="mode-config-panel mode-vehicle-refresh-editor">
          <div className="mode-config-panel-intro vehicle"><i className="fa-solid fa-truck-fast" /><span><strong>胜者为王载具刷新</strong><small>导入规则、标注地图位置，再检查未完成项。</small></span><div className="mode-vehicle-progress"><b>{completedVehicleRuleCount}</b><span>/ {mapConfig.vehicleRefreshRules.length}</span></div></div>

          <details className="mode-config-workflow-step" open={mapConfig.vehicleRefreshRules.length === 0}>
            <summary><b>1</b><span><strong>导入规则表</strong><small>单条填写，或从 Excel / CSV 批量导入</small></span><i className="fa-solid fa-chevron-down" /></summary>
            <div className="mode-vehicle-refresh-import">
              <div className="mode-vehicle-import-tabs" role="tablist" aria-label="规则导入方式">
                <button role="tab" aria-selected={vehicleImportMode === 'single'} className={vehicleImportMode === 'single' ? 'active' : ''} onClick={() => setVehicleImportMode('single')}><i className="fa-solid fa-plus" />单个导入</button>
                <button role="tab" aria-selected={vehicleImportMode === 'batch'} className={vehicleImportMode === 'batch' ? 'active' : ''} onClick={() => setVehicleImportMode('batch')}><i className="fa-solid fa-table" />批量导入</button>
              </div>
              {vehicleImportMode === 'single' ? (
                <div className="mode-vehicle-single-import" role="tabpanel">
                  <label className="wide mode-vehicle-current-map"><span>当前地图</span><strong>{mapName}</strong></label>
                  <label><span>点位</span><input value={singleVehicleRule.objective} onChange={(event) => setSingleVehicleRule((current) => ({ ...current, objective: event.target.value }))} placeholder="A / B / C" /></label>
                  <label><span>阵营</span><select value={singleVehicleRule.side} onChange={(event) => setSingleVehicleRule((current) => ({ ...current, side: event.target.value }))}><option value="攻">进攻方</option><option value="守">防守方</option></select></label>
                  <label className="wide"><span>兵力/时间</span><input value={singleVehicleRule.trigger} onChange={(event) => setSingleVehicleRule((current) => ({ ...current, trigger: event.target.value }))} placeholder="如 125、18:00、倒计时10s" /></label>
                  <label className="wide"><span>刷新载具</span><select value={singleVehicleRule.vehicle} onChange={(event) => setSingleVehicleRule((current) => ({ ...current, vehicle: event.target.value }))}>{DEPLOY_VEHICLE_CATALOG.map((vehicle) => <option key={vehicle.name} value={vehicle.name}>{vehicle.name}</option>)}</select></label>
                  <label className="wide"><span>备注</span><input value={singleVehicleRule.note} onChange={(event) => setSingleVehicleRule((current) => ({ ...current, note: event.target.value }))} placeholder="可选：位置、延迟时间或停止部署条件" /></label>
                  <button className="primary wide" disabled={!singleVehicleRule.objective.trim() || !singleVehicleRule.trigger.trim() || !singleVehicleRule.vehicle} onClick={importSingleVehicleRefreshRule}><i className="fa-solid fa-file-circle-plus" />导入这条规则</button>
                </div>
              ) : (
                <div className="mode-vehicle-batch-import" role="tabpanel">
                  <textarea rows={5} value={vehicleRefreshTableDraft} onChange={(event) => { setVehicleRefreshTableDraft(event.target.value); setVehicleImportFeedback(null) }} placeholder={'地图名\t类型\t点位\t阵营\t兵力/时间\t刷新载具\t备注'} />
                  <button className="primary" disabled={!vehicleRefreshTableDraft.trim()} onClick={importVehicleRefreshTable}><i className="fa-solid fa-table" />导入粘贴内容</button>
                  <small>支持 Excel、TSV 和 CSV，可一次导入多张地图；重复规则自动忽略。</small>
                </div>
              )}
              {vehicleImportFeedback ? <div className={`mode-config-feedback ${vehicleImportFeedback.tone}`} role="status" aria-live="polite"><i className={`fa-solid ${vehicleImportFeedback.tone === 'success' ? 'fa-circle-check' : 'fa-triangle-exclamation'}`} aria-hidden="true" /><span><strong>{vehicleImportFeedback.title}</strong><small>{vehicleImportFeedback.detail}</small></span><button onClick={() => setVehicleImportFeedback(null)} aria-label="关闭提示">×</button></div> : null}
            </div>
          </details>

          <section className="mode-config-workflow-step open">
            <header><b>2</b><span><strong>选择并标注规则</strong><small>{pendingVehicleRuleCount > 0 ? `还有 ${pendingVehicleRuleCount} 条需要地图位置` : '当前规则均已完成'}</small></span></header>
            {mapConfig.vehicleRefreshRules.length > 0 ? (
              <>
                <div className="mode-vehicle-refresh-toolbar">
                  <div className="mode-vehicle-filter" aria-label="规则筛选">
                    <button className={vehicleRuleFilter === 'pending' ? 'active' : ''} onClick={() => setVehicleRuleFilter('pending')}>待标注 <b>{pendingVehicleRuleCount}</b></button>
                    <button className={vehicleRuleFilter === 'all' ? 'active' : ''} onClick={() => setVehicleRuleFilter('all')}>全部 <b>{mapConfig.vehicleRefreshRules.length}</b></button>
                    <button className={vehicleRuleFilter === 'completed' ? 'active' : ''} onClick={() => setVehicleRuleFilter('completed')}>已完成 <b>{completedVehicleRuleCount}</b></button>
                  </div>
                  <button onClick={() => onSelectedVehicleRefreshRuleIdsChange(mapConfig.vehicleRefreshRules.filter((rule) => rule.action === 'refresh' && !rule.refreshPointUid).map((rule) => rule.uid))}>选择全部待标注</button>
                  {selectedVehicleRefreshRuleIds.length > 0 ? <button onClick={() => onSelectedVehicleRefreshRuleIdsChange([])}>清除选择</button> : null}
                </div>
                <div className="mode-vehicle-refresh-rule-header"><span>规则</span><span>地图位置</span></div>
                <div className="mode-vehicle-refresh-rule-list">
                  {visibleVehicleRefreshRules.map((rule) => {
                    const point = mapConfig.vehicleRefreshPoints.find((item) => item.uid === rule.refreshPointUid)
                    return (
                      <label key={rule.uid} className={`${selectedVehicleRefreshRuleIds.includes(rule.uid) ? 'selected' : ''}${rule.action === 'disable' || point ? ' located' : ' pending'}`}>
                        <TacticalCheckbox
                          checked={selectedVehicleRefreshRuleIds.includes(rule.uid)}
                          disabled={rule.action === 'disable'}
                          ariaLabel={`选择规则：${rule.objective}点 · ${rule.vehicle.name}`}
                          onChange={() => toggleVehicleRefreshRuleSelection(rule.uid)}
                        />
                        <img src={rule.vehicle.iconUrl} alt="" />
                        <span><strong>{rule.objective}点 · {rule.side === 'attack' ? '进攻方' : '防守方'} · {rule.vehicle.name}</strong><small>{rule.action === 'disable' ? '停止部署 · ' : ''}{refreshTriggerLabel(rule.trigger)}{rule.note ? ` · ${rule.note}` : ''}</small></span>
                        <em className={rule.action === 'disable' || point ? 'done' : ''}>{rule.action === 'disable' ? '无需坐标' : point ? point.name : '待标注'}</em>
                      </label>
                    )
                  })}
                  {visibleVehicleRefreshRules.length === 0 ? <div className="mode-vehicle-refresh-empty"><i className="fa-solid fa-circle-check" /><span>这个筛选条件下没有规则</span></div> : null}
                </div>
                <div className="mode-vehicle-refresh-primary-actions">
                  <button className="primary" disabled={selectedVehicleRefreshRuleIds.length === 0} onClick={() => onSessionChange({ tool: 'vehicle-refresh', selected: null, selectedItems: [], zoneDraft: [] })}><i className="fa-solid fa-location-crosshairs" />在地图上标注或绑定<span>{selectedVehicleRefreshRuleIds.length > 0 ? `（${selectedVehicleRefreshRuleIds.length}）` : ''}</span></button>
                  <button disabled={selectedLocatedVehicleRuleCount === 0} onClick={unbindSelectedVehicleRefreshRules} title="解除规则与地图位置的绑定，规则本身会保留"><i className="fa-solid fa-link-slash" />取消标注{selectedLocatedVehicleRuleCount > 0 ? `（${selectedLocatedVehicleRuleCount}）` : ''}</button>
                  <button className="danger" disabled={selectedVehicleRefreshRuleIds.length === 0} onClick={deleteSelectedVehicleRefreshRules}><i className="fa-solid fa-trash" />删除选中规则</button>
                </div>
                {session.tool === 'vehicle-refresh' && selectedVehicleRefreshRuleIds.length > 0 ? <div className="mode-vehicle-refresh-hint"><i className="fa-solid fa-location-dot" /><span><strong>现在点击地图</strong><small>点击空白处创建共享位置，或点击已有刷新点进行绑定；完成后返回选择模式。</small></span><button onClick={() => onSessionChange({ tool: 'select' })}>退出标注</button></div> : null}
              </>
            ) : <div className="mode-vehicle-refresh-empty"><i className="fa-solid fa-table" /><span>先在步骤 1 粘贴并导入载具刷新规则</span></div>}
          </section>

          <section className="mode-config-workflow-step open compact">
            <header><b>3</b><span><strong>检查刷新位置</strong><small>已建立 {mapConfig.vehicleRefreshPoints.length} 个位置，拖动地图标记可以修正坐标。</small></span></header>
            <button className="mode-config-secondary-action" onClick={() => setActivePanel('objects')}><i className="fa-solid fa-list-check" />查看全部刷新位置</button>
          </section>
        </div>
      ) : null}

      {activePanel === 'objects' ? <div className="mode-config-panel mode-config-objects-panel">
        <div className="mode-config-panel-intro"><i className="fa-solid fa-layer-group" /><span><strong>当前阶段对象</strong><small>点击对象进入属性编辑；按 Ctrl 或 Shift 可以多选。</small></span></div>
        <div className="mode-config-summary"><span><b>{stageZones.length}</b>区域</span><span><b>{stageSpawns.length}</b>复活点</span><span><b>{stageObjectives.length}</b>据点</span><span><b>{stageProps.length}</b>道具</span><span><b>{mapConfig.vehicleRefreshPoints.length}</b>刷新点</span></div>
        <div className="mode-config-list">
        <div className="mode-config-list-title">地图对象</div>
        <details open><summary>区域 <b>{stageZones.length}</b></summary>
          {stageZones.map((zone) => (
            <button key={zone.uid} className={selectedItemKeys.has(`zone:${zone.uid}`) ? 'active' : ''} onClick={(event) => selectListItem(event, { kind: 'zone', uid: zone.uid })}>
              <i className="fa-solid fa-draw-polygon" style={{ color: zone.color }} /><span>{zone.name}</span><em>{zone.verification === 'confirmed' ? '锁定' : `${zone.points.length} 点`}</em>
            </button>
          ))}
        </details>
        <details open><summary>据点 <b>{stageObjectives.length}</b></summary>
          {stageObjectives.map((point) => (
            <button key={point.uid} className={selectedItemKeys.has(`objective:${point.uid}`) ? 'active' : ''} onClick={(event) => selectListItem(event, { kind: 'objective', uid: point.uid })}>
              <img className="mode-config-list-icon" src={`${POINT_ICON_BASE}/${point.icon}.png`} alt="" /><span>{point.name}</span><em>{point.captureZoneUid ? '已绑定' : '未绑定'}</em>
            </button>
          ))}
        </details>
        <details open><summary>复活点 <b>{stageSpawns.length}</b></summary>
          {stageSpawns.map((spawn) => (
            <button key={spawn.uid} className={selectedItemKeys.has(`spawn:${spawn.uid}`) ? 'active' : ''} onClick={(event) => selectListItem(event, { kind: 'spawn', uid: spawn.uid })}>
              <i className="fa-solid fa-location-dot" /><span>{spawn.name}</span><em>{spawn.side === 'attack' ? '攻' : '守'}{spawn.vehicleDeploy ? ` · ${spawn.deployVehicles.length}载具` : ''}</em>
            </button>
          ))}
        </details>
        <details><summary>地图道具 <b>{stageProps.length}</b></summary>
          {stageProps.map((prop) => (
            <button key={prop.uid} className={selectedItemKeys.has(`prop:${prop.uid}`) ? 'active' : ''} onClick={(event) => selectListItem(event, { kind: 'prop', uid: prop.uid })}>
              <img className="mode-config-list-icon" src={`${POINT_ICON_BASE}/${prop.icon}.png`} alt="" /><span>{prop.name}</span><em>{prop.stageId === '*' ? '全阶段' : prop.stageId}</em>
            </button>
          ))}
        </details>
        <details><summary>载具刷新位置 <b>{mapConfig.vehicleRefreshPoints.length}</b></summary>
          {mapConfig.vehicleRefreshPoints.map((point) => (
            <button key={point.uid} className={selectedItemKeys.has(`vehicle-refresh-point:${point.uid}`) ? 'active' : ''} onClick={(event) => selectListItem(event, { kind: 'vehicle-refresh-point', uid: point.uid })}>
              <i className="fa-solid fa-truck-fast" /><span>{point.name}</span><em>{mapConfig.vehicleRefreshRules.filter((rule) => rule.refreshPointUid === point.uid).length} 条规则</em>
            </button>
          ))}
        </details>
        {stageZones.length === 0 && stageSpawns.length === 0 && stageObjectives.length === 0 && stageProps.length === 0 ? (
          <p>从左侧“添加元素”选择对象，然后点击地图放置。</p>
        ) : null}
      </div>
      </div> : null}

      {activePanel === 'properties' ? <div className="mode-config-panel mode-config-properties-panel">
      {!selectedZone && !selectedSpawn && !selectedObjective && !selectedProp && !selectedVehicleRefreshPoint ? (
        <div className="mode-config-empty-state">
          <span className="icon"><i className={session.tool === 'select' ? 'fa-solid fa-arrow-pointer' : 'fa-solid fa-location-crosshairs'} /></span>
          <strong>{session.tool === 'select' ? '选择一个地图对象' : '在地图上完成放置'}</strong>
          <p>{session.tool === 'select' ? '点击地图上的元素，或在“对象”页签中选择，即可在这里编辑名称、阵营、阶段和其他属性。' : '当前已进入放置模式。点击地图创建对象，完成后会自动打开属性面板。'}</p>
          {session.tool === 'select' ? <button onClick={() => setActivePanel('objects')}><i className="fa-solid fa-list" />浏览当前对象</button> : <button onClick={() => onSessionChange({ tool: 'select', zoneDraft: [] })}>取消放置</button>}
        </div>
      ) : null}

      {selectedZone ? (
        <div className="mode-config-properties">
          <div className="mode-config-properties-title">区域属性</div>
          <PermissionControl value={selectedZone.verification} onChange={(verification) => replaceZone(selectedZone.uid, { verification })} />
          <div className="mode-config-zone-copy">
            <span>复制到阶段</span>
            <select key={selectedZone.uid} ref={copyZoneStageRef} defaultValue={selectedZone.stageId}>
              {stageOptions.map((stage) => (
                <option key={stage.id} value={stage.id}>{stage.id} · {stage.label}</option>
              ))}
            </select>
            <button onClick={copySelectedZone} title="复制区域到所选阶段">
              <i className="fa-regular fa-copy" />复制
            </button>
            <small>副本自动设为草稿；据点绑定不会跨阶段复制</small>
          </div>
          <fieldset disabled={selectedZone.verification === 'confirmed'}>
            <label className="mode-config-field"><span>名称</span><CommitTextInput value={selectedZone.name} onCommit={(name) => replaceZone(selectedZone.uid, { name })} /></label>
            <label className="mode-config-field"><span>区域用途</span>
              <select value={selectedZone.role} onChange={(event) => changeZoneRole(selectedZone, event.target.value as ModeZoneRole)}>{ZONE_ROLE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
            </label>
            <label className="mode-config-field"><span>归属类型</span><select value={selectedZone.kind} onChange={(event) => { const kind = event.target.value as ModeZoneKind; const meta = ZONE_KIND_OPTIONS.find((item) => item.value === kind)!; replaceZone(selectedZone.uid, { kind, color: meta.color }) }}>{ZONE_KIND_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            {selectedZone.role === 'capture' ? (
              <label className="mode-config-field"><span>绑定据点</span><select value={selectedZone.objectiveUid ?? ''} onChange={(event) => bindCaptureZone(selectedZone.uid, event.target.value)}><option value="">暂不绑定</option>{stageObjectives.map((point) => <option key={point.uid} value={point.uid}>{point.name}</option>)}</select></label>
            ) : null}
            <label className="mode-config-field compact"><span>颜色</span><input type="color" value={selectedZone.color} onChange={(event) => replaceZone(selectedZone.uid, { color: event.target.value })} /></label>
            <button className="mode-config-delete" onClick={onDeleteSelection}>删除区域</button>
          </fieldset>
        </div>
      ) : null}

      {selectedSpawn ? (
        <div className="mode-config-properties">
          <div className="mode-config-properties-title">复活点属性</div>
          <PermissionControl value={selectedSpawn.verification} onChange={(verification) => replaceSpawn(selectedSpawn.uid, { verification })} />
          <fieldset disabled={selectedSpawn.verification === 'confirmed'}>
            <label className="mode-config-field"><span>名称/备注</span><CommitTextInput value={selectedSpawn.name} onCommit={(name) => replaceSpawn(selectedSpawn.uid, { name })} /></label>
            <label className="mode-config-field"><span>阵营</span><select value={selectedSpawn.side} onChange={(event) => replaceSpawn(selectedSpawn.uid, { side: event.target.value as ModeSpawnPoint['side'] })}><option value="attack">进攻方</option><option value="defense">防守方</option></select></label>
            <label className="mode-config-check"><TacticalCheckbox checked={selectedSpawn.vehicleDeploy} onChange={(vehicleDeploy) => replaceSpawn(selectedSpawn.uid, { vehicleDeploy })} />允许部署载具</label>
            {selectedSpawn.vehicleDeploy ? (
              <>
                <div className="mode-config-vehicle-grid detailed">
                  {DEPLOY_VEHICLE_CATALOG.map((item) => <button key={item.name} className={selectedSpawn.deployVehicles.some((vehicle) => vehicle.name === item.name) ? 'active' : ''} onClick={() => toggleDeployVehicle(item)} title={`${item.name} · ${item.cd}s · ${item.num}辆`}><img src={item.iconUrl} alt="" /><span>{item.name}</span></button>)}
                </div>
                <div className="mode-config-deploy-settings">
                  {selectedSpawn.deployVehicles.map((vehicle) => (
                    <div key={vehicle.name}>
                      <img src={vehicle.iconUrl} alt="" /><strong>{vehicle.name}</strong>
                      <label>CD<input type="number" min="0" value={vehicle.cd} onChange={(event) => replaceDeployVehicle(vehicle.name, { cd: Number(event.target.value) })} /></label>
                      <label>数量<input type="number" min="1" value={vehicle.num} onChange={(event) => replaceDeployVehicle(vehicle.name, { num: Math.max(1, Number(event.target.value)) })} /></label>
                      <label className="check"><TacticalCheckbox checked={vehicle.allowTeammate} onChange={(allowTeammate) => replaceDeployVehicle(vehicle.name, { allowTeammate })} />友方可用</label>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
            <div className="mode-config-coords">{selectedSpawn.lat.toFixed(3)}, {selectedSpawn.lng.toFixed(3)}</div>
            <button className="mode-config-delete" onClick={onDeleteSelection}>删除复活点</button>
          </fieldset>
        </div>
      ) : null}

      {selectedObjective ? (
        <div className="mode-config-properties">
          <div className="mode-config-properties-title">据点属性</div>
          <PermissionControl value={selectedObjective.verification} onChange={(verification) => replaceObjective(selectedObjective.uid, { verification })} />
          <fieldset disabled={selectedObjective.verification === 'confirmed'}>
            <label className="mode-config-field"><span>名称</span><CommitTextInput value={selectedObjective.name} onCommit={(name) => replaceObjective(selectedObjective.uid, { name })} /></label>
            <label className="mode-config-field"><span>备注</span><CommitTextInput value={selectedObjective.note} onCommit={(note) => replaceObjective(selectedObjective.uid, { note })} /></label>
            <label className="mode-config-field"><span>正式图标</span><select value={selectedObjective.icon} onChange={(event) => replaceObjective(selectedObjective.uid, { icon: event.target.value })}>{OBJECTIVE_ICON_OPTIONS.map((icon) => <option key={icon} value={icon}>{icon.replace('q_jd_', '').toUpperCase()}</option>)}</select></label>
            <label className="mode-config-field"><span>占领区</span><select value={selectedObjective.captureZoneUid} onChange={(event) => bindCaptureZone(event.target.value, selectedObjective.uid)}><option value="">未绑定</option>{stageZones.filter((zone) => zone.role === 'capture').map((zone) => <option key={zone.uid} value={zone.uid}>{zone.name}</option>)}</select></label>
            <div className="mode-config-coords">{selectedObjective.lat.toFixed(3)}, {selectedObjective.lng.toFixed(3)}</div>
            <button className="mode-config-delete" onClick={onDeleteSelection}>删除据点及占领区</button>
          </fieldset>
        </div>
      ) : null}

      {selectedProp ? (
        <div className="mode-config-properties">
          <div className="mode-config-properties-title">地图道具属性</div>
          <PermissionControl value={selectedProp.verification} onChange={(verification) => replaceProp(selectedProp.uid, { verification })} />
          <fieldset disabled={selectedProp.verification === 'confirmed'}>
            <label className="mode-config-field"><span>类型</span><select value={`${selectedProp.name}:${selectedProp.icon}`} onChange={(event) => { const option = PROP_OPTIONS.find((item) => `${item.name}:${item.icon}` === event.target.value); if (option) replaceProp(selectedProp.uid, { name: option.name, icon: option.icon }) }}>{PROP_OPTIONS.map((item) => <option key={item.icon} value={`${item.name}:${item.icon}`}>{item.name}</option>)}</select></label>
            <label className="mode-config-field"><span>显示阶段</span><select value={selectedProp.stageId} onChange={(event) => replaceProp(selectedProp.uid, { stageId: event.target.value })}><option value="*">全部阶段</option>{stageOptions.map((stage) => <option key={stage.id} value={stage.id}>{stage.id} · {stage.label}</option>)}</select></label>
            <div className="mode-config-coords">{selectedProp.lat.toFixed(3)}, {selectedProp.lng.toFixed(3)}</div>
            <button className="mode-config-delete" onClick={onDeleteSelection}>删除地图道具</button>
          </fieldset>
        </div>
      ) : null}

      {selectedVehicleRefreshPoint ? (
        <div className="mode-config-properties">
          <div className="mode-config-properties-title">载具刷新位置</div>
          <PermissionControl value={selectedVehicleRefreshPoint.verification} onChange={(verification) => replaceVehicleRefreshPoint(selectedVehicleRefreshPoint.uid, { verification })} />
          <fieldset disabled={selectedVehicleRefreshPoint.verification === 'confirmed'}>
            <label className="mode-config-field"><span>位置名称</span><CommitTextInput value={selectedVehicleRefreshPoint.name} onCommit={(name) => replaceVehicleRefreshPoint(selectedVehicleRefreshPoint.uid, { name })} /></label>
            <div className="mode-config-coords">{selectedVehicleRefreshPoint.lat.toFixed(3)}, {selectedVehicleRefreshPoint.lng.toFixed(3)}</div>
            <small>已绑定 {mapConfig.vehicleRefreshRules.filter((rule) => rule.refreshPointUid === selectedVehicleRefreshPoint.uid).length} 条刷新规则；拖动地图标记可修正坐标。</small>
            <button className="mode-config-delete" onClick={onDeleteSelection}>删除位置并取消规则绑定</button>
          </fieldset>
        </div>
      ) : null}
      </div> : null}
    </section>
    </>
  )
}
