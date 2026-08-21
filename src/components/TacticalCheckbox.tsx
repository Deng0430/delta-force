interface TacticalCheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  ariaLabel?: string
}

/**
 * 与正式版地图分层一致的战术复选框。
 * 原生 input 保留键盘、表单与无障碍语义，SVG 只负责视觉呈现。
 */
export default function TacticalCheckbox({ checked, onChange, disabled = false, ariaLabel }: TacticalCheckboxProps) {
  return (
    <span className="tactical-checkbox">
      <input
        type="checkbox"
        className="cb-native"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={`cb-box${checked ? ' checked' : ''}`} aria-hidden="true">
        <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {checked ? <path d="M2 6.5 4.8 9 10 3.6" /> : null}
        </svg>
      </span>
    </span>
  )
}
