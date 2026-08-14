/**
 * UI 图标集（问题5：UI 图标统一采用 SVG 绘制）
 * 线性描边风格，颜色继承 currentColor，尺寸可调。
 */

interface IconProps {
  size?: number
  className?: string
}

function Svg({
  size = 16,
  className,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/** 左箭头（收起面板） */
export function IconChevronLeft({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M10 3 5 8l5 5" />
    </Svg>
  )
}

/** 右箭头（展开面板） */
export function IconChevronRight({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M6 3l5 5-5 5" />
    </Svg>
  )
}

/** 下箭头（下拉展开） */
export function IconChevronDown({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M3 6l5 5 5-5" />
    </Svg>
  )
}

/** 全屏 */
export function IconFullscreen({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4" />
    </Svg>
  )
}

/** 关闭（×） */
export function IconClose({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Svg>
  )
}

/** 加号（部署/添加） */
export function IconPlus({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M8 2v12M2 8h12" />
    </Svg>
  )
}

/** 旋转（载具旋转提示） */
export function IconRotate({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M13 8a5 5 0 1 1-1.5-3.5" />
      <path d="M13 2v3h-3" />
    </Svg>
  )
}

/**
 * 锁定/解锁（绘制组件锁定）：美术资源/锁定.svg、解锁.svg，iconfont 1024×1024 填充式。
 * 与上方 16×16 描边图标风格不同，独立 svg 包装（fill="currentColor"）。
 */
function FillSvg({ size = 16, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 1024 1024" fill="currentColor" aria-hidden="true">
      {children}
    </svg>
  )
}

const LOCK_BODY_PATH =
  'M758.5 931h-497c-50.453 0-91.5-41.047-91.5-91.5v-335c0-50.453 41.047-91.5 91.5-91.5h497c50.453 0 91.5 41.047 91.5 91.5v335c0 50.453-41.047 91.5-91.5 91.5z m-497-454c-15.164 0-27.5 12.336-27.5 27.5v335c0 15.163 12.336 27.5 27.5 27.5h497c15.163 0 27.5-12.337 27.5-27.5v-335c0-15.164-12.337-27.5-27.5-27.5h-497z'
const LOCK_SHACKLE_PATH =
  'M512.1 791c-17.673 0-32-14.327-32-32V588.999c0-17.673 14.327-32 32-32 17.673 0 32 14.327 32 32V759c0 17.673-14.328 32-32 32zM297.472 446.595c-17.673 0-32-14.327-32-32 0-109.504 25.127-192.098 74.684-245.486 22.309-24.034 49.483-42.036 80.767-53.505 27.139-9.95 57.454-14.995 90.101-14.995 76.909 0 134.36 20.286 175.638 62.018 51.002 51.562 75.166 134.096 73.874 252.317-0.191 17.552-14.481 31.649-31.99 31.65-0.12 0-0.237 0-0.357-0.002-17.672-0.193-31.842-14.676-31.648-32.348 1.08-98.854-17.552-168.368-55.379-206.611-28.637-28.952-71.205-43.025-130.137-43.025-52.665 0-94.371 16.163-123.96 48.04-38.214 41.169-57.59 109.113-57.59 201.946-0.003 17.674-14.329 32.001-32.003 32.001z'
const UNLOCK_SHACKLE_PATH =
  'M512.1 791c-17.673 0-32-14.327-32-32V588.999c0-17.673 14.327-32 32-32 17.673 0 32 14.327 32 32V759c0 17.673-14.328 32-32 32zM297.472 446.595c-17.673 0-32-14.327-32-32 0-109.504 25.127-192.098 74.684-245.486 22.309-24.034 49.483-42.036 80.767-53.505 27.139-9.95 57.454-14.995 90.101-14.995 64.215 0 114.448 14.036 153.567 42.911 22.108 16.319 40.617 37.577 55.012 63.183 14.526 25.841 25.306 56.97 32.037 92.523 3.288 17.365-8.124 34.106-25.488 37.395-17.363 3.291-34.106-8.123-37.395-25.488-19.446-102.703-72.6-146.523-177.733-146.523-52.665 0-94.371 16.163-123.96 48.04-38.214 41.169-57.59 109.113-57.59 201.946-0.002 17.674-14.329 31.999-32.002 31.999z'

/** 锁定（绘制组件锁定） */
export function IconLock({ size, className }: IconProps) {
  return (
    <FillSvg size={size} className={className}>
      <path d={LOCK_BODY_PATH} />
      <path d={LOCK_SHACKLE_PATH} />
    </FillSvg>
  )
}

/** 解锁（绘制组件解锁） */
export function IconUnlock({ size, className }: IconProps) {
  return (
    <FillSvg size={size} className={className}>
      <path d={LOCK_BODY_PATH} />
      <path d={UNLOCK_SHACKLE_PATH} />
    </FillSvg>
  )
}

interface CheckboxProps {
  checked: boolean
  indeterminate?: boolean
  onChange: (v: boolean) => void
  label?: string
  className?: string
  disabled?: boolean
}

/**
 * 地图分层勾选框（问题2）：
 * 内部保留原生 <input type="checkbox">（交互/键盘/焦点行为与原生完全一致），
 * 外观使用 SVG 绘制的勾选框（隐藏原生控件，显示自定义方块 + SVG 对勾），与官网暗色风格统一。
 */
export function Checkbox({ checked, indeterminate = false, onChange, label, className, disabled }: CheckboxProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate
  }, [indeterminate])
  return (
    <label className={`layer-item ${disabled ? 'disabled' : ''} ${className ?? ''}`}>
      <input
        type="checkbox"
        className="cb-native"
        ref={inputRef}
        checked={checked}
        aria-checked={indeterminate ? 'mixed' : checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={`cb-box ${checked ? 'checked' : ''} ${indeterminate ? 'indeterminate' : ''}`} aria-hidden="true">
        <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {checked ? <path d="M2 6.5 4.8 9 10 3.6" /> : indeterminate ? <path d="M2.5 6h7" /> : null}
        </svg>
      </span>
      {label && <span className="layer-label">{label}</span>}
    </label>
  )
}
import { useEffect, useRef } from 'react'
