import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ArrowHeadStyle, CurveStyle, DashType, DrawSettings, ToolMode } from '../types'
import { platform } from '../platform'

/** 画笔工具（图标化，Font Awesome） */
const DRAW_TOOLS: { mode: ToolMode; icon: string; label: string }[] = [
  { mode: 'pan', icon: 'fa-solid fa-mouse-pointer', label: '查看（拖动地图）' },
  { mode: 'pen', icon: 'fa-solid fa-paintbrush', label: '画笔（自由绘制）' },
  { mode: 'line', icon: 'fa-solid fa-minus', label: '直线（两点连线）' },
  { mode: 'arrow', icon: 'fa-solid fa-arrow-right-long', label: '箭头' },
  { mode: 'defense', icon: 'fa-solid fa-shield-halved', label: '防线（锯齿阵线）' },
  { mode: 'rect', icon: 'fa-regular fa-square', label: '矩形' },
  { mode: 'circle', icon: 'fa-regular fa-circle', label: '圆形' },
  { mode: 'text', icon: 'fa-solid fa-font', label: '文字标注' },
  { mode: 'lasso', icon: 'fa-solid fa-draw-polygon', label: '套索（圈选图形/载具/干员）' },
  { mode: 'eraser', icon: 'fa-solid fa-eraser', label: '橡皮擦（局部/整图擦除）' },
]

const DASH_OPTIONS: { value: DashType; label: string }[] = [
  { value: 'solid', label: '实线' },
  { value: 'dashed', label: '虚线' },
  { value: 'dotted', label: '点线' },
]

/** 线条路径样式（第二十二轮：直线/曲线/手绘，作用于 line/arrow/defense） */
const CURVE_OPTIONS: { value: CurveStyle; label: string }[] = [
  { value: 'straight', label: '直线' },
  { value: 'smooth', label: '曲线' },
  { value: 'freehand', label: '手绘' },
]

/** 画笔粗细范围（滑动调整，1-12px） */
const WEIGHT_MIN = 1
const WEIGHT_MAX = 12

/** 箭头头部形状选项（第十六轮：实心/空心/三角形） */
const ARROW_STYLES: { value: ArrowHeadStyle; label: string; icon: string }[] = [
  { value: 'solid', label: '实心箭头', icon: '➤' },
  { value: 'outline', label: '空心箭头', icon: '❯' },
  { value: 'triangle', label: '三角形箭头', icon: '▶' },
]

/** 箭头大小档位（小/中/大） */
const ARROW_SIZES: { value: number; label: string }[] = [
  { value: 8, label: '小' },
  { value: 12, label: '中' },
  { value: 18, label: '大' },
]

/** 快捷备选色（问题4：红/黄/蓝/绿，点击立即切换） */
const QUICK_COLORS = ['#ff4d4f', '#ffd54a', '#3f8cff', '#52c41a']

/** 绘制工具悬浮说明（鼠标悬停工具按钮时显示；第十六轮：图形选择/编辑能力常驻，点击已有图形即可选中） */
const TOOL_HINTS: Partial<Record<ToolMode, string>> = {
  pan: '拖动地图查看；点击图形选中编辑',
  pen: '按住拖拽自由绘制；点击图形选中编辑',
  line: '拖拽两点画直线；点击图形选中编辑',
  arrow: '拖拽画箭头；点击图形选中编辑箭头样式',
  defense: '防线（路径可选直线/曲线/手绘）',
  rect: '拖拽画矩形；点击图形选中编辑',
  circle: '拖拽画圆形；点击图形选中编辑',
  text: '点击放字，双击改字；点击文字选中改样式',
  eraser: '可调整笔头大小；支持笔迹局部擦除和触碰整图擦除',
  lasso: '拖拽圈选；拖选中图形/载具/干员移动，Delete 删除',
}

interface DrawBarProps {
  tool: ToolMode
  onTool: (t: ToolMode) => void
  onClearDraw: () => void
  onClearVehicles: () => void
  onClearAll: () => void
  dirty: boolean
  draw: DrawSettings
  onDrawChange: (d: DrawSettings) => void
  canUndo: boolean
  onUndo: () => void
  canRedo: boolean
  onRedo: () => void
  canDeleteSel: boolean
  onDeleteSelected: () => void
}

const isShapeTool = (tool: ToolMode) =>
  tool === 'pen' || tool === 'line' || tool === 'arrow' || tool === 'defense' || tool === 'rect' || tool === 'circle'

const hasSettings = (tool: ToolMode) => isShapeTool(tool) || tool === 'eraser'

/** 工具按钮：悬浮时显示说明气泡（tooltip），可选在按钮下方渲染气泡弹层（popover） */
function ToolButton({
  onClick,
  disabled,
  title,
  hint,
  active,
  danger,
  popover,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  title: string
  /** 悬浮说明（可选，与 title 相同则只显示一次） */
  hint?: string
  active?: boolean
  danger?: boolean
  /** 按钮下方气泡（如样式设置） */
  popover?: React.ReactNode
  children: React.ReactNode
}) {
  const tip = hint && hint !== title ? `${title}：${hint}` : title
  const anchorRef = useRef<HTMLDivElement>(null)
  const popoverOpen = popover !== undefined
  const [popoverPosition, setPopoverPosition] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!popoverOpen) return
    const updatePosition = () => {
      const anchor = anchorRef.current
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      const halfWidth = 130
      setPopoverPosition({
        left: Math.min(Math.max(rect.left + rect.width / 2, halfWidth), window.innerWidth - halfWidth),
        top: rect.bottom + 10,
      })
    }

    updatePosition()
    const scrollViewport = anchorRef.current?.closest('.toolbar-draw-scroll')
    window.addEventListener('resize', updatePosition)
    document.addEventListener('scroll', updatePosition, true)
    scrollViewport?.addEventListener('scroll', updatePosition)
    return () => {
      window.removeEventListener('resize', updatePosition)
      document.removeEventListener('scroll', updatePosition, true)
      scrollViewport?.removeEventListener('scroll', updatePosition)
    }
  }, [popoverOpen])

  return (
    <div className="toolbar-draw-btn" ref={anchorRef}>
      <button
        className={`draw-btn${active ? ' active' : ''}${danger ? ' danger' : ''}`}
        onClick={onClick}
        disabled={disabled}
        aria-label={title}
        title={tip}
      >
        {children}
        <span className="draw-tooltip" role="tooltip">
          {tip}
        </span>
      </button>
      {popoverOpen && popoverPosition
        ? createPortal(
            <div
              className="settings-popover toolbar-settings-popover"
              style={{ left: popoverPosition.left, top: popoverPosition.top }}
              onClick={(event) => event.stopPropagation()}
            >
              {popover}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

/**
 * 绘制工具栏（固定在顶部栏内）：
 * 工具选择 + 撤回/恢复 + 删除选中 + 清空载具/绘制/全部；
 * 工具说明为悬浮 tooltip；
 * 样式设置气泡：点击形状类工具（画笔/直线/箭头/矩形/圆形）时，
 * 自动在该工具按钮下方弹出颜色/粗细/线型设置（再点同一工具或点空白处关闭）。
 */
export default function DrawBar({
  tool,
  onTool,
  onClearDraw,
  onClearVehicles,
  onClearAll,
  dirty,
  draw,
  onDrawChange,
  canUndo,
  onUndo,
  canRedo,
  onRedo,
  canDeleteSel,
  onDeleteSelected,
}: DrawBarProps) {
  // 当前样式气泡挂载在哪个工具下方（形状类工具点击时打开）
  const [styleFor, setStyleFor] = useState<ToolMode | null>(null)

  // 工具变化时关闭气泡：外部可能直接切换工具（如部署载具后自动切回 pan），
  // 此时气泡若仍挂在旧工具下，其全屏关闭层会拦截地图鼠标事件（载具无法操作）。
  useEffect(() => {
    if (styleFor && (tool !== styleFor || !hasSettings(tool))) setStyleFor(null)
  }, [tool, styleFor])

  // 点击气泡外部任意位置关闭（document 级监听，避免用全屏 backdrop 拦截鼠标，
  // 否则点击地图/载具的第一次事件会被 backdrop 吃掉，表现为"载具无法操作"）
  useEffect(() => {
    if (!styleFor) return
    const onDocDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement
      if (!t.closest('.settings-popover') && !t.closest('.toolbar-draw-btn')) {
        setStyleFor(null)
      }
    }
    document.addEventListener('pointerdown', onDocDown)
    return () => document.removeEventListener('pointerdown', onDocDown)
  }, [styleFor])

  const handleTool = (t: ToolMode) => {
    onTool(t)
    if ((t === 'rect' || t === 'circle') && tool !== t) {
      onDrawChange({ ...draw, dash: 'solid' })
    }
    // 形状工具：点击就在该工具下方显示样式气泡；再次点击同一工具则切换关闭
    if (hasSettings(t)) {
      if (platform.kind === 'android' && tool !== t) {
        // 触控端第一次点击只选工具，避免设置面板遮住地图；再次点击才打开设置。
        setStyleFor(null)
      } else {
        setStyleFor((cur) => (cur === t ? null : t))
      }
    } else {
      setStyleFor(null)
    }
  }

  const scrollToolsWithWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const viewport = event.currentTarget
    if (viewport.scrollWidth <= viewport.clientWidth) return
    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX
    if (delta === 0) return
    viewport.scrollLeft += delta
    event.preventDefault()
  }

  /** 样式气泡内容（供挂载到对应工具按钮下方） */
  const stylePopover = tool === 'eraser' ? (
    <>
      <div className="ds-row">
        <span className="ds-label">笔头</span>
        <input
          type="range"
          className="ds-range"
          min={8}
          max={120}
          step={2}
          value={draw.eraserSize}
          onChange={(e) => onDrawChange({ ...draw, eraserSize: Number(e.target.value) })}
          title={`橡皮擦笔头：${draw.eraserSize}px`}
        />
        <span className="ds-range-val">{draw.eraserSize}px</span>
      </div>
      <div className="ds-row">
        <span className="ds-label">模式</span>
        <div className="ds-seg">
          <button
            className={`seg-btn ${draw.eraserMode === 'stroke' ? 'active' : ''}`}
            onClick={() => onDrawChange({ ...draw, eraserMode: 'stroke' })}
            title="仅擦除轨迹覆盖的线段"
          >
            笔迹擦除
          </button>
          <button
            className={`seg-btn ${draw.eraserMode === 'shape' ? 'active' : ''}`}
            onClick={() => onDrawChange({ ...draw, eraserMode: 'shape' })}
            title="轨迹触碰后删除整个图形"
          >
            图形擦除
          </button>
        </div>
      </div>
      <div className="ds-hint">
        {draw.eraserMode === 'stroke' ? '仅处理线条/箭头/手绘笔迹被覆盖的部分。' : '只要笔头触碰图形，就删除整个图形。'}
      </div>
    </>
  ) : (
    <>
      <div className="ds-row">
        <span className="ds-label">颜色</span>
        <input
          type="color"
          className="ds-color"
          value={draw.color}
          onChange={(e) => onDrawChange({ ...draw, color: e.target.value })}
          title="绘制颜色"
        />
        <span className="ds-color-val">{draw.color}</span>
      </div>
      <div className="ds-row">
        <span className="ds-label">快捷</span>
        <div className="ds-quick">
          {QUICK_COLORS.map((c) => (
            <button
              key={c}
              className={`quick-color ${draw.color.toLowerCase() === c ? 'active' : ''}`}
              style={{ background: c }}
              onClick={() => onDrawChange({ ...draw, color: c })}
              title={`快捷颜色 ${c}`}
              aria-label={`快捷颜色 ${c}`}
            />
          ))}
        </div>
      </div>
      <div className="ds-row">
        <span className="ds-label">粗细</span>
        <input
          type="range"
          className="ds-range"
          min={WEIGHT_MIN}
          max={WEIGHT_MAX}
          step={1}
          value={draw.weight}
          onChange={(e) => onDrawChange({ ...draw, weight: Number(e.target.value) })}
          title={`画笔粗细：${draw.weight}px`}
        />
        <span className="ds-range-val">{draw.weight}px</span>
      </div>
      {(tool === 'rect' || tool === 'circle') && (
        <>
          <div className="ds-row">
            <span className="ds-label">填充</span>
            <input
              type="color"
              className="ds-color"
              value={draw.fillColor}
              onChange={(e) => onDrawChange({ ...draw, fillColor: e.target.value, fillEnabled: true })}
              title="填充颜色"
            />
            <label className="tsp-check">
              <input
                type="checkbox"
                checked={!draw.fillEnabled}
                onChange={(e) => onDrawChange({ ...draw, fillEnabled: !e.target.checked })}
              />
              无填充
            </label>
          </div>
        </>
      )}
      {/* 线型（第十六轮：防线仅实线，隐藏选项） */}
      {tool !== 'defense' && (
        <div className="ds-row">
          <span className="ds-label">线型</span>
          <div className="ds-seg">
            {DASH_OPTIONS.map((d) => (
              <button
                key={d.value}
                className={`seg-btn ${draw.dash === d.value ? 'active' : ''}`}
                onClick={() => onDrawChange({ ...draw, dash: d.value })}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {/* 线条路径样式：直线/曲线/手绘（第二十二轮；曲线拖控制点调曲度，手绘按住自由画） */}
      {tool === 'line' || tool === 'arrow' || tool === 'defense' ? (
        <div className="ds-row">
          <span className="ds-label">路径</span>
          <div className="ds-seg">
            {CURVE_OPTIONS.map((c) => (
              <button
                key={c.value}
                className={`seg-btn ${draw.curve === c.value ? 'active' : ''}`}
                onClick={() => onDrawChange({ ...draw, curve: c.value })}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {/* 箭头专属：头部形状 + 大小（仅箭头工具显示） */}
      {tool === 'arrow' && (
        <>
          <div className="ds-row">
            <span className="ds-label">箭头</span>
            <div className="ds-seg">
              {ARROW_STYLES.map((a) => (
                <button
                  key={a.value}
                  className={`seg-btn ${draw.arrowStyle === a.value ? 'active' : ''}`}
                  onClick={() => onDrawChange({ ...draw, arrowStyle: a.value })}
                  title={a.label}
                  aria-label={a.label}
                >
                  {a.icon}
                </button>
              ))}
            </div>
          </div>
          <div className="ds-row">
            <span className="ds-label">大小</span>
            <div className="ds-seg">
              {ARROW_SIZES.map((s) => (
                <button
                  key={s.value}
                  className={`seg-btn ${draw.arrowSize === s.value ? 'active' : ''}`}
                  onClick={() => onDrawChange({ ...draw, arrowSize: s.value })}
                  title={`箭头大小：${s.label}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  )

  return (
    <div className="toolbar-draw">
      <div className="toolbar-draw-scroll" aria-label="绘制工具栏" onWheel={scrollToolsWithWheel}>
        {/* 工具选择 */}
        {DRAW_TOOLS.map((t) => (
          <ToolButton
            key={t.mode}
            onClick={() => handleTool(t.mode)}
            title={t.label}
            hint={TOOL_HINTS[t.mode]}
            active={tool === t.mode}
            popover={styleFor === t.mode ? stylePopover : undefined}
          >
            <i className={t.icon} aria-hidden="true" />
          </ToolButton>
        ))}

        <span className="toolbar-draw-divider" />

        {/* 撤回/恢复/删除选中 */}
        <ToolButton onClick={onUndo} disabled={!canUndo} title="撤回上一步操作（含载具）">
          <i className="fa-solid fa-rotate-left" aria-hidden="true" />
        </ToolButton>
        <ToolButton onClick={onRedo} disabled={!canRedo} title="恢复被撤回的操作">
          <i className="fa-solid fa-rotate-right" aria-hidden="true" />
        </ToolButton>
        <ToolButton onClick={onDeleteSelected} disabled={!canDeleteSel} title="删除选中的图形/载具">
          <i className="fa-solid fa-trash" aria-hidden="true" />
        </ToolButton>

        <span className="toolbar-draw-divider" />

        {/* 清除类操作 */}
        <ToolButton onClick={onClearVehicles} title="一键消除所有载具部署图标">
          <i className="fa-solid fa-truck-fast" aria-hidden="true" />
        </ToolButton>
        <ToolButton onClick={onClearDraw} title="清空本层绘制">
          <i className="fa-solid fa-broom" aria-hidden="true" />
        </ToolButton>
        <ToolButton onClick={onClearAll} danger title="一键清空本地图所有画笔和载具">
          <i className="fa-solid fa-trash-can" aria-hidden="true" />
        </ToolButton>

        {dirty ? <span className="toolbar-draw-dirty" title="有未保存的绘制内容">●</span> : null}
      </div>
    </div>
  )
}
