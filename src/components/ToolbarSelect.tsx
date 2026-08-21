import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { platform } from '../platform'

export interface ToolbarSelectOption {
  value: string
  label: string
  disabled?: boolean
}

interface ToolbarSelectProps<TMenu extends string> {
  menu: TMenu
  label: string
  value: string
  options: ToolbarSelectOption[]
  openMenu: TMenu | null
  onOpenMenu: (menu: TMenu | null) => void
  onSelect?: (value: string) => void
  align?: 'left' | 'right'
  floating?: boolean
}

export default function ToolbarSelect<TMenu extends string>({
  menu, label, value, options, openMenu, onOpenMenu, onSelect, align = 'left', floating = false,
}: ToolbarSelectProps<TMenu>) {
  const open = openMenu === menu
  const menuId = `toolbar-${menu}-menu`
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [menuPosition, setMenuPosition] = useState<CSSProperties>({})

  useLayoutEffect(() => {
    if (!open || (!floating && platform.kind !== 'android')) return
    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (!rect) return
      const triggerWidth = Math.max(1, Math.round(rect.width))
      const contentWidth = Math.max(...options.map((option) => Array.from(option.label).length), 1) * 14 + 28
      const menuWidth = Math.min(Math.max(triggerWidth, contentWidth), window.innerWidth - 12)
      const preferredLeft = align === 'right' ? rect.right - menuWidth : rect.left
      const left = Math.min(Math.max(6, preferredLeft), window.innerWidth - menuWidth - 6)
      setMenuPosition({
        position: 'fixed',
        top: rect.bottom + 4,
        left,
        width: menuWidth,
        minWidth: menuWidth,
        maxWidth: menuWidth,
      })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    window.visualViewport?.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      window.visualViewport?.removeEventListener('resize', updatePosition)
    }
  }, [align, floating, open, options])

  return (
    <div className={`map-select topbar-select menu-${menu} ${open ? 'open' : ''}`}>
      <button ref={buttonRef} className="map-select-btn" onClick={() => onOpenMenu(open ? null : menu)} aria-haspopup="listbox" aria-expanded={open} aria-controls={menuId}>
        <span className="map-select-label">{label}</span>
        <span className="map-select-value">{value}</span>
        <i className="fa-solid fa-chevron-down" aria-hidden="true" />
      </button>
      {open ? <div id={menuId} className={`map-select-menu align-${align}`} role="listbox" style={menuPosition}>
        {options.map((option) => <button key={option.value} role="option" aria-selected={value === option.label} className={`map-select-item ${value === option.label ? 'active' : ''}`} disabled={option.disabled} onClick={() => {
          if (option.disabled) return
          onSelect?.(option.value)
          onOpenMenu(null)
        }}>{option.label}</button>)}
      </div> : null}
    </div>
  )
}
