import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type {
  GameModeProfile,
  ModeConfigStore,
  ModeConfigVerification,
  ModeEditorSession,
  ModeEditorSelection,
  ModeEditorSelectionItem,
  ModeMapProp,
  ModeMapOverride,
  ModeObjectivePoint,
  ModeSpawnPoint,
  ModeZone,
  ModeZoneKind,
  ModeZoneRole,
} from '../types'
import { genUid } from '../utils/geo'
import { DEPLOY_VEHICLE_CATALOG, type DeployVehicleEntry } from '../config/deployVehicles'
import { POINT_ICON_BASE } from '../config/points'

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
  onSelectProfile: (id: string) => void
  onCreateProfile: (name: string) => void
  onDeleteProfile: (id: string) => void
  onUpdateProfile: (id: string, patch: Partial<Pick<GameModeProfile, 'name' | 'description'>>) => void
  onMapConfigChange: (config: ModeMapOverride) => void
  onExport: () => void
  onExportOfficial: () => void
  onSyncOfficial: () => void
  syncStatus: string
  onImport: (store: ModeConfigStore) => void
  onSyncAttackDefense: () => void
  collapsed: boolean
  onToggleCollapsed: () => void
  onClose: () => void
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
  onSelectProfile,
  onCreateProfile,
  onDeleteProfile,
  onUpdateProfile,
  onMapConfigChange,
  onExport,
  onExportOfficial,
  onSyncOfficial,
  syncStatus,
  onImport,
  onSyncAttackDefense,
  collapsed,
  onToggleCollapsed,
  onClose,
}: ModeConfigEditorProps) {
  const importRef = useRef<HTMLInputElement>(null)
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
  const stageZones = mapConfig.zones.filter((zone) => zone.stageId === session.stageId)
  const stageSpawns = mapConfig.spawns.filter((spawn) => spawn.stageId === session.stageId)
  const stageObjectives = mapConfig.objectives.filter((point) => point.stageId === session.stageId)
  const stageProps = mapConfig.props.filter((prop) => prop.stageId === '*' || prop.stageId === session.stageId)
  const listSelectionOrder: ModeEditorSelectionItem[] = [
    ...stageZones.map((item) => ({ kind: 'zone' as const, uid: item.uid })),
    ...stageObjectives.map((item) => ({ kind: 'objective' as const, uid: item.uid })),
    ...stageSpawns.map((item) => ({ kind: 'spawn' as const, uid: item.uid })),
    ...stageProps.map((item) => ({ kind: 'prop' as const, uid: item.uid })),
  ]
  const selectedItemKeys = new Set((session.selectedItems.length > 0 ? session.selectedItems : session.selected ? [session.selected] : []).map((item) => `${item.kind}:${item.uid}`))
  const selectListItem = (event: ReactMouseEvent<HTMLButtonElement>, selection: ModeEditorSelectionItem) => {
    onSelectItem(selection, {
      additive: event.ctrlKey || event.metaKey,
      range: event.shiftKey,
      order: listSelectionOrder,
    })
  }
  const currentStageLabel = mapConfig.stages.find((stage) => stage.id === session.stageId)?.label ?? ''
  const [stageLabelDraft, setStageLabelDraft] = useState(currentStageLabel)

  // 阶段名称先在输入框内本地编辑，失焦时再提交到整份地图配置。
  // 避免每个输入字符都重建历史、保存并重绘整张地图，尤其可防止中文输入法组合文本抖动。
  useEffect(() => {
    setStageLabelDraft(currentStageLabel)
  }, [currentStageLabel, mapId, profile.id, session.stageId])

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

  const finishZone = () => {
    if (session.zoneDraft.length < 3) return
    const roleMeta = ZONE_ROLE_OPTIONS.find((item) => item.value === session.zoneRole) ?? ZONE_ROLE_OPTIONS[4]
    const zone: ModeZone = {
      uid: genUid('mode_zone'),
      stageId: session.stageId,
      name: `区域 ${stageZones.length + 1}`,
      kind: roleMeta.kind,
      role: roleMeta.value,
      color: roleMeta.color,
      points: session.zoneDraft,
      verification: 'draft',
    }
    onMapConfigChange({ ...mapConfig, zones: [...mapConfig.zones, zone], updatedAt: Date.now() })
    onSessionChange({ tool: 'select', selected: { kind: 'zone', uid: zone.uid }, selectedItems: [{ kind: 'zone', uid: zone.uid }], zoneDraft: [] })
  }

  const deleteSelection = () => {
    const selections = session.selectedItems.length > 0
      ? session.selectedItems
      : session.selected ? [session.selected] : []
    if (selections.length === 0) return

    const zoneIds = new Set(selections
      .filter((item) => item.kind === 'zone' && mapConfig.zones.some((zone) => zone.uid === item.uid && zone.verification === 'draft'))
      .map((item) => item.uid))
    const spawnIds = new Set(selections
      .filter((item) => item.kind === 'spawn' && mapConfig.spawns.some((spawn) => spawn.uid === item.uid && spawn.verification === 'draft'))
      .map((item) => item.uid))
    const objectiveIds = new Set(selections
      .filter((item) => item.kind === 'objective' && mapConfig.objectives.some((point) => point.uid === item.uid && point.verification === 'draft'))
      .map((item) => item.uid))
    const propIds = new Set(selections
      .filter((item) => item.kind === 'prop' && mapConfig.props.some((prop) => prop.uid === item.uid && prop.verification === 'draft'))
      .map((item) => item.uid))

    // Deleting an objective keeps the existing editor behavior: its draft capture zone is removed too.
    for (const point of mapConfig.objectives) {
      if (!objectiveIds.has(point.uid) || !point.captureZoneUid) continue
      const captureZone = mapConfig.zones.find((zone) => zone.uid === point.captureZoneUid)
      if (captureZone?.verification === 'draft') zoneIds.add(captureZone.uid)
    }
    const deletedCount = zoneIds.size + spawnIds.size + objectiveIds.size + propIds.size
    if (deletedCount === 0) return

    onMapConfigChange({
      ...mapConfig,
      zones: mapConfig.zones.filter((zone) => !zoneIds.has(zone.uid)),
      spawns: mapConfig.spawns.filter((spawn) => !spawnIds.has(spawn.uid)),
      objectives: mapConfig.objectives
        .filter((point) => !objectiveIds.has(point.uid))
        .map((point) => zoneIds.has(point.captureZoneUid) ? { ...point, captureZoneUid: '' } : point),
      props: mapConfig.props.filter((prop) => !propIds.has(prop.uid)),
      updatedAt: Date.now(),
    })
    onSessionChange({ selected: null, selectedItems: [] })
  }

  useEffect(() => {
    const onBackspace = (event: KeyboardEvent) => {
      if (event.key !== 'Backspace') return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (!session.selected && session.selectedItems.length === 0) return
      event.preventDefault()
      deleteSelection()
    }
    window.addEventListener('keydown', onBackspace)
    return () => window.removeEventListener('keydown', onBackspace)
  })

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

  const addStage = () => {
    const maxNumber = mapConfig.stages.reduce((max, stage) => {
      const match = /^S(\d+)$/i.exec(stage.id)
      return match ? Math.max(max, Number(match[1])) : max
    }, 0)
    const id = `S${maxNumber + 1}`
    const label = window.prompt('新阶段名称', `第${maxNumber + 1}阶段`)?.trim()
    if (!label) return
    onMapConfigChange({ ...mapConfig, stages: [...mapConfig.stages, { id, label }], updatedAt: Date.now() })
    onSessionChange({ stageId: id, tool: 'select', selected: null, selectedItems: [], zoneDraft: [] })
  }

  const deleteCurrentStage = () => {
    if (mapConfig.stages.length <= 1) return
    const stage = mapConfig.stages.find((item) => item.id === session.stageId)
    if (!stage || !window.confirm(`删除“${stage.id} · ${stage.label}”及其全部区域、据点、复活点和阶段道具？`)) return
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
  }

  return (
    <section className={`mode-config-editor${collapsed ? ' collapsed' : ''}`} aria-label="模式配置编辑器" onMouseDown={(event) => event.stopPropagation()}>
      <header className="mode-config-editor-head">
        <div>
          <strong>模式配置编辑器</strong>
          <span>{mapName} · 差异覆盖层</span>
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
          <button className="mode-config-editor-close" onClick={onClose} title="关闭编辑器" aria-label="关闭模式配置编辑器">×</button>
        </div>
      </header>

      <div className="mode-config-profile-row">
        <select value={profile.id} onChange={(event) => onSelectProfile(event.target.value)}>
          {profiles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <button
          onClick={() => {
            const name = window.prompt('新模式名称', '新模式')?.trim()
            if (name) onCreateProfile(name)
          }}
          title="新建模式"
        >＋</button>
        <button
          className="danger"
          disabled={profiles.length <= 1}
          onClick={() => {
            if (window.confirm(`删除模式“${profile.name}”及其全部地图配置？`)) onDeleteProfile(profile.id)
          }}
          title="删除当前模式"
        >−</button>
      </div>

      <label className="mode-config-field">
        <span>模式名称</span>
        <CommitTextInput value={profile.name} onCommit={(name) => onUpdateProfile(profile.id, { name })} />
      </label>
      <label className="mode-config-field">
        <span>模式说明</span>
        <CommitTextarea
          value={profile.description}
          placeholder="记录规则、数据来源或待核对内容"
          onCommit={(description) => onUpdateProfile(profile.id, { description })}
        />
      </label>

      <div className="mode-config-tools">
        <button
          className={session.tool === 'select' ? 'active' : ''}
          onClick={() => onSessionChange({ tool: 'select', zoneDraft: [] })}
        ><i className="fa-solid fa-mouse-pointer" />选择</button>
        <button
          className={session.tool === 'zone' ? 'active' : ''}
          onClick={() => onSessionChange({ tool: 'zone', selected: null, selectedItems: [], zoneDraft: [] })}
        ><i className="fa-solid fa-draw-polygon" />绘制区域</button>
        <button
          className={session.tool === 'prop' ? 'active' : ''}
          onClick={() => onSessionChange({ tool: 'prop', selected: null, selectedItems: [], zoneDraft: [] })}
        ><i className="fa-solid fa-toolbox" />地图道具</button>
      </div>

      {session.tool === 'zone' ? (
        <label className="mode-config-field mode-config-zone-role">
          <span>区域用途</span>
          <select
            value={session.zoneRole}
            onChange={(event) => onSessionChange({ zoneRole: event.target.value as ModeZoneRole, zoneDraft: [] })}
          >
            {ZONE_ROLE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
      ) : null}

      <div className="mode-config-stage-row">
        <label>
          <span>配置阶段</span>
          <select
            value={session.stageId}
            onChange={(event) => onSessionChange({ stageId: event.target.value, selected: null, selectedItems: [], zoneDraft: [] })}
          >
            {stageOptions.map((stage) => <option key={stage.id} value={stage.id}>{stage.id} · {stage.label}</option>)}
          </select>
        </label>
        <button
          onClick={() => {
            if (window.confirm(`重新从攻防模式同步“${mapName}”的全部阶段？当前地图的模式配置将被覆盖。`)) onSyncAttackDefense()
          }}
        ><i className="fa-solid fa-rotate" />重置为攻防底稿</button>
      </div>
      <div className="mode-config-stage-manage">
        <label>
          <span>阶段名称</span>
          <input
            value={stageLabelDraft}
            onChange={(event) => setStageLabelDraft(event.target.value)}
            onBlur={commitStageLabel}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.currentTarget.blur()
            }}
          />
        </label>
        <button onClick={addStage} title="新增阶段"><i className="fa-solid fa-plus" />新增阶段</button>
        <button className="danger" disabled={mapConfig.stages.length <= 1} onClick={deleteCurrentStage} title="删除当前阶段"><i className="fa-solid fa-trash" /></button>
      </div>

      {session.tool === 'zone' ? (
        <div className="mode-config-draft-bar">
          <span>已标记 {session.zoneDraft.length} 个顶点</span>
          <button disabled={session.zoneDraft.length < 3} onClick={finishZone}>完成区域</button>
          <button onClick={() => onSessionChange({ zoneDraft: [] })}>重画</button>
        </div>
      ) : null}

      <div className="mode-config-summary">
        <span><b>{stageZones.length}</b> 个区域</span>
        <span><b>{stageSpawns.length}</b> 个复活点</span>
        <span><b>{stageObjectives.length}</b> 个据点</span>
        <span><b>{stageProps.length}</b> 个道具</span>
      </div>

      <div className="mode-config-list">
        <div className="mode-config-list-title">当前地图对象</div>
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
        {stageZones.length === 0 && stageSpawns.length === 0 && stageObjectives.length === 0 && stageProps.length === 0 ? (
          <p>选择上方放置工具，然后直接点击地图录入对象。</p>
        ) : null}
      </div>

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
            <button className="mode-config-delete" onClick={deleteSelection}>删除区域</button>
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
            <label className="mode-config-check"><input type="checkbox" checked={selectedSpawn.vehicleDeploy} onChange={(event) => replaceSpawn(selectedSpawn.uid, { vehicleDeploy: event.target.checked })} />允许部署载具</label>
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
                      <label className="check"><input type="checkbox" checked={vehicle.allowTeammate} onChange={(event) => replaceDeployVehicle(vehicle.name, { allowTeammate: event.target.checked })} />友方可用</label>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
            <div className="mode-config-coords">{selectedSpawn.lat.toFixed(3)}, {selectedSpawn.lng.toFixed(3)}</div>
            <button className="mode-config-delete" onClick={deleteSelection}>删除复活点</button>
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
            <button className="mode-config-delete" onClick={deleteSelection}>删除据点及占领区</button>
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
            <button className="mode-config-delete" onClick={deleteSelection}>删除地图道具</button>
          </fieldset>
        </div>
      ) : null}

      <label className="mode-config-field">
        <span>{mapName}备注</span>
        <CommitTextarea value={mapConfig.notes} onCommit={(notes) => onMapConfigChange({ ...mapConfig, notes, updatedAt: Date.now() })} />
      </label>

      <footer className="mode-config-editor-foot">
        <button className="mode-config-sync" onClick={onSyncOfficial}><i className="fa-solid fa-cloud-arrow-up" />同步到正式版</button>
        <button onClick={onExportOfficial}><i className="fa-solid fa-code" />导出正式数据</button>
        <button onClick={onExport}><i className="fa-solid fa-box-archive" />备份配置</button>
        <button onClick={() => importRef.current?.click()}><i className="fa-solid fa-file-import" />导入 JSON</button>
        <input
          ref={importRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.currentTarget.value = ''
            if (!file) return
            void file.text().then((text) => onImport(JSON.parse(text) as ModeConfigStore)).catch(() => window.alert('无法读取该配置文件。'))
          }}
        />
        <span>{syncStatus || mapId}</span>
        <small>自动保存仅限当前浏览器；发布到 GitHub 前请导出正式数据并写入项目配置。选中对象后按 Ctrl+V 可复制。</small>
      </footer>
    </section>
  )
}
