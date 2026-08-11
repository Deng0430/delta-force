import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type DragEvent } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import * as L from 'leaflet'
import type {
  GameModeProfile,
  ModeConfigStore,
  ModeEditorSelection,
  ModeEditorSelectionItem,
  ModeEditorSession,
  ModeMapProp,
  ModeMapOverride,
  ModeObjectivePoint,
  ModeSpawnPoint,
  ModeZone,
  ModeZoneRole,
  Side,
} from '../types'
import { MAPS, MAP_BY_ID } from '../config/maps'
import { STAGES_BY_MAP } from '../config/points'
import { genUid, mapBounds } from '../utils/geo'
import { downloadText } from '../utils/exportTactical'
import {
  MODE_CONFIG_STORAGE_KEY,
  createModeProfile,
  buildOfficialModeData,
  emptyModeMapOverride,
  loadModeConfigStore,
  normalizeModeConfigStore,
  publishModeConfigStore,
  saveModeConfigStore,
  syncModeMapFromAttackDefense,
} from '../utils/modeConfigStorage'
import ModeConfigEditor from './ModeConfigEditor'
import ModeConfigLayer from './ModeConfigLayer'
import ModeAssetPalette, { readModePaletteAsset } from './ModeAssetPalette'
import ShortcutHelp from './ShortcutHelp'
import { platform } from '../platform'
import { useDeviceType } from '../hooks/useDeviceType'

const MODE_HISTORY_LIMIT = 100

const selectionKey = (selection: ModeEditorSelectionItem) => `${selection.kind}:${selection.uid}`

interface ModeClipboard {
  items: ModeEditorSelectionItem[]
  source: ModeMapOverride
}

type StoreUpdate = ModeConfigStore | ((current: ModeConfigStore) => ModeConfigStore)

interface StoreHistory {
  past: ModeConfigStore[]
  present: ModeConfigStore
  future: ModeConfigStore[]
}

type StoreHistoryAction =
  | { type: 'commit'; update: StoreUpdate }
  | { type: 'replace'; store: ModeConfigStore }
  | { type: 'undo' }
  | { type: 'redo' }

function storeHistoryReducer(state: StoreHistory, action: StoreHistoryAction): StoreHistory {
  if (action.type === 'replace') return { past: [], present: action.store, future: [] }
  if (action.type === 'undo') {
    const previous = state.past.at(-1)
    if (!previous) return state
    return {
      past: state.past.slice(0, -1),
      present: previous,
      future: [state.present, ...state.future].slice(0, MODE_HISTORY_LIMIT),
    }
  }
  if (action.type === 'redo') {
    const next = state.future[0]
    if (!next) return state
    return {
      past: [...state.past, state.present].slice(-MODE_HISTORY_LIMIT),
      present: next,
      future: state.future.slice(1),
    }
  }
  const next = typeof action.update === 'function' ? action.update(state.present) : action.update
  if (Object.is(next, state.present)) return state
  return {
    past: [...state.past, state.present].slice(-MODE_HISTORY_LIMIT),
    present: next,
    future: [],
  }
}

function WorkbenchMapSync({ config, onReady }: { config: (typeof MAPS)[number]; onReady: (map: L.Map) => void }) {
  const map = useMap()
  useEffect(() => {
    onReady(map)
    map.setView(config.initCenter, config.initZoom, { animate: false })
    map.setMaxBounds(mapBounds(config))
  }, [config, map, onReady])
  return null
}

export default function ModeConfigWorkbench() {
  const device = useDeviceType()
  const mapRef = useRef<L.Map | null>(null)
  const handleMapReady = useCallback((map: L.Map) => { mapRef.current = map }, [])
  const initialStore = useMemo(loadModeConfigStore, [])
  const [storeHistory, dispatchStoreHistory] = useReducer(storeHistoryReducer, {
    past: [],
    present: initialStore,
    future: [],
  })
  const store = storeHistory.present
  const setStore = useCallback((update: StoreUpdate) => {
    dispatchStoreHistory({ type: 'commit', update })
  }, [])
  const [mapId, setMapId] = useState(MAPS[0]?.id ?? 'ascent')
  const [view, setView] = useState<Side>('attack')
  const [syncStatus, setSyncStatus] = useState('')
  const [leftPaletteOpen, setLeftPaletteOpen] = useState(true)
  const [rightEditorOpen, setRightEditorOpen] = useState(true)
  const [fullscreen, setFullscreen] = useState(platform.isFullscreen())
  const [elementVisibility, setElementVisibility] = useState({ zones: true, spawns: true, objectives: true, props: true })
  const syncStatusTimerRef = useRef<number | null>(null)
  const initialStages = STAGES_BY_MAP[mapId] ?? []
  const [session, setSession] = useState<ModeEditorSession>(() => ({
    open: true,
    profileId: initialStore.profiles.find((profile) => profile.id === 'winner-takes-all')?.id
      ?? initialStore.profiles[0]?.id
      ?? null,
    stageId: initialStages[0]?.id ?? 'S1',
    tool: 'select',
    zoneRole: 'custom',
    selected: null,
    selectedItems: [],
    zoneDraft: [],
  }))
  const selectionAnchorRef = useRef<ModeEditorSelectionItem | null>(null)
  const modeClipboardRef = useRef<ModeClipboard | null>(null)

  const config = MAP_BY_ID[mapId] ?? MAPS[0]
  const attackStages = STAGES_BY_MAP[mapId] ?? []
  const profile = store.profiles.find((item) => item.id === session.profileId) ?? store.profiles[0]
  const mapConfig = profile?.maps[mapId] ?? emptyModeMapOverride(mapId)
  const firstModeStageId = mapConfig.stages[0]?.id ?? 'S1'

  useEffect(() => saveModeConfigStore(store), [store])

  useEffect(() => () => {
    if (syncStatusTimerRef.current != null) window.clearTimeout(syncStatusTimerRef.current)
  }, [])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== MODE_CONFIG_STORAGE_KEY || !event.newValue) return
      try {
        const normalized = normalizeModeConfigStore(JSON.parse(event.newValue))
        if (normalized) dispatchStoreHistory({ type: 'replace', store: normalized })
      } catch {
        // 忽略其他窗口尚未完成或损坏的写入，保留当前可用配置。
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    if (store.profiles.some((item) => item.id === session.profileId)) return
    setSession((current) => ({
      ...current,
      profileId: store.profiles[0]?.id ?? null,
      selected: null,
      selectedItems: [],
      zoneDraft: [],
    }))
  }, [session.profileId, store.profiles])

  const undo = useCallback(() => {
    dispatchStoreHistory({ type: 'undo' })
    setSession((current) => ({ ...current, selected: null, selectedItems: [], zoneDraft: [] }))
  }, [])

  const redo = useCallback(() => {
    dispatchStoreHistory({ type: 'redo' })
    setSession((current) => ({ ...current, selected: null, selectedItems: [], zoneDraft: [] }))
  }, [])

  const updateMapConfig = useCallback((update: ModeMapOverride | ((current: ModeMapOverride) => ModeMapOverride)) => {
    if (!session.profileId) return
    setStore((current) => ({
      ...current,
      profiles: current.profiles.map((item) => {
        if (item.id !== session.profileId) return item
        const previous = item.maps[mapId] ?? emptyModeMapOverride(mapId)
        const next = typeof update === 'function' ? update(previous) : update
        const now = Date.now()
        return {
          ...item,
          maps: { ...item.maps, [mapId]: { ...next, mapId, updatedAt: now } },
          updatedAt: now,
        }
      }),
    }))
  }, [mapId, session.profileId])

  const selectEditorItem = useCallback((
    selection: ModeEditorSelection,
    options?: { additive?: boolean; range?: boolean; order?: ModeEditorSelectionItem[] },
  ) => {
    setSession((current) => {
      if (!selection) {
        selectionAnchorRef.current = null
        return { ...current, selected: null, selectedItems: [] }
      }
      const previous = current.selectedItems.length > 0
        ? current.selectedItems
        : current.selected ? [current.selected] : []
      let selectedItems: ModeEditorSelectionItem[]
      if (options?.range && options.order?.length) {
        const anchor = selectionAnchorRef.current ?? current.selected ?? selection
        const start = options.order.findIndex((item) => selectionKey(item) === selectionKey(anchor))
        const end = options.order.findIndex((item) => selectionKey(item) === selectionKey(selection))
        selectedItems = start >= 0 && end >= 0
          ? options.order.slice(Math.min(start, end), Math.max(start, end) + 1)
          : [selection]
      } else if (options?.additive) {
        const key = selectionKey(selection)
        selectedItems = previous.some((item) => selectionKey(item) === key)
          ? previous.filter((item) => selectionKey(item) !== key)
          : [...previous, selection]
        selectionAnchorRef.current = selection
      } else {
        selectedItems = [selection]
        selectionAnchorRef.current = selection
      }
      return {
        ...current,
        tool: 'select',
        selected: selectedItems.some((item) => selectionKey(item) === selectionKey(selection))
          ? selection
          : selectedItems.at(-1) ?? null,
        selectedItems,
      }
    })
  }, [])

  const copySelection = useCallback(() => {
    const items = session.selectedItems.length > 0
      ? session.selectedItems
      : session.selected ? [session.selected] : []
    if (items.length === 0) return
    modeClipboardRef.current = {
      items: items.map((item) => ({ ...item })),
      source: structuredClone(mapConfig),
    }
  }, [mapConfig, session.selected, session.selectedItems])

  const pasteSelection = useCallback(() => {
    const clipboard = modeClipboardRef.current
    if (!clipboard?.items.length) return
    updateMapConfig((current) => {
      const zones = [...current.zones]
      const spawns = [...current.spawns]
      const objectives = [...current.objectives]
      const props = [...current.props]
      const created: ModeEditorSelectionItem[] = []

      for (const item of clipboard.items) {
        if (item.kind === 'zone') {
          const source = clipboard.source.zones.find((entry) => entry.uid === item.uid)
          if (!source) continue
          const uid = genUid('mode_zone')
          zones.push({
            ...source,
            uid,
            stageId: session.stageId,
            name: `${source.name}（副本）`,
            objectiveUid: undefined,
            points: source.points.map(([lat, lng]) => [lat, lng]),
            verification: 'draft',
          })
          created.push({ kind: 'zone', uid })
        } else if (item.kind === 'spawn') {
          const source = clipboard.source.spawns.find((entry) => entry.uid === item.uid)
          if (!source) continue
          const uid = genUid('mode_spawn')
          spawns.push({ ...source, uid, stageId: session.stageId, name: `${source.name}（副本）`, lat: source.lat, lng: source.lng, deployVehicles: source.deployVehicles.map((entry) => ({ ...entry })), verification: 'draft' })
          created.push({ kind: 'spawn', uid })
        } else if (item.kind === 'objective') {
          const source = clipboard.source.objectives.find((entry) => entry.uid === item.uid)
          if (!source) continue
          const uid = genUid('mode_objective')
          const sourceZone = clipboard.source.zones.find((entry) => entry.uid === source.captureZoneUid)
          const captureZoneUid = sourceZone ? genUid('mode_capture_zone') : ''
          objectives.push({ ...source, uid, stageId: session.stageId, name: `${source.name}（副本）`, captureZoneUid, lat: source.lat, lng: source.lng, verification: 'draft' })
          if (sourceZone) zones.push({ ...sourceZone, uid: captureZoneUid, stageId: session.stageId, name: `${sourceZone.name}（副本）`, objectiveUid: uid, points: sourceZone.points.map(([lat, lng]) => [lat, lng]), verification: 'draft' })
          created.push({ kind: 'objective', uid })
        } else {
          const source = clipboard.source.props.find((entry) => entry.uid === item.uid)
          if (!source) continue
          const uid = genUid('mode_prop')
          props.push({ ...source, uid, stageId: source.stageId === '*' ? '*' : session.stageId, lat: source.lat, lng: source.lng, verification: 'draft' })
          created.push({ kind: 'prop', uid })
        }
      }
      if (created.length === 0) return current
      setSession((value) => ({ ...value, tool: 'select', selected: created.at(-1) ?? null, selectedItems: created }))
      return { ...current, zones, spawns, objectives, props, updatedAt: Date.now() }
    })
  }, [session.stageId, updateMapConfig])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const key = event.key.toLowerCase()
      const target = event.target as HTMLElement | null
      const editingText = Boolean(target?.closest('input, textarea, select, [contenteditable="true"]'))
      if (key === 'z' && event.shiftKey) {
        event.preventDefault()
        redo()
      } else if (key === 'z') {
        event.preventDefault()
        undo()
      } else if (key === 'y') {
        event.preventDefault()
        redo()
      } else if (key === 'c' && !editingText) {
        event.preventDefault()
        copySelection()
      } else if (key === 'v' && !editingText) {
        event.preventDefault()
        pasteSelection()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [copySelection, pasteSelection, redo, undo])

  useEffect(() => {
    const onFullscreenChange = () => {
      setFullscreen(platform.isFullscreen())
      window.setTimeout(() => mapRef.current?.invalidateSize(), 0)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  const toggleFullscreen = useCallback(async () => {
    await platform.toggleFullscreen()
  }, [])

  useEffect(() => {
    setSession((current) => ({
      ...current,
      stageId: firstModeStageId,
      tool: 'select',
      selected: null,
      selectedItems: [],
      zoneDraft: [],
    }))
  }, [firstModeStageId, mapId, session.profileId])

  const updateSession = useCallback((patch: Partial<ModeEditorSession>) => {
    setSession((current) => ({ ...current, ...patch }))
  }, [])

  const addSpawn = useCallback((point: [number, number], side: Side = view) => {
    const uid = genUid('mode_spawn')
    const count = mapConfig.spawns.filter((spawn) => spawn.stageId === session.stageId).length
    const spawn: ModeSpawnPoint = {
      uid,
      stageId: session.stageId,
      name: `复活点 ${count + 1}`,
      side,
      lat: point[0],
      lng: point[1],
      vehicleDeploy: false,
      vehicleCategories: [],
      deployVehicles: [],
      verification: 'draft',
    }
    updateMapConfig((current) => ({ ...current, spawns: [...current.spawns, spawn] }))
    setSession((current) => ({ ...current, selected: { kind: 'spawn', uid }, selectedItems: [{ kind: 'spawn', uid }] }))
  }, [mapConfig.spawns, session.stageId, updateMapConfig, view])

  const addObjective = useCallback((point: [number, number], icon = 'q_jd_a') => {
    const uid = genUid('mode_objective')
    const captureZoneUid = genUid('mode_capture_zone')
    const count = mapConfig.objectives.filter((item) => item.stageId === session.stageId).length
    const objective: ModeObjectivePoint = {
      uid,
      stageId: session.stageId,
      name: `据点${String.fromCharCode(65 + Math.min(count, 25))}`,
      note: '',
      icon: count === 0 ? icon : `q_jd_${String.fromCharCode(97 + Math.min(count, 4))}`,
      captureZoneUid,
      lat: point[0],
      lng: point[1],
      verification: 'draft',
    }
    const radius = 3.2
    const captureZone: ModeZone = {
      uid: captureZoneUid,
      stageId: session.stageId,
      name: `${objective.name}占领区`,
      kind: 'neutral',
      role: 'capture',
      objectiveUid: uid,
      color: '#f4cf67',
      points: [
        [point[0] - radius, point[1] - radius],
        [point[0] - radius, point[1] + radius],
        [point[0] + radius, point[1] + radius],
        [point[0] + radius, point[1] - radius],
      ],
      verification: 'draft',
    }
    updateMapConfig((current) => ({ ...current, objectives: [...current.objectives, objective], zones: [...current.zones, captureZone] }))
    setSession((current) => ({ ...current, selected: { kind: 'objective', uid }, selectedItems: [{ kind: 'objective', uid }] }))
  }, [mapConfig.objectives, session.stageId, updateMapConfig])

  const addProp = useCallback((point: [number, number]) => {
    const uid = genUid('mode_prop')
    const prop: ModeMapProp = {
      uid,
      stageId: session.stageId,
      name: '固定弹药箱',
      icon: 'q_gddyx',
      lat: point[0],
      lng: point[1],
      verification: 'draft',
    }
    updateMapConfig((current) => ({ ...current, props: [...current.props, prop] }))
    setSession((current) => ({ ...current, selected: { kind: 'prop', uid }, selectedItems: [{ kind: 'prop', uid }] }))
  }, [session.stageId, updateMapConfig])

  const addPresetZone = useCallback((point: [number, number], role: ModeZoneRole) => {
    const meta = {
      'attack-base': { label: '进攻方活动区', kind: 'own' as const, color: '#01ff84' },
      'defense-base': { label: '防守方活动区', kind: 'enemy' as const, color: '#e0453a' },
      capture: { label: '据点占领区', kind: 'neutral' as const, color: '#f4cf67' },
      frontline: { label: '阶段防线', kind: 'neutral' as const, color: '#f4cf67' },
      custom: { label: '自定义区域', kind: 'neutral' as const, color: '#9a9b9b' },
    }[role]
    const uid = genUid('mode_zone')
    const rx = 5
    const ry = 3.5
    const zone: ModeZone = {
      uid,
      stageId: session.stageId,
      name: `${session.stageId} · ${meta.label}`,
      kind: meta.kind,
      role,
      color: meta.color,
      points: [[point[0] - ry, point[1] - rx], [point[0] - ry, point[1] + rx], [point[0] + ry, point[1] + rx], [point[0] + ry, point[1] - rx]],
      verification: 'draft',
    }
    updateMapConfig((current) => ({ ...current, zones: [...current.zones, zone] }))
    setSession((current) => ({ ...current, tool: 'select', selected: { kind: 'zone', uid }, selectedItems: [{ kind: 'zone', uid }] }))
  }, [session.stageId, updateMapConfig])

  const moveSpawn = useCallback((uid: string, point: [number, number]) => {
    updateMapConfig((current) => ({
      ...current,
      spawns: current.spawns.map((spawn) => spawn.uid === uid && spawn.verification === 'draft' ? { ...spawn, lat: point[0], lng: point[1] } : spawn),
    }))
  }, [updateMapConfig])

  const moveObjective = useCallback((uid: string, point: [number, number]) => {
    updateMapConfig((current) => ({
      ...current,
      objectives: current.objectives.map((item) => item.uid === uid && item.verification === 'draft' ? { ...item, lat: point[0], lng: point[1] } : item),
      zones: current.zones.map((zone) => {
        const objective = current.objectives.find((item) => item.uid === uid)
        if (!objective || objective.verification !== 'draft' || zone.uid !== objective.captureZoneUid || zone.verification !== 'draft') return zone
        const deltaLat = point[0] - objective.lat
        const deltaLng = point[1] - objective.lng
        return { ...zone, points: zone.points.map(([lat, lng]) => [lat + deltaLat, lng + deltaLng] as [number, number]) }
      }),
    }))
  }, [updateMapConfig])

  const moveProp = useCallback((uid: string, point: [number, number]) => {
    updateMapConfig((current) => ({
      ...current,
      props: current.props.map((item) => item.uid === uid && item.verification === 'draft' ? { ...item, lat: point[0], lng: point[1] } : item),
    }))
  }, [updateMapConfig])

  const moveZone = useCallback((uid: string, points: [number, number][]) => {
    updateMapConfig((current) => ({
      ...current,
      zones: current.zones.map((zone) => zone.uid === uid && zone.verification === 'draft'
        ? { ...zone, points }
        : zone),
    }))
  }, [updateMapConfig])

  const moveZoneVertex = useCallback((uid: string, index: number, point: [number, number]) => {
    updateMapConfig((current) => ({
      ...current,
      zones: current.zones.map((zone) => zone.uid === uid && zone.verification === 'draft'
        ? { ...zone, points: zone.points.map((vertex, vertexIndex) => vertexIndex === index ? point : vertex) }
        : zone),
    }))
  }, [updateMapConfig])

  const insertZoneVertex = useCallback((uid: string, index: number, point: [number, number]) => {
    updateMapConfig((current) => ({
      ...current,
      zones: current.zones.map((zone) => zone.uid === uid && zone.verification === 'draft'
        ? { ...zone, points: [...zone.points.slice(0, index), point, ...zone.points.slice(index)] }
        : zone),
    }))
  }, [updateMapConfig])

  const removeZoneVertex = useCallback((uid: string, index: number) => {
    updateMapConfig((current) => ({
      ...current,
      zones: current.zones.map((zone) => zone.uid === uid && zone.verification === 'draft' && zone.points.length > 3
        ? { ...zone, points: zone.points.filter((_, vertexIndex) => vertexIndex !== index) }
        : zone),
    }))
  }, [updateMapConfig])

  const handlePaletteDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if ((event.target as HTMLElement).closest('.mode-config-editor, .mode-asset-palette')) return
    const asset = readModePaletteAsset(event.dataTransfer)
    const map = mapRef.current
    if (!asset || !map) return
    const rect = map.getContainer().getBoundingClientRect()
    const latlng = map.containerPointToLatLng(L.point(event.clientX - rect.left, event.clientY - rect.top))
    const point: [number, number] = [latlng.lat, latlng.lng]
    if (asset.kind === 'spawn') addSpawn(point, asset.side)
    else if (asset.kind === 'objective') addObjective(point, asset.icon)
    else if (asset.kind === 'prop') {
      const uid = genUid('mode_prop')
      const prop: ModeMapProp = { uid, stageId: session.stageId, name: asset.name, icon: asset.icon, lat: point[0], lng: point[1], verification: 'draft' }
      updateMapConfig((current) => ({ ...current, props: [...current.props, prop] }))
      setSession((current) => ({ ...current, tool: 'select', selected: { kind: 'prop', uid }, selectedItems: [{ kind: 'prop', uid }] }))
    } else addPresetZone(point, asset.role)
  }, [addObjective, addPresetZone, addSpawn, session.stageId, updateMapConfig])

  const syncToOfficial = useCallback(() => {
    const nextStore = { ...store, activeModeId: profile.id }
    setStore(nextStore)
    publishModeConfigStore(nextStore)
    const officialWindow = platform.focusParentOrOpen('/', { target: 'deltaforce-map-tools-official' })
    officialWindow?.focus()
    setSyncStatus(`已同步并刷新正式版 · ${config.name} ${mapConfig.stages.length} 个阶段`)
    if (syncStatusTimerRef.current != null) window.clearTimeout(syncStatusTimerRef.current)
    syncStatusTimerRef.current = window.setTimeout(() => setSyncStatus(''), 3500)
  }, [config.name, mapConfig.stages.length, profile.id, setStore, store])

  if (!config || !profile) return null

  return (
    <main className={`mode-workbench platform-${device.platform} ${device.mobileLayout ? 'mobile-layout' : 'desktop-layout'}${leftPaletteOpen ? '' : ' left-palette-collapsed'}`}>
      <header className="mode-workbench-toolbar">
        <img src="/nav_title.png" alt="三角洲行动" draggable={false} />
        <div className="mode-workbench-title"><strong>模式配置器</strong><span>独立数据工作台</span></div>
        <label><span>地图</span><select value={mapId} onChange={(event) => setMapId(event.target.value)}>{MAPS.map((map) => <option key={map.id} value={map.id}>{map.name}</option>)}</select></label>
        <div className="mode-workbench-side">
          <button className={view === 'attack' ? 'active' : ''} onClick={() => setView('attack')}>进攻方</button>
          <button className={view === 'defense' ? 'active' : ''} onClick={() => setView('defense')}>防守方</button>
        </div>
        <div className="mode-workbench-history" aria-label="编辑历史">
          <button disabled={storeHistory.past.length === 0} onClick={undo} title="撤回（Ctrl+Z）" aria-label="撤回">
            <i className="fa-solid fa-rotate-left" />撤回
          </button>
          <button disabled={storeHistory.future.length === 0} onClick={redo} title="恢复（Ctrl+Y / Ctrl+Shift+Z）" aria-label="恢复">
            <i className="fa-solid fa-rotate-right" />恢复
          </button>
        </div>
        <details className="mode-workbench-layers">
          <summary><i className="fa-solid fa-layer-group" />元素显示</summary>
          <div>
            {([
              ['zones', '区域'],
              ['spawns', '复活点'],
              ['objectives', '据点'],
              ['props', '地图道具'],
            ] as const).map(([key, label]) => (
              <button
                type="button"
                key={key}
                className={elementVisibility[key] ? 'active' : ''}
                onClick={() => setElementVisibility((current) => ({ ...current, [key]: !current[key] }))}
              >
                <i className={`fa-solid ${elementVisibility[key] ? 'fa-eye' : 'fa-eye-slash'}`} />{label}
              </button>
            ))}
          </div>
        </details>
        <button className="mode-workbench-fullscreen" onClick={() => void toggleFullscreen()} title={fullscreen ? '退出全屏（Esc）' : '进入全屏'}>
          <i className={`fa-solid ${fullscreen ? 'fa-compress' : 'fa-expand'}`} />{fullscreen ? '退出全屏' : '全屏'}
        </button>
        <ShortcutHelp />
        <button className="mode-workbench-close" onClick={() => platform.closeCurrentView()}><i className="fa-solid fa-arrow-up-right-from-square" />关闭工具</button>
      </header>

      <div
        className="mode-workbench-map-wrap"
        onDragOver={(event) => event.preventDefault()}
        onDrop={handlePaletteDrop}
        onContextMenuCapture={(event) => {
          if ((event.target as HTMLElement).closest('.mode-config-vertex-wrap')) event.preventDefault()
        }}
      >
        <ModeAssetPalette
          collapsed={!leftPaletteOpen}
          onToggleCollapsed={() => setLeftPaletteOpen((open) => !open)}
        />
        <MapContainer
          key={config.id}
          crs={L.CRS.Simple}
          bounds={mapBounds(config)}
          minZoom={config.minZoom}
          maxZoom={config.maxZoom}
          zoomControl
          attributionControl={false}
          className={`tactical-map mode-config-editing mode-config-tool-${session.tool}`}
          style={{ width: '100%', height: '100%' }}
        >
          <TileLayer
            url={config.tileUrl}
            bounds={mapBounds(config)}
            minZoom={config.minZoom}
            maxZoom={config.maxZoom}
            maxNativeZoom={config.maxNativeZoom}
            tileSize={256}
          />
          <WorkbenchMapSync config={config} onReady={handleMapReady} />
          <ModeConfigLayer
            config={mapConfig}
            stageId={session.stageId}
            view={view}
            editing
            zonesVisible={elementVisibility.zones}
            spawnsVisible={elementVisibility.spawns}
            objectivesVisible={elementVisibility.objectives}
            propsVisible={elementVisibility.props}
            tool={session.tool}
            selected={session.selected}
            selectedItems={session.selectedItems}
            zoneDraft={session.zoneDraft}
            onSelect={(selected, options) => selectEditorItem(selected, options)}
            onZoneDraftChange={(zoneDraft) => updateSession({ zoneDraft })}
            onAddSpawn={addSpawn}
            onAddObjective={addObjective}
            onAddProp={addProp}
            onMoveSpawn={moveSpawn}
            onMoveObjective={moveObjective}
            onMoveProp={moveProp}
            onMoveZone={moveZone}
            onMoveZoneVertex={moveZoneVertex}
            onInsertZoneVertex={insertZoneVertex}
            onRemoveZoneVertex={removeZoneVertex}
          />
        </MapContainer>

        <ModeConfigEditor
          mapId={mapId}
          mapName={config.name}
          stageOptions={mapConfig.stages}
          profiles={store.profiles}
          profile={profile}
          mapConfig={mapConfig}
          session={session}
          onSelectItem={selectEditorItem}
          onSessionChange={updateSession}
          onSelectProfile={(id) => setSession((current) => ({ ...current, profileId: id, selected: null, selectedItems: [], zoneDraft: [] }))}
          onCreateProfile={(name) => {
            const created = createModeProfile(name)
            setStore((current) => ({ ...current, profiles: [...current.profiles, created] }))
            setSession((current) => ({ ...current, profileId: created.id, selected: null, selectedItems: [], zoneDraft: [] }))
          }}
          onDeleteProfile={(id) => {
            if (store.profiles.length <= 1) return
            const profiles = store.profiles.filter((item) => item.id !== id)
            setStore({ ...store, profiles, activeModeId: store.activeModeId === id ? 'attack-defense' : store.activeModeId })
            setSession((current) => ({ ...current, profileId: profiles[0]?.id ?? null, selected: null, selectedItems: [], zoneDraft: [] }))
          }}
          onUpdateProfile={(id, patch: Partial<Pick<GameModeProfile, 'name' | 'description'>>) => setStore((current) => ({
            ...current,
            profiles: current.profiles.map((item) => item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item),
          }))}
          onMapConfigChange={updateMapConfig}
          onSyncAttackDefense={() => updateMapConfig(syncModeMapFromAttackDefense(mapId, attackStages))}
          onExport={() => downloadText(`deltaforce-mode-configs-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(store, null, 2))}
          onExportOfficial={() => downloadText(`deltaforce-${profile.id}-official-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(buildOfficialModeData(profile), null, 2))}
          onSyncOfficial={syncToOfficial}
          syncStatus={syncStatus}
          onImport={(value) => {
            const normalized = normalizeModeConfigStore(value)
            if (!normalized) return window.alert('配置文件格式无效。')
            setStore(normalized)
            setSession((current) => ({ ...current, profileId: normalized.profiles[0]?.id ?? null, selected: null, selectedItems: [], zoneDraft: [] }))
          }}
          collapsed={!rightEditorOpen}
          onToggleCollapsed={() => setRightEditorOpen((open) => !open)}
          onClose={() => platform.closeCurrentView()}
        />
      </div>
    </main>
  )
}
