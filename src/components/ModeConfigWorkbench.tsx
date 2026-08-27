import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
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
  ModeVehicleRefreshPoint,
  ModeZone,
  ModeZoneRole,
  Side,
} from '../types'
import { MAPS, MAP_BY_ID } from '../config/maps'
import { deployForPlatform, propsForPlatform, stagesForPlatform, type GameDataPlatform } from '../config/gameDataPlatform'
import { genUid, mapBounds } from '../utils/geo'
import { downloadText } from '../utils/exportTactical'
import {
  MODE_CONFIG_STORAGE_KEY,
  createModeProfile,
  buildOfficialModeData,
  emptyModeMapOverride,
  importModeConfigData,
  loadModeConfigStore,
  normalizeModeConfigStore,
  modeMapsForPlatform,
  modeUsesPlatformMaps,
  publishModeConfigStore,
  saveModeConfigStore,
  syncModeMapFromAttackDefense,
} from '../utils/modeConfigStorage'
import ModeConfigEditor from './ModeConfigEditor'
import ModeConfigLayer from './ModeConfigLayer'
import ModeAssetPalette, { readModePaletteAsset, type ModePaletteAsset } from './ModeAssetPalette'
import ShortcutHelp from './ShortcutHelp'
import { platform } from '../platform'
import { useDeviceType } from '../hooks/useDeviceType'
import { parseVehicleRefreshTable, vehicleRefreshRuleSignature } from '../utils/vehicleRefreshRules'
import ToolbarSelect from './ToolbarSelect'

const MODE_HISTORY_LIMIT = 100
const MODE_PANEL_WIDTHS_STORAGE_KEY = 'deltaforce-mode-editor-panel-widths'
const MODE_PALETTE_MIN_WIDTH = 250
const MODE_PALETTE_DEFAULT_WIDTH = 300
const MODE_PALETTE_MAX_WIDTH = 440
const MODE_EDITOR_MIN_WIDTH = 300
const MODE_EDITOR_DEFAULT_WIDTH = 380
const MODE_EDITOR_MAX_WIDTH = 560
const MODE_MAP_MIN_WIDTH = 240
type WorkbenchMenu = 'editor-map' | 'editor-mode' | 'editor-data-platform' | 'editor-stage'

type ModePanelSide = 'left' | 'right'
interface ModePanelWidths { left: number; right: number }
type ModeMobileDialog =
  | { kind: 'confirm'; title: string; message: string; confirmLabel: string; onConfirm: () => void }
  | { kind: 'prompt'; title: string; value: string; onSubmit: (value: string) => void }
  | { kind: 'alert'; title: string; message: string }
interface ModePanelResizeSession {
  side: ModePanelSide
  pointerId: number
  startX: number
  startWidth: number
  lastWidth: number
  workbench: HTMLElement
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max))

function loadModePanelWidths(): ModePanelWidths {
  let stored: Partial<ModePanelWidths> = {}
  try { stored = JSON.parse(window.localStorage.getItem(MODE_PANEL_WIDTHS_STORAGE_KEY) ?? '{}') } catch { /* use defaults */ }
  const left = clamp(Number(stored.left) || MODE_PALETTE_DEFAULT_WIDTH, MODE_PALETTE_MIN_WIDTH, Math.min(MODE_PALETTE_MAX_WIDTH, window.innerWidth - MODE_EDITOR_MIN_WIDTH - MODE_MAP_MIN_WIDTH))
  const right = clamp(Number(stored.right) || MODE_EDITOR_DEFAULT_WIDTH, MODE_EDITOR_MIN_WIDTH, Math.min(MODE_EDITOR_MAX_WIDTH, window.innerWidth - left - MODE_MAP_MIN_WIDTH))
  return { left, right }
}

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
  const latestStoreRef = useRef(store)
  latestStoreRef.current = store
  const setStore = useCallback((update: StoreUpdate) => {
    dispatchStoreHistory({ type: 'commit', update })
  }, [])
  const [mapId, setMapId] = useState(MAPS[0]?.id ?? 'ascent')
  const [editorDataPlatform, setEditorDataPlatform] = useState<GameDataPlatform>(() => window.localStorage.getItem('deltaforce-mode-editor-game-data-platform') === 'mobile' ? 'mobile' : 'pc')
  const [view, setView] = useState<Side>('attack')
  const [openContextMenu, setOpenContextMenu] = useState<WorkbenchMenu | null>(null)
  const [syncStatus, setSyncStatus] = useState('')
  const [leftPaletteOpen, setLeftPaletteOpen] = useState(() => platform.kind !== 'android')
  const [rightEditorOpen, setRightEditorOpen] = useState(() => platform.kind !== 'android')
  const [panelWidths, setPanelWidths] = useState<ModePanelWidths>(loadModePanelWidths)
  const panelResizeRef = useRef<ModePanelResizeSession | null>(null)
  const [fullscreen, setFullscreen] = useState(platform.isFullscreen())
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false)
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false)
  const [mobileMultiSelect, setMobileMultiSelect] = useState(false)
  const [mobileClipboardReady, setMobileClipboardReady] = useState(false)
  const [mobileDialog, setMobileDialog] = useState<ModeMobileDialog | null>(null)
  const [elementVisibility, setElementVisibility] = useState({ zones: true, spawns: true, objectives: true, props: true, vehicleRefresh: true })
  const [selectedVehicleRefreshRuleIds, setSelectedVehicleRefreshRuleIds] = useState<string[]>([])
  const [activePaletteAsset, setActivePaletteAsset] = useState<ModePaletteAsset | null>(null)
  const syncStatusTimerRef = useRef<number | null>(null)
  const importConfigRef = useRef<HTMLInputElement>(null)
  const initialStages = stagesForPlatform(editorDataPlatform)[mapId] ?? []
  const [session, setSession] = useState<ModeEditorSession>(() => ({
    open: true,
    profileId: initialStore.profiles.find((profile) => profile.id === 'attack-defense')?.id
      ?? initialStore.profiles[0]?.id
      ?? null,
    stageId: initialStages[0]?.id ?? 'S1',
    tool: 'select',
    zoneRole: 'custom',
    selected: null,
    selectedItems: [],
    zoneDraft: [],
  }))
  const androidBackStateRef = useRef({
    mobileDialog: false,
    mobileMoreOpen: false,
    openContextMenu: false,
    leftPaletteOpen: false,
    rightEditorOpen: false,
    tool: 'select' as ModeEditorSession['tool'],
    hasSelection: false,
  })
  androidBackStateRef.current = {
    mobileDialog: mobileDialog != null,
    mobileMoreOpen,
    openContextMenu: openContextMenu != null,
    leftPaletteOpen,
    rightEditorOpen,
    tool: session.tool,
    hasSelection: session.selected != null || session.selectedItems.length > 0,
  }
  const selectionAnchorRef = useRef<ModeEditorSelectionItem | null>(null)
  const modeClipboardRef = useRef<ModeClipboard | null>(null)

  const panelWidthLimits = useCallback((side: ModePanelSide, otherWidth: number) => {
    const available = window.innerWidth - otherWidth - MODE_MAP_MIN_WIDTH
    return side === 'left'
      ? { min: MODE_PALETTE_MIN_WIDTH, max: Math.min(MODE_PALETTE_MAX_WIDTH, available) }
      : { min: MODE_EDITOR_MIN_WIDTH, max: Math.min(MODE_EDITOR_MAX_WIDTH, available) }
  }, [])

  const commitPanelWidth = useCallback((side: ModePanelSide, width: number) => {
    setPanelWidths((current) => {
      const limits = panelWidthLimits(side, side === 'left' ? current.right : current.left)
      const next = { ...current, [side]: Math.round(clamp(width, limits.min, limits.max)) }
      window.localStorage.setItem(MODE_PANEL_WIDTHS_STORAGE_KEY, JSON.stringify(next))
      return next
    })
    window.requestAnimationFrame(() => mapRef.current?.invalidateSize({ animate: false }))
  }, [panelWidthLimits])

  const beginPanelResize = useCallback((side: ModePanelSide, event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const workbench = event.currentTarget.closest('.mode-workbench') as HTMLElement | null
    if (!workbench) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.classList.add('resizing')
    panelResizeRef.current = {
      side,
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: side === 'left' ? panelWidths.left : panelWidths.right,
      lastWidth: side === 'left' ? panelWidths.left : panelWidths.right,
      workbench,
    }
  }, [panelWidths])

  const movePanelResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const session = panelResizeRef.current
    if (!session || session.pointerId !== event.pointerId) return
    const otherWidth = session.side === 'left' ? panelWidths.right : panelWidths.left
    const limits = panelWidthLimits(session.side, otherWidth)
    const delta = session.side === 'left' ? event.clientX - session.startX : session.startX - event.clientX
    session.lastWidth = Math.round(clamp(session.startWidth + delta, limits.min, limits.max))
    if (session.workbench.isConnected) {
      session.workbench.style.setProperty(session.side === 'left' ? '--mode-palette-width' : '--mode-editor-width', `${session.lastWidth}px`)
    }
  }, [panelWidthLimits, panelWidths])

  const endPanelResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const session = panelResizeRef.current
    if (!session || session.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    event.currentTarget.classList.remove('resizing')
    panelResizeRef.current = null
    commitPanelWidth(session.side, session.lastWidth)
  }, [commitPanelWidth])

  const handlePanelResizeKey = useCallback((side: ModePanelSide, event: ReactKeyboardEvent<HTMLDivElement>) => {
    const currentWidth = side === 'left' ? panelWidths.left : panelWidths.right
    const otherWidth = side === 'left' ? panelWidths.right : panelWidths.left
    const limits = panelWidthLimits(side, otherWidth)
    let next: number | null = null
    if (event.key === 'Home') next = limits.min
    else if (event.key === 'End') next = limits.max
    else if (event.key === 'ArrowLeft') next = currentWidth + (side === 'right' ? 10 : -10)
    else if (event.key === 'ArrowRight') next = currentWidth + (side === 'left' ? 10 : -10)
    if (next == null) return
    event.preventDefault()
    commitPanelWidth(side, next)
  }, [commitPanelWidth, panelWidthLimits, panelWidths])

  useEffect(() => {
    const constrainWidths = () => setPanelWidths((current) => {
      const left = Math.round(clamp(current.left, MODE_PALETTE_MIN_WIDTH, Math.min(MODE_PALETTE_MAX_WIDTH, window.innerWidth - MODE_EDITOR_MIN_WIDTH - MODE_MAP_MIN_WIDTH)))
      const right = Math.round(clamp(current.right, MODE_EDITOR_MIN_WIDTH, Math.min(MODE_EDITOR_MAX_WIDTH, window.innerWidth - left - MODE_MAP_MIN_WIDTH)))
      return left === current.left && right === current.right ? current : { left, right }
    })
    window.addEventListener('resize', constrainWidths)
    return () => window.removeEventListener('resize', constrainWidths)
  }, [])

  const config = MAP_BY_ID[mapId] ?? MAPS[0]
  const attackStages = stagesForPlatform(editorDataPlatform)[mapId] ?? []
  const profile = store.profiles.find((item) => item.id === session.profileId) ?? store.profiles[0]
  const profileMaps = profile ? modeMapsForPlatform(profile, editorDataPlatform) : undefined
  const mapConfig = profileMaps?.[mapId] ?? emptyModeMapOverride(mapId)
  const firstModeStageId = mapConfig.stages[0]?.id ?? 'S1'

  useEffect(() => saveModeConfigStore(store), [store])

  useEffect(() => {
    if (!openContextMenu) return
    const closeOnOutside = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest('.mode-workbench-context .topbar-select')) setOpenContextMenu(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpenContextMenu(null) }
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [openContextMenu])

  useEffect(() => {
    if (!mobileMoreOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpenContextMenu(null)
      setMobileMoreOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [mobileMoreOpen])

  useEffect(() => () => {
    if (syncStatusTimerRef.current != null) window.clearTimeout(syncStatusTimerRef.current)
  }, [])

  useEffect(() => {
    if (platform.kind !== 'android') return
    const guardKey = '__deltaforceModeConfigGuard'
    if (!window.history.state?.[guardKey]) window.history.pushState({ ...window.history.state, [guardKey]: true }, '')
    const restoreGuard = () => window.history.pushState({ ...window.history.state, [guardKey]: true }, '')
    const onPopState = () => {
      const state = androidBackStateRef.current
      if (state.mobileDialog) {
        state.mobileDialog = false
        setMobileDialog(null)
      } else if (state.openContextMenu || state.mobileMoreOpen) {
        state.openContextMenu = false
        state.mobileMoreOpen = false
        setOpenContextMenu(null)
        setMobileMoreOpen(false)
      } else if (state.rightEditorOpen) {
        state.rightEditorOpen = false
        setRightEditorOpen(false)
      } else if (state.leftPaletteOpen) {
        state.leftPaletteOpen = false
        setLeftPaletteOpen(false)
      } else if (state.tool !== 'select') {
        state.tool = 'select'
        setActivePaletteAsset(null)
        setSelectedVehicleRefreshRuleIds([])
        setSession((current) => ({ ...current, tool: 'select', selected: null, selectedItems: [], zoneDraft: [] }))
      } else if (state.hasSelection) {
        state.hasSelection = false
        setSession((current) => ({ ...current, selected: null, selectedItems: [] }))
      } else {
        window.location.replace('/')
        return
      }
      restoreGuard()
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== MODE_CONFIG_STORAGE_KEY || !event.newValue) return
      try {
        const normalized = normalizeModeConfigStore(JSON.parse(event.newValue))
        if (!normalized) return
        const current = latestStoreRef.current
        const hasNewerProfile = normalized.profiles.some((incoming) => {
          const existing = current.profiles.find((profile) => profile.id === incoming.id)
          return !existing || incoming.updatedAt > existing.updatedAt
        })
        // 正式版收到编辑器写入后会规范化并回写同一份配置。相同或更旧的回声
        // 不应再次替换编辑器状态，否则刚绑定的规则会在待标注/已完成之间闪回。
        if (!hasNewerProfile && normalized.activeModeId === current.activeModeId) return
        dispatchStoreHistory({ type: 'replace', store: normalized })
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
        const editingPlatformMaps = modeUsesPlatformMaps(item)
          ? modeMapsForPlatform(item, editorDataPlatform)
          : item.maps
        const previous = editingPlatformMaps[mapId] ?? emptyModeMapOverride(mapId)
        const next = typeof update === 'function' ? update(previous) : update
        const now = Date.now()
        if (modeUsesPlatformMaps(item)) {
          const nextPlatformMaps = { ...editingPlatformMaps, [mapId]: { ...next, mapId, updatedAt: now } }
          return {
            ...item,
            maps: editorDataPlatform === 'pc' ? nextPlatformMaps : item.maps,
            platformMaps: { ...item.platformMaps, [editorDataPlatform]: nextPlatformMaps },
            updatedAt: now,
          }
        }
        return {
          ...item,
          maps: { ...item.maps, [mapId]: { ...next, mapId, updatedAt: now } },
          updatedAt: now,
        }
      }),
    }))
  }, [editorDataPlatform, mapId, session.profileId])

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
      } else if (options?.additive || (platform.kind === 'android' && mobileMultiSelect)) {
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
  }, [mobileMultiSelect])

  const deleteSelection = useCallback(() => {
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
    const refreshPointIds = new Set(selections
      .filter((item) => item.kind === 'vehicle-refresh-point' && mapConfig.vehicleRefreshPoints.some((point) => point.uid === item.uid && point.verification === 'draft'))
      .map((item) => item.uid))

    for (const point of mapConfig.objectives) {
      if (!objectiveIds.has(point.uid) || !point.captureZoneUid) continue
      const captureZone = mapConfig.zones.find((zone) => zone.uid === point.captureZoneUid)
      if (captureZone?.verification === 'draft') zoneIds.add(captureZone.uid)
    }
    if (zoneIds.size + spawnIds.size + objectiveIds.size + propIds.size + refreshPointIds.size === 0) return

    updateMapConfig({
      ...mapConfig,
      zones: mapConfig.zones.filter((zone) => !zoneIds.has(zone.uid)),
      spawns: mapConfig.spawns.filter((spawn) => !spawnIds.has(spawn.uid)),
      objectives: mapConfig.objectives
        .filter((point) => !objectiveIds.has(point.uid))
        .map((point) => zoneIds.has(point.captureZoneUid) ? { ...point, captureZoneUid: '' } : point),
      props: mapConfig.props.filter((prop) => !propIds.has(prop.uid)),
      vehicleRefreshPoints: mapConfig.vehicleRefreshPoints.filter((point) => !refreshPointIds.has(point.uid)),
      vehicleRefreshRules: mapConfig.vehicleRefreshRules.map((rule) => refreshPointIds.has(rule.refreshPointUid) ? { ...rule, refreshPointUid: '' } : rule),
      updatedAt: Date.now(),
    })
    setSession((current) => ({ ...current, selected: null, selectedItems: [] }))
  }, [mapConfig, session.selected, session.selectedItems, updateMapConfig])

  const copySelection = useCallback(() => {
    const items = session.selectedItems.length > 0
      ? session.selectedItems
      : session.selected ? [session.selected] : []
    if (items.length === 0) return
    modeClipboardRef.current = {
      items: items.map((item) => ({ ...item })),
      source: structuredClone(mapConfig),
    }
    setMobileClipboardReady(true)
  }, [mapConfig, session.selected, session.selectedItems])

  const requestConfirm = useCallback((title: string, message: string, onConfirm: () => void) => {
    if (platform.kind === 'android') {
      setMobileDialog({ kind: 'confirm', title, message, confirmLabel: '确定', onConfirm })
      return
    }
    if (window.confirm(message)) onConfirm()
  }, [])

  const requestPrompt = useCallback((title: string, initialValue: string, onSubmit: (value: string) => void) => {
    if (platform.kind === 'android') {
      setMobileDialog({ kind: 'prompt', title, value: initialValue, onSubmit })
      return
    }
    const value = window.prompt(title, initialValue)
    if (value != null) onSubmit(value)
  }, [])

  const showAlert = useCallback((title: string, message: string) => {
    if (platform.kind === 'android') setMobileDialog({ kind: 'alert', title, message })
    else window.alert(message)
  }, [])

  const pasteSelection = useCallback(() => {
    const clipboard = modeClipboardRef.current
    if (!clipboard?.items.length) return
    updateMapConfig((current) => {
      const zones = [...current.zones]
      const spawns = [...current.spawns]
      const objectives = [...current.objectives]
      const props = [...current.props]
      const vehicleRefreshPoints = [...current.vehicleRefreshPoints]
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
        } else if (item.kind === 'prop') {
          const source = clipboard.source.props.find((entry) => entry.uid === item.uid)
          if (!source) continue
          const uid = genUid('mode_prop')
          props.push({ ...source, uid, stageId: '*', lat: source.lat, lng: source.lng, verification: 'draft' })
          created.push({ kind: 'prop', uid })
        } else {
          const source = clipboard.source.vehicleRefreshPoints.find((entry) => entry.uid === item.uid)
          if (!source) continue
          const uid = genUid('vehicle_refresh_point')
          const copiedPoint: ModeVehicleRefreshPoint = { ...source, uid, name: `${source.name}（副本）`, verification: 'draft' }
          vehicleRefreshPoints.push(copiedPoint)
          created.push({ kind: 'vehicle-refresh-point', uid })
        }
      }
      if (created.length === 0) return current
      setSession((value) => ({ ...value, tool: 'select', selected: created.at(-1) ?? null, selectedItems: created }))
      return { ...current, zones, spawns, objectives, props, vehicleRefreshPoints, updatedAt: Date.now() }
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

  const closeWorkbench = useCallback(() => {
    if (platform.kind === 'android') window.location.replace('/')
    else platform.closeCurrentView()
  }, [])

  const setToolbarVisibility = useCallback((collapsed: boolean) => {
    setOpenContextMenu(null)
    setToolbarCollapsed(collapsed)
    window.requestAnimationFrame(() => mapRef.current?.invalidateSize({ animate: false }))
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
    setSelectedVehicleRefreshRuleIds([])
    setActivePaletteAsset(null)
  }, [editorDataPlatform, firstModeStageId, mapId, session.profileId])

  useEffect(() => {
    if (session.tool === 'select' && session.selected) setActivePaletteAsset(null)
  }, [session.selected, session.tool])

  const updateSession = useCallback((patch: Partial<ModeEditorSession>) => {
    setSession((current) => ({ ...current, ...patch }))
  }, [])

  const selectPaletteAsset = useCallback((asset: ModePaletteAsset) => {
    setActivePaletteAsset(asset)
    if (platform.kind === 'android') setLeftPaletteOpen(false)
    if (asset.kind === 'vehicle-refresh') {
      if (platform.kind === 'android') setRightEditorOpen(true)
      setSession((current) => ({ ...current, tool: 'select', selected: null, selectedItems: [], zoneDraft: [] }))
      return
    }
    setSession((current) => ({
      ...current,
      tool: asset.kind,
      zoneRole: asset.kind === 'zone' ? asset.role : current.zoneRole,
      selected: null,
      selectedItems: [],
      zoneDraft: [],
    }))
  }, [])

  const finishZoneDraft = useCallback(() => {
    if (session.zoneDraft.length < 3) return
    const roleMeta = {
      'attack-base': { kind: 'own' as const, color: '#01ff84' },
      'defense-base': { kind: 'enemy' as const, color: '#e0453a' },
      capture: { kind: 'neutral' as const, color: '#f4cf67' },
      frontline: { kind: 'neutral' as const, color: '#f4cf67' },
      custom: { kind: 'neutral' as const, color: '#9a9b9b' },
    }[session.zoneRole]
    const uid = genUid('mode_zone')
    const zone: ModeZone = {
      uid,
      stageId: session.stageId,
      name: `区域 ${mapConfig.zones.filter((item) => item.stageId === session.stageId).length + 1}`,
      kind: roleMeta.kind,
      role: session.zoneRole,
      color: roleMeta.color,
      points: session.zoneDraft.map(([lat, lng]) => [lat, lng]),
      verification: 'draft',
    }
    updateMapConfig((current) => ({ ...current, zones: [...current.zones, zone] }))
    setSession((current) => ({ ...current, tool: 'select', selected: { kind: 'zone', uid }, selectedItems: [{ kind: 'zone', uid }], zoneDraft: [] }))
    setActivePaletteAsset(null)
  }, [mapConfig.zones, session.stageId, session.zoneDraft, session.zoneRole, updateMapConfig])

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
    setSession((current) => ({ ...current, tool: 'select', selected: { kind: 'spawn', uid }, selectedItems: [{ kind: 'spawn', uid }] }))
    setActivePaletteAsset(null)
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
    setSession((current) => ({ ...current, tool: 'select', selected: { kind: 'objective', uid }, selectedItems: [{ kind: 'objective', uid }] }))
    setActivePaletteAsset(null)
  }, [mapConfig.objectives, session.stageId, updateMapConfig])

  const addProp = useCallback((point: [number, number], template?: { name: string; icon: string }) => {
    const uid = genUid('mode_prop')
    const prop: ModeMapProp = {
      uid,
      stageId: '*',
      name: template?.name ?? '固定弹药箱',
      icon: template?.icon ?? 'q_gddyx',
      lat: point[0],
      lng: point[1],
      verification: 'draft',
    }
    updateMapConfig((current) => ({ ...current, props: [...current.props, prop] }))
    setSession((current) => ({ ...current, tool: 'select', selected: { kind: 'prop', uid }, selectedItems: [{ kind: 'prop', uid }] }))
    setActivePaletteAsset(null)
  }, [updateMapConfig])

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
    setActivePaletteAsset(null)
  }, [session.stageId, updateMapConfig])

  const placeSelectedSpawn = useCallback((point: [number, number]) => {
    addSpawn(point, activePaletteAsset?.kind === 'spawn' ? activePaletteAsset.side : view)
  }, [activePaletteAsset, addSpawn, view])

  const placeSelectedObjective = useCallback((point: [number, number]) => {
    addObjective(point, activePaletteAsset?.kind === 'objective' ? activePaletteAsset.icon : 'q_jd_a')
  }, [activePaletteAsset, addObjective])

  const placeSelectedProp = useCallback((point: [number, number]) => {
    addProp(point, activePaletteAsset?.kind === 'prop' ? activePaletteAsset : undefined)
  }, [activePaletteAsset, addProp])

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

  const finishVehicleRefreshPlacement = useCallback(() => {
    setSelectedVehicleRefreshRuleIds([])
    setSession((current) => ({ ...current, tool: 'select', selected: null, selectedItems: [] }))
  }, [])

  const bindVehicleRefreshRulesToPoint = useCallback((refreshPointUid: string) => {
    const ruleIds = selectedVehicleRefreshRuleIds.filter((uid) => mapConfig.vehicleRefreshRules.some((rule) => rule.uid === uid && rule.action === 'refresh'))
    if (ruleIds.length === 0) return
    updateMapConfig((current) => {
      const vehicleRefreshRules = current.vehicleRefreshRules.map((rule) =>
        ruleIds.includes(rule.uid) ? { ...rule, refreshPointUid } : rule,
      )
      const usedPointIds = new Set(vehicleRefreshRules.map((rule) => rule.refreshPointUid).filter(Boolean))
      return {
        ...current,
        vehicleRefreshRules,
        // 重新绑定到共享位置后，清除已无人引用的旧草稿点，防止同坐标 Marker 重叠。
        vehicleRefreshPoints: current.vehicleRefreshPoints.filter((point) =>
          point.verification === 'confirmed' || usedPointIds.has(point.uid),
        ),
      }
    })
    finishVehicleRefreshPlacement()
  }, [finishVehicleRefreshPlacement, mapConfig.vehicleRefreshRules, selectedVehicleRefreshRuleIds, updateMapConfig])

  const placeVehicleRefreshPoint = useCallback((point: [number, number]) => {
    const ruleIds = selectedVehicleRefreshRuleIds.filter((uid) => mapConfig.vehicleRefreshRules.some((rule) => rule.uid === uid && rule.action === 'refresh'))
    if (ruleIds.length === 0) return
    updateMapConfig((current) => {
      // 点击已有位置附近的空白像素时也复用同一个刷新点，避免视觉上同位置却生成两个 Marker。
      const existingPoint = current.vehicleRefreshPoints.find((item) =>
        Math.hypot(item.lat - point[0], item.lng - point[1]) <= 1.5,
      )
      const uid = existingPoint?.uid ?? genUid('vehicle_refresh_point')
      const firstRule = current.vehicleRefreshRules.find((rule) => ruleIds.includes(rule.uid))
      const refreshPoint: ModeVehicleRefreshPoint | null = existingPoint ? null : {
        uid,
        name: `${firstRule?.objective || '?'}点载具刷新位置 ${current.vehicleRefreshPoints.length + 1}`,
        lat: point[0],
        lng: point[1],
        verification: 'draft',
      }
      const vehicleRefreshRules = current.vehicleRefreshRules.map((rule) =>
        ruleIds.includes(rule.uid) ? { ...rule, refreshPointUid: uid } : rule,
      )
      const usedPointIds = new Set(vehicleRefreshRules.map((rule) => rule.refreshPointUid).filter(Boolean))
      return {
        ...current,
        vehicleRefreshPoints: [
          ...current.vehicleRefreshPoints.filter((item) =>
            item.verification === 'confirmed' || usedPointIds.has(item.uid),
          ),
          ...(refreshPoint ? [refreshPoint] : []),
        ],
        vehicleRefreshRules,
      }
    })
    finishVehicleRefreshPlacement()
  }, [finishVehicleRefreshPlacement, mapConfig.vehicleRefreshPoints.length, mapConfig.vehicleRefreshRules, selectedVehicleRefreshRuleIds, updateMapConfig])

  const moveVehicleRefreshPoint = useCallback((uid: string, point: [number, number]) => {
    updateMapConfig((current) => ({
      ...current,
      vehicleRefreshPoints: current.vehicleRefreshPoints.map((item) => item.uid === uid && item.verification === 'draft'
        ? { ...item, lat: point[0], lng: point[1] }
        : item),
    }))
  }, [updateMapConfig])

  const importVehicleRefreshRules = useCallback((text: string) => {
    const parsed = parseVehicleRefreshTable(text)
    const targetProfile = store.profiles.find((item) => item.id === session.profileId)
    if (!targetProfile) return { imported: 0, ignored: 0, errors: ['当前模式不存在。'] }
    const maps = { ...modeMapsForPlatform(targetProfile, editorDataPlatform) }
    let imported = 0
    let ignored = 0
    for (const record of parsed.records) {
      const current = maps[record.mapId] ?? emptyModeMapOverride(record.mapId)
      const signatures = new Set(current.vehicleRefreshRules.map(vehicleRefreshRuleSignature))
      const signature = vehicleRefreshRuleSignature(record.rule)
      if (signatures.has(signature)) {
        ignored += 1
        continue
      }
      maps[record.mapId] = {
        ...current,
        vehicleRefreshRules: [...current.vehicleRefreshRules, record.rule],
        updatedAt: Date.now(),
      }
      imported += 1
    }
    if (imported > 0) {
      const now = Date.now()
      setStore({
        ...store,
        profiles: store.profiles.map((item) => {
          if (item.id !== targetProfile.id) return item
          if (!modeUsesPlatformMaps(item)) return { ...item, maps, updatedAt: now }
          return {
            ...item,
            maps: editorDataPlatform === 'pc' ? maps : item.maps,
            platformMaps: { ...item.platformMaps, [editorDataPlatform]: maps },
            updatedAt: now,
          }
        }),
      })
    }
    return { imported, ignored, errors: parsed.errors }
  }, [editorDataPlatform, session.profileId, setStore, store])

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
    if (asset.kind === 'vehicle-refresh') return
    if (asset.kind === 'spawn') addSpawn(point, asset.side)
    else if (asset.kind === 'objective') addObjective(point, asset.icon)
    else if (asset.kind === 'prop') addProp(point, asset)
    else addPresetZone(point, asset.role)
  }, [addObjective, addPresetZone, addProp, addSpawn])

  const syncToOfficial = useCallback(() => {
    const nextStore = { ...store, activeModeId: profile.id }
    setStore(nextStore)
    publishModeConfigStore(nextStore)
    const officialWindow = platform.focusParentOrOpen('/', { target: 'deltaforce-map-tools-official' })
    officialWindow?.focus()
    setSyncStatus(`已同步并刷新正式版 · ${editorDataPlatform === 'pc' ? 'PC端' : '移动端'} ${config.name} ${mapConfig.stages.length} 个阶段`)
    if (syncStatusTimerRef.current != null) window.clearTimeout(syncStatusTimerRef.current)
    syncStatusTimerRef.current = window.setTimeout(() => setSyncStatus(''), 3500)
  }, [config.name, editorDataPlatform, mapConfig.stages.length, profile.id, setStore, store])

  if (!config || !profile) return null

  const selectedCount = session.selectedItems.length > 0 ? session.selectedItems.length : session.selected ? 1 : 0
  const renderContextControls = () => (
    <>
      <ToolbarSelect floating menu="editor-map" label="地图" value={config.name} options={MAPS.map((map) => ({ value: map.id, label: map.name }))} openMenu={openContextMenu} onOpenMenu={setOpenContextMenu} onSelect={setMapId} />
      <ToolbarSelect floating menu="editor-mode" label="模式" value={profile.name} options={store.profiles.map((item) => ({ value: item.id, label: item.name }))} openMenu={openContextMenu} onOpenMenu={setOpenContextMenu} onSelect={(profileId) => setSession((current) => ({ ...current, profileId, selected: null, selectedItems: [], zoneDraft: [] }))} />
      <ToolbarSelect floating menu="editor-data-platform" label="游戏数据" value={editorDataPlatform === 'pc' ? 'PC端' : '移动端'} options={[{ value: 'pc', label: 'PC端' }, { value: 'mobile', label: '移动端' }]} openMenu={openContextMenu} onOpenMenu={setOpenContextMenu} onSelect={(value) => { const next = value as GameDataPlatform; setEditorDataPlatform(next); window.localStorage.setItem('deltaforce-mode-editor-game-data-platform', next) }} align={device.mobileLayout ? 'right' : 'left'} />
      <ToolbarSelect floating menu="editor-stage" label="阶段" value={mapConfig.stages.find((stage) => stage.id === session.stageId) ? `${session.stageId} · ${mapConfig.stages.find((stage) => stage.id === session.stageId)?.label}` : session.stageId} options={mapConfig.stages.map((stage) => ({ value: stage.id, label: `${stage.id} · ${stage.label}` }))} openMenu={openContextMenu} onOpenMenu={setOpenContextMenu} onSelect={(stageId) => updateSession({ stageId, selected: null, selectedItems: [], zoneDraft: [] })} align={device.mobileLayout ? 'right' : 'left'} />
    </>
  )

  return (
    <main
      className={`mode-workbench platform-${device.platform} ${device.mobileLayout ? 'mobile-layout' : 'desktop-layout'}${leftPaletteOpen ? '' : ' left-palette-collapsed'}${toolbarCollapsed ? ' toolbar-collapsed' : ''}`}
      style={{ '--mode-palette-width': `${panelWidths.left}px`, '--mode-editor-width': `${panelWidths.right}px` } as CSSProperties}
    >
      {toolbarCollapsed ? (
        <button className="mode-workbench-toolbar-expand" type="button" onClick={() => setToolbarVisibility(false)} title="展开顶部栏" aria-label="展开顶部栏">
          <i className="fa-solid fa-chevron-down" aria-hidden="true" />
          <span>展开工具栏</span>
        </button>
      ) : <header className="mode-workbench-toolbar">
        <div className="mode-workbench-brand">
          <img src="/nav_title.png" alt="三角洲行动" draggable={false} />
          <div className="mode-workbench-title"><strong>模式编辑器</strong><span>地图数据工作台</span></div>
        </div>
        <div className="mode-workbench-context" aria-label="编辑上下文">{renderContextControls()}</div>
        <button type="button" className={`mode-side-switch ${view}`} role="switch" aria-checked={view === 'defense'} aria-label={`当前为${view === 'attack' ? '进攻方' : '防守方'}，点击切换`} onClick={() => setView(view === 'attack' ? 'defense' : 'attack')}>
          <span>进攻方</span><span>防守方</span><i aria-hidden="true" />
        </button>
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
              ['vehicleRefresh', '载具刷新点'],
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
        <details className="mode-workbench-data">
          <summary><i className="fa-solid fa-database" />数据</summary>
          <div>
            <strong>保存与发布</strong>
            <button className="primary" onClick={syncToOfficial}><i className="fa-solid fa-cloud-arrow-up" /><span>同步到正式版</span></button>
            <button onClick={() => downloadText(`deltaforce-${profile.id}-${mapId}-${editorDataPlatform}-official-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(buildOfficialModeData(profile, editorDataPlatform, mapId), null, 2))}><i className="fa-solid fa-code" /><span>导出当前地图</span></button>
            <button onClick={() => downloadText(`deltaforce-mode-configs-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(store, null, 2))}><i className="fa-solid fa-box-archive" /><span>备份编辑配置</span></button>
            <button title="支持编辑配置备份与正式数据" onClick={() => importConfigRef.current?.click()}><i className="fa-solid fa-file-import" /><span>导入数据 JSON</span></button>
            <input
              ref={importConfigRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.currentTarget.value = ''
                if (!file) return
                void file.text().then((text) => {
                  const imported = importModeConfigData(store, JSON.parse(text), editorDataPlatform)
                  if (!imported) return showAlert('导入失败', '无法识别该 JSON。请选择“备份编辑配置”或“导出正式数据”生成的文件。')
                  setStore(imported.store)
                  setSession((current) => ({ ...current, profileId: imported.profileId, selected: null, selectedItems: [], zoneDraft: [] }))
                  setSyncStatus(imported.kind === 'official'
                    ? `已导入正式数据${imported.profileId === 'attack-defense' || imported.profileId === 'winner-takes-all' ? ` · ${editorDataPlatform === 'pc' ? 'PC端' : 'PE端'}` : ''}`
                    : '已恢复编辑配置备份')
                }).catch(() => showAlert('导入失败', '文件不是有效的 JSON，或内容无法读取。'))
              }}
            />
          </div>
        </details>
        <button className="mode-workbench-icon-button mode-workbench-fullscreen" onClick={() => void toggleFullscreen()} title={fullscreen ? '退出全屏（Esc）' : '进入全屏'} aria-label={fullscreen ? '退出全屏' : '进入全屏'}>
          <i className={`fa-solid ${fullscreen ? 'fa-compress' : 'fa-expand'}`} />
        </button>
        <ShortcutHelp />
        {device.mobileLayout ? <button
          className={`mode-workbench-icon-button mode-mobile-more-trigger${mobileMoreOpen ? ' active' : ''}`}
          type="button"
          onClick={() => {
            setOpenContextMenu(null)
            setMobileMoreOpen((open) => !open)
          }}
          title="更多操作"
          aria-label="更多操作"
          aria-expanded={mobileMoreOpen}
        ><i className="fa-solid fa-ellipsis" /></button> : null}
        <button className="mode-workbench-icon-button mode-workbench-toolbar-collapse" type="button" onClick={() => setToolbarVisibility(true)} title="收起顶部栏" aria-label="收起顶部栏"><i className="fa-solid fa-chevron-up" /></button>
        <button className="mode-workbench-icon-button mode-workbench-close" onClick={closeWorkbench} title="退出模式编辑器" aria-label="退出模式编辑器"><i className="fa-solid fa-xmark" /><span className="mode-workbench-close-label">退出</span></button>
      </header>}

      {device.mobileLayout && mobileMoreOpen ? (
        <div className="mode-mobile-sheet-backdrop" role="presentation" onPointerDown={() => setMobileMoreOpen(false)}>
          <section className="mode-mobile-more-panel" aria-label="模式配置更多操作" onPointerDown={(event) => event.stopPropagation()}>
            <header><strong>工作台操作</strong><button type="button" onClick={() => setMobileMoreOpen(false)} aria-label="关闭"><i className="fa-solid fa-xmark" /></button></header>
            <div className="mode-mobile-more-grid">
              <button type="button" className={mobileMultiSelect ? 'active' : ''} onClick={() => setMobileMultiSelect((active) => !active)}><i className="fa-solid fa-object-group" /><span>{mobileMultiSelect ? '结束多选' : '多选'}</span></button>
              <button type="button" disabled={selectedCount === 0} onClick={copySelection}><i className="fa-regular fa-copy" /><span>复制</span></button>
              <button type="button" disabled={!mobileClipboardReady} onClick={pasteSelection}><i className="fa-regular fa-clipboard" /><span>粘贴</span></button>
              <button type="button" className="danger" disabled={selectedCount === 0} onClick={deleteSelection}><i className="fa-solid fa-trash" /><span>删除选中</span></button>
            </div>
            <strong className="mode-mobile-more-title">元素显示</strong>
            <div className="mode-mobile-more-grid visibility">
              {([['zones', '区域'], ['spawns', '复活点'], ['objectives', '据点'], ['props', '地图道具'], ['vehicleRefresh', '载具刷新']] as const).map(([key, label]) => (
                <button type="button" key={key} className={elementVisibility[key] ? 'active' : ''} onClick={() => setElementVisibility((current) => ({ ...current, [key]: !current[key] }))}><i className={`fa-solid ${elementVisibility[key] ? 'fa-eye' : 'fa-eye-slash'}`} /><span>{label}</span></button>
              ))}
            </div>
            <strong className="mode-mobile-more-title">数据</strong>
            <div className="mode-mobile-more-grid data">
              <button type="button" className="primary" onClick={syncToOfficial}><i className="fa-solid fa-cloud-arrow-up" /><span>同步正式版</span></button>
              <button type="button" onClick={() => downloadText(`deltaforce-${profile.id}-${mapId}-${editorDataPlatform}-official-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(buildOfficialModeData(profile, editorDataPlatform, mapId), null, 2))}><i className="fa-solid fa-code" /><span>导出当前地图</span></button>
              <button type="button" onClick={() => downloadText(`deltaforce-mode-configs-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(store, null, 2))}><i className="fa-solid fa-box-archive" /><span>备份配置</span></button>
              <button type="button" title="支持编辑配置备份与正式数据" onClick={() => { setMobileMoreOpen(false); importConfigRef.current?.click() }}><i className="fa-solid fa-file-import" /><span>导入数据</span></button>
            </div>
          </section>
        </div>
      ) : null}

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
          selectedAsset={activePaletteAsset}
          allowVehicleRefresh={profile.id !== 'attack-defense'}
          onSelectAsset={selectPaletteAsset}
          onToggleCollapsed={() => {
            setLeftPaletteOpen((open) => !open)
          }}
        />
        {leftPaletteOpen && <div
          className="mode-workbench-resizer left"
          role="separator"
          tabIndex={0}
          aria-label="调整左侧栏宽度"
          aria-orientation="vertical"
          aria-valuemin={MODE_PALETTE_MIN_WIDTH}
          aria-valuemax={MODE_PALETTE_MAX_WIDTH}
          aria-valuenow={panelWidths.left}
          title="拖动调整宽度；双击恢复默认"
          onPointerDown={(event) => beginPanelResize('left', event)}
          onPointerMove={movePanelResize}
          onPointerUp={endPanelResize}
          onPointerCancel={endPanelResize}
          onDoubleClick={() => commitPanelWidth('left', MODE_PALETTE_DEFAULT_WIDTH)}
          onKeyDown={(event) => handlePanelResizeKey('left', event)}
        />}
        <MapContainer
          key={config.id}
          crs={L.CRS.Simple}
          bounds={mapBounds(config)}
          minZoom={config.minZoom}
          maxZoom={config.maxZoom}
          inertia={false}
          fadeAnimation={false}
          zoomAnimation={false}
          markerZoomAnimation={false}
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
            keepBuffer={4}
            updateWhenIdle={false}
            updateWhenZooming={false}
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
            vehicleRefreshVisible={elementVisibility.vehicleRefresh}
            tool={session.tool}
            selected={session.selected}
            selectedItems={session.selectedItems}
            zoneDraft={session.zoneDraft}
            onSelect={(selected, options) => selectEditorItem(selected, options)}
            onZoneDraftChange={(zoneDraft) => updateSession({ zoneDraft })}
            onAddSpawn={placeSelectedSpawn}
            onAddObjective={placeSelectedObjective}
            onAddProp={placeSelectedProp}
            onPlaceVehicleRefreshPoint={placeVehicleRefreshPoint}
            onBindVehicleRefreshPoint={bindVehicleRefreshRulesToPoint}
            onMoveSpawn={moveSpawn}
            onMoveObjective={moveObjective}
            onMoveProp={moveProp}
            onMoveVehicleRefreshPoint={moveVehicleRefreshPoint}
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
          onCreateProfile={(name) => {
            const created = createModeProfile(name)
            setStore((current) => ({ ...current, profiles: [...current.profiles, created] }))
            setSession((current) => ({ ...current, profileId: created.id, selected: null, selectedItems: [], zoneDraft: [] }))
          }}
          onDeleteProfile={(id) => {
            if (store.profiles.length <= 1 || id === 'attack-defense') return
            const profiles = store.profiles.filter((item) => item.id !== id)
            setStore({ ...store, profiles, activeModeId: store.activeModeId === id ? 'attack-defense' : store.activeModeId })
            setSession((current) => ({ ...current, profileId: profiles[0]?.id ?? null, selected: null, selectedItems: [], zoneDraft: [] }))
          }}
          onUpdateProfile={(id, patch: Partial<Pick<GameModeProfile, 'name' | 'description'>>) => setStore((current) => ({
            ...current,
            profiles: current.profiles.map((item) => item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item),
          }))}
          onMapConfigChange={updateMapConfig}
          onSyncAttackDefense={() => updateMapConfig(syncModeMapFromAttackDefense(mapId, attackStages, propsForPlatform(editorDataPlatform), deployForPlatform(editorDataPlatform)))}
          selectedVehicleRefreshRuleIds={selectedVehicleRefreshRuleIds}
          onSelectedVehicleRefreshRuleIdsChange={setSelectedVehicleRefreshRuleIds}
          onImportVehicleRefreshRules={importVehicleRefreshRules}
          onFinishZoneDraft={finishZoneDraft}
          onDeleteSelection={deleteSelection}
          onRequestConfirm={requestConfirm}
          onRequestPrompt={requestPrompt}
          requestedPaletteAsset={activePaletteAsset}
          collapsed={!rightEditorOpen}
          onToggleCollapsed={() => {
            setRightEditorOpen((open) => !open)
          }}
        />
        {rightEditorOpen && <div
          className="mode-workbench-resizer right"
          role="separator"
          tabIndex={0}
          aria-label="调整右侧栏宽度"
          aria-orientation="vertical"
          aria-valuemin={MODE_EDITOR_MIN_WIDTH}
          aria-valuemax={MODE_EDITOR_MAX_WIDTH}
          aria-valuenow={panelWidths.right}
          title="拖动调整宽度；双击恢复默认"
          onPointerDown={(event) => beginPanelResize('right', event)}
          onPointerMove={movePanelResize}
          onPointerUp={endPanelResize}
          onPointerCancel={endPanelResize}
          onDoubleClick={() => commitPanelWidth('right', MODE_EDITOR_DEFAULT_WIDTH)}
          onKeyDown={(event) => handlePanelResizeKey('right', event)}
        />}
      </div>
      {device.mobileLayout && session.tool === 'zone' ? (
        <div
          className="mode-mobile-map-actions zone-draft"
          role="toolbar"
          aria-label="区域绘制操作"
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <span><i className="fa-solid fa-draw-polygon" />{session.zoneDraft.length} 个顶点</span>
          <button type="button" disabled={session.zoneDraft.length === 0} onClick={() => updateSession({ zoneDraft: session.zoneDraft.slice(0, -1) })}><i className="fa-solid fa-rotate-left" />撤销节点</button>
          <button type="button" className="primary" disabled={session.zoneDraft.length < 3} onClick={finishZoneDraft}><i className="fa-solid fa-check" />完成</button>
          <button type="button" className="danger" onClick={() => {
            setActivePaletteAsset(null)
            updateSession({ tool: 'select', selected: null, selectedItems: [], zoneDraft: [] })
          }}><i className="fa-solid fa-xmark" />取消</button>
        </div>
      ) : device.mobileLayout && session.tool !== 'select' ? (
        <div
          className="mode-mobile-map-actions placement"
          role="toolbar"
          aria-label="元素放置操作"
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <span><i className="fa-solid fa-location-crosshairs" />轻触放置；拖动或双指移动地图</span>
          <button type="button" className="danger" onClick={() => {
            setActivePaletteAsset(null)
            setSelectedVehicleRefreshRuleIds([])
            updateSession({ tool: 'select', selected: null, selectedItems: [], zoneDraft: [] })
          }}><i className="fa-solid fa-xmark" />取消</button>
        </div>
      ) : null}
      {device.mobileLayout && mobileDialog ? (
        <div className="mobile-confirm-backdrop" role="presentation" onPointerDown={(event) => {
          if (event.target === event.currentTarget) setMobileDialog(null)
        }}>
          <div className="mobile-confirm-dialog mode-config-mobile-dialog" role="alertdialog" aria-modal="true">
            <h2>{mobileDialog.title}</h2>
            {mobileDialog.kind === 'prompt' ? (
              <input
                autoFocus
                value={mobileDialog.value}
                onChange={(event) => setMobileDialog((current) => current?.kind === 'prompt' ? { ...current, value: event.target.value } : current)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                  const action = mobileDialog.onSubmit
                  const value = mobileDialog.value
                  setMobileDialog(null)
                  action(value)
                }}
              />
            ) : <p>{mobileDialog.message}</p>}
            <div className="mobile-confirm-actions">
              {mobileDialog.kind !== 'alert' ? <button type="button" onClick={() => setMobileDialog(null)}>取消</button> : null}
              <button
                type="button"
                className={mobileDialog.kind === 'confirm' ? 'danger' : ''}
                onClick={() => {
                  const current = mobileDialog
                  setMobileDialog(null)
                  if (current.kind === 'confirm') current.onConfirm()
                  else if (current.kind === 'prompt') current.onSubmit(current.value)
                }}
              >{mobileDialog.kind === 'alert' ? '知道了' : mobileDialog.kind === 'prompt' ? '确定' : mobileDialog.confirmLabel}</button>
            </div>
          </div>
        </div>
      ) : null}
      <footer className="mode-workbench-statusbar">
        <span className={`mode-workbench-tool-state tool-${session.tool}`}><i className={`fa-solid ${session.tool === 'select' ? 'fa-arrow-pointer' : session.tool === 'zone' ? 'fa-draw-polygon' : session.tool === 'vehicle-refresh' ? 'fa-truck-fast' : 'fa-location-crosshairs'}`} />{
          session.tool === 'select' ? '选择模式：点击地图元素查看和编辑属性'
            : session.tool === 'zone' ? `绘制${activePaletteAsset?.kind === 'zone' ? `“${activePaletteAsset.role === 'frontline' ? '阶段防线' : activePaletteAsset.role === 'attack-base' ? '进攻活动区' : activePaletteAsset.role === 'defense-base' ? '防守活动区' : '据点占领区'}”` : '区域'}：依次点击地图标记顶点`
              : session.tool === 'vehicle-refresh' ? `载具刷新标注：已选择 ${selectedVehicleRefreshRuleIds.length} 条规则`
                : `放置模式：点击地图创建${activePaletteAsset?.kind === 'spawn' ? '复活点' : activePaletteAsset?.kind === 'objective' ? '据点' : '地图设施'}`
        }</span>
        <span><i className="fa-solid fa-map" />{config.name} · {session.stageId}</span>
        <span><i className="fa-solid fa-floppy-disk" />{syncStatus || '更改自动保存到本机'}</span>
      </footer>
    </main>
  )
}
