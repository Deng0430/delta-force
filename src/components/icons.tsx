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

interface CheckboxProps {
  checked: boolean
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
export function Checkbox({ checked, onChange, label, className, disabled }: CheckboxProps) {
  return (
    <label className={`layer-item ${disabled ? 'disabled' : ''} ${className ?? ''}`}>
      <input
        type="checkbox"
        className="cb-native"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={`cb-box ${checked ? 'checked' : ''}`} aria-hidden="true">
        <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 6.5 4.8 9 10 3.6" />
        </svg>
      </span>
      {label && <span className="layer-label">{label}</span>}
    </label>
  )
}
