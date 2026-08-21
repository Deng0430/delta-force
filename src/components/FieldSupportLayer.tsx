import { Fragment, useEffect, useState } from 'react'
import { Marker, Tooltip, useMap } from 'react-leaflet'
import * as L from 'leaflet'
import type { FieldSupportInstance, Side } from '../types'
import { platform } from '../platform'

interface Props {
  supports: FieldSupportInstance[]
  view: Side
  interactive: boolean
  onMove: (uid: string, lat: number, lng: number) => void
  onDelete: (uid: string) => void
}

const ownColor = '#01ff84'
const enemyColor = '#e0453a'

function iconFor(item: FieldSupportInstance, view: Side) {
  const color = item.side === view ? ownColor : enemyColor
  return L.divIcon({
    className: 'field-support-marker-wrap',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<div class="field-support-marker ${item.definitionId === 'vehicle-airdrop' ? 'vehicle-airdrop' : ''}" style="--support-color:${color}"><span class="field-support-glow"></span><img src="${item.iconUrl}" alt="${item.name}" draggable="false" /></div>`,
  })
}

export default function FieldSupportLayer({ supports, view, interactive, onMove, onDelete }: Props) {
  return <>{supports.map((item) => {
    const mobile = platform.kind === 'android'
    return <Fragment key={item.uid}>
      <FieldSupportMarker item={item} view={view} interactive={interactive} mobile={mobile} onMove={onMove} onDelete={onDelete} />
    </Fragment>
  })}</>
}

function FieldSupportMarker({ item, view, interactive, mobile, onMove, onDelete }: { item: FieldSupportInstance; view: Side; interactive: boolean; mobile: boolean; onMove: Props['onMove']; onDelete: Props['onDelete'] }) {
  const [expanded, setExpanded] = useState(false)
  const map = useMap()
  useEffect(() => {
    if (!mobile) return
    const closeFromMap = () => setExpanded(false)
    const closeFromSelection = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== item.uid) setExpanded(false)
    }
    map.on('click', closeFromMap)
    window.addEventListener('mobile-unit-selected', closeFromSelection)
    return () => { map.off('click', closeFromMap); window.removeEventListener('mobile-unit-selected', closeFromSelection) }
  }, [item.uid, map, mobile])
  const icon = mobile ? L.divIcon({ ...iconFor(item, view).options, html: `<div class="field-support-marker-wrap"><div class="field-support-marker ${item.definitionId === 'vehicle-airdrop' ? 'vehicle-airdrop' : ''} ${expanded ? 'expanded' : ''}" style="--support-color:${item.side === view ? ownColor : enemyColor}"><span class="field-support-glow"></span><img src="${item.iconUrl}" alt="${item.name}" draggable="false" />${expanded ? `<button class="field-support-delete-control danger" aria-label="删除阵地支援" onclick="event.stopPropagation();event.preventDefault();window.__fieldSupportDelete('${item.uid}')"><i class="fa-regular fa-trash-can"></i></button>` : ''}</div></div>` }) : iconFor(item, view)
  useEffect(() => {
    if (!mobile) return
    const target = window as typeof window & { __fieldSupportDelete?: (uid: string) => void; __fieldSupportDeleteHandlers?: Record<string, () => void> }
    if (!target.__fieldSupportDeleteHandlers) target.__fieldSupportDeleteHandlers = {}
    if (!target.__fieldSupportDelete) target.__fieldSupportDelete = (uid) => target.__fieldSupportDeleteHandlers?.[uid]?.()
    target.__fieldSupportDeleteHandlers[item.uid] = () => onDelete(item.uid)
    return () => { if (target.__fieldSupportDeleteHandlers) delete target.__fieldSupportDeleteHandlers[item.uid] }
  }, [item.uid, mobile, onDelete])
  return <Marker position={[item.lat, item.lng]} icon={icon} draggable={interactive} eventHandlers={{ click: (event) => { if (!mobile) return; L.DomEvent.stop(event.originalEvent); window.dispatchEvent(new CustomEvent('mobile-unit-selected', { detail: item.uid })); setExpanded((value) => !value) }, dragend: (event) => { const point = (event.target as L.Marker).getLatLng(); onMove(item.uid, point.lat, point.lng) }, contextmenu: mobile ? (event) => L.DomEvent.stop(event.originalEvent) : () => onDelete(item.uid) }}>
    {!mobile && <Tooltip direction="top" offset={[0, -18]}>{item.name} · {item.side === 'attack' ? '攻方' : '守方'} · 右键删除</Tooltip>}
  </Marker>
}
