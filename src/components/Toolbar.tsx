import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { DrawSettings, Side, ToolMode } from '../types'
import DrawBar from './DrawBar'
import { IconFullscreen } from './icons'
import ShortcutHelp from './ShortcutHelp'
import { platform } from '../platform'
import type { GameDataPlatform } from '../config/gameDataPlatform'

type ToolbarMenu = 'map' | 'mode' | 'device'

interface ToolbarSelectOption {
  value: string
  label: string
  disabled?: boolean
}

interface ToolbarSelectProps {
  menu: ToolbarMenu
  label: string
  value: string
  options: ToolbarSelectOption[]
  openMenu: ToolbarMenu | null
  onOpenMenu: (menu: ToolbarMenu | null) => void
  onSelect?: (value: string) => void
  align?: 'left' | 'right'
}

function ToolbarSelect({
  menu,
  label,
  value,
  options,
  openMenu,
  onOpenMenu,
  onSelect,
  align = 'left',
}: ToolbarSelectProps) {
  const open = openMenu === menu
  const menuId = `toolbar-${menu}-menu`
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [menuPosition, setMenuPosition] = useState<CSSProperties>({})

  useLayoutEffect(() => {
    if (!open || platform.kind !== 'android') return
    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (!rect) return
      setMenuPosition(align === 'right'
        ? { top: rect.bottom + 4, right: Math.max(6, window.innerWidth - rect.right) }
        : { top: rect.bottom + 4, left: Math.max(6, rect.left) })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    return () => window.removeEventListener('resize', updatePosition)
  }, [align, open])

  return (
    <div className={`map-select topbar-select menu-${menu} ${open ? 'open' : ''}`}>
      <button
        ref={buttonRef}
        className="map-select-btn"
        onClick={() => onOpenMenu(open ? null : menu)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
      >
        <span className="map-select-label">{label}</span>
        <span className="map-select-value">{value}</span>
        <i className="fa-solid fa-chevron-down" aria-hidden="true" />
      </button>
      {open ? (
        <div id={menuId} className={`map-select-menu align-${align}`} role="listbox" style={menuPosition}>
          {options.map((option) => (
            <button
              key={option.value}
              role="option"
              aria-selected={value === option.label}
              className={`map-select-item ${value === option.label ? 'active' : ''}`}
              disabled={option.disabled}
              onClick={() => {
                if (option.disabled) return
                onSelect?.(option.value)
                onOpenMenu(null)
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

const MAPS: { id: string; name: string }[] = [
  { id: 'ascent', name: '攀升' },
  { id: 'flashpoint', name: '临界点' },
  { id: 'fault', name: '断层' },
  { id: 'brokentrack', name: '断轨' },
  { id: 'colosseum', name: '克劳狄斗兽场' },
  { id: 'stormeye', name: '风暴眼' },
  { id: 'ember', name: '烬区' },
  { id: 'pyramid', name: '金字塔' },
  { id: 'trench', name: '堑壕战' },
  { id: 'umuscanal', name: '乌姆斯运河' },
  { id: 'aftershock', name: '余震' },
]

const MAP_OPTIONS: ToolbarSelectOption[] = MAPS.map((map) => ({ value: map.id, label: map.name }))

const DEVICE_OPTIONS: ToolbarSelectOption[] = [
  { value: 'pc', label: 'PC端' },
  { value: 'mobile', label: '移动端' },
]

interface ToolbarProps {
  mapId: string
  onMapId: (id: string) => void
  gameDataPlatform: GameDataPlatform
  onGameDataPlatform: (platform: GameDataPlatform) => void
  gameModeName: string
  gameModeOptions: { id: string; name: string }[]
  onGameMode: (id: string) => void
  onOpenModeEditor: () => void
  view: Side
  onView: (v: Side) => void
  // ---- 绘制工具（固定在顶部栏） ----
  tool: ToolMode
  onTool: (t: ToolMode) => void
  draw: DrawSettings
  onDrawChange: (d: DrawSettings) => void
  dirty: boolean
  canUndo: boolean
  onUndo: () => void
  canRedo: boolean
  onRedo: () => void
  canDeleteSel: boolean
  onDeleteSelected: () => void
  onClearDraw: () => void
  onClearVehicles: () => void
  onClearAll: () => void
  /** 打开战术板弹窗（导出 HTML / 方案管理） */
  onOpenTactical: () => void
}

/** 左上角图标（来自 enn.com.cn，三角洲行动标题标识） */
const OFFICIAL_LOGO = '/nav_title.png'

/** 全屏切换（复刻官网功能） */
function toggleFullscreen() {
  void platform.toggleFullscreen()
}

/**
 * 顶部工具栏（官网风格）：
 * 左上角官网图标 → 地图选择栏 → 绘制工具（内嵌） → 模式切换区。
 */
export default function Toolbar({
  mapId,
  onMapId,
  gameDataPlatform,
  onGameDataPlatform,
  gameModeName,
  gameModeOptions,
  onGameMode,
  onOpenModeEditor,
  view,
  onView,
  tool,
  onTool,
  draw,
  onDrawChange,
  dirty,
  canUndo,
  onUndo,
  canRedo,
  onRedo,
  canDeleteSel,
  onDeleteSelected,
  onClearDraw,
  onClearVehicles,
  onClearAll,
  onOpenTactical,
}: ToolbarProps) {
  const [openMenu, setOpenMenu] = useState<ToolbarMenu | null>(null)
  const currentMap = MAPS.find((m) => m.id === mapId) ?? MAPS[0]

  // 三个下拉栏共用一个打开状态，保证同一时间只展开一项。
  useEffect(() => {
    if (!openMenu) return
    const onDocDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement
      if (!t.closest('.topbar-select')) setOpenMenu(null)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null)
    }
    document.addEventListener('pointerdown', onDocDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onDocDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [openMenu])

  return (
    <header className="toolbar">
      {/* 左上角官网图标（与左侧工具栏同宽） */}
      <div className="logo-area">
        <img
          className="logo-mark-img"
          src={OFFICIAL_LOGO}
          alt="三角洲行动"
          draggable={false}
          onError={(e) => {
            ;(e.currentTarget as HTMLImageElement).style.display = 'none'
          }}
        />
      </div>

      {/* 地图选择（下拉栏） */}
      <ToolbarSelect
        menu="map"
        label="全面战场"
        value={currentMap.name}
        options={MAP_OPTIONS}
        openMenu={openMenu}
        onOpenMenu={setOpenMenu}
        onSelect={onMapId}
      />

      {/* 绘制工具（固定于顶部栏） */}
      <DrawBar
        tool={tool}
        onTool={onTool}
        draw={draw}
        onDrawChange={onDrawChange}
        dirty={dirty}
        canUndo={canUndo}
        onUndo={onUndo}
        canRedo={canRedo}
        onRedo={onRedo}
        canDeleteSel={canDeleteSel}
        onDeleteSelected={onDeleteSelected}
        onClearDraw={onClearDraw}
        onClearVehicles={onClearVehicles}
        onClearAll={onClearAll}
      />

      {/* 右侧模式切换区 */}
      <div className="mode-area">
        <ToolbarSelect
          menu="mode"
          label="模式"
          value={gameModeName}
          options={[
            { value: 'attack-defense', label: '攻防模式' },
            ...gameModeOptions.map((mode) => ({ value: mode.id, label: mode.name })),
            { value: 'occupation', label: '占领模式', disabled: true },
            { value: '__configure__', label: '配置模式…' },
          ]}
          openMenu={openMenu}
          onOpenMenu={setOpenMenu}
          onSelect={(id) => {
            if (id === '__configure__') onOpenModeEditor()
            else onGameMode(id)
          }}
          align="right"
        />
        <ToolbarSelect
          menu="device"
          label="游戏数据"
          value={gameDataPlatform === 'mobile' ? '移动端' : 'PC端'}
          options={DEVICE_OPTIONS}
          openMenu={openMenu}
          onOpenMenu={setOpenMenu}
          onSelect={(value) => onGameDataPlatform(value as GameDataPlatform)}
          align="right"
        />
        <div className="mode-divider" />
        <div className="mode-group seg">
          <button
            className={`mode-btn ${view === 'attack' ? 'active' : ''}`}
            onClick={() => onView('attack')}
            aria-label="攻方视角"
          >
            <span className="mode-view-long">攻方视角</span>
            <span className="mode-view-short" aria-hidden="true">攻</span>
          </button>
          <button
            className={`mode-btn ${view === 'defense' ? 'active' : ''}`}
            onClick={() => onView('defense')}
            aria-label="守方视角"
          >
            <span className="mode-view-long">守方视角</span>
            <span className="mode-view-short" aria-hidden="true">守</span>
          </button>
        </div>
        <button className="fullscreen-btn" onClick={toggleFullscreen} title="全屏 / 退出全屏">
          <IconFullscreen size={16} />
        </button>
        <ShortcutHelp compact />
        <button className="tactical-btn" onClick={onOpenTactical} title="战术板：导出 / 保存阶段战术">
          <span className="tactical-label-long">战术板</span>
          <span className="tactical-label-short" aria-hidden="true">板</span>
        </button>
      </div>
    </header>
  )
}
