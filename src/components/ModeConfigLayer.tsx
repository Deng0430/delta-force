import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Marker, Pane, Polygon, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import * as L from 'leaflet'
import type {
  ModeEditorSelection,
  ModeEditorSelectionItem,
  ModeEditorTool,
  ModeMapProp,
  ModeMapOverride,
  ModeObjectivePoint,
  ModeSpawnPoint,
  ModeZone,
  Side,
} from '../types'
import { escapeHtml } from '../utils/geo'
import { POINT_ICON_BASE } from '../config/points'

interface ModeConfigLayerProps {
  config: ModeMapOverride
  stageId: string
  view: Side
  editing: boolean
  zonesVisible: boolean
  spawnsVisible: boolean
  objectivesVisible: boolean
  propsVisible: boolean
  tool: ModeEditorTool
  selected: ModeEditorSelection
  selectedItems: ModeEditorSelectionItem[]
  zoneDraft: [number, number][]
  onSelect: (selection: ModeEditorSelection, options?: { additive?: boolean }) => void
  onZoneDraftChange: (points: [number, number][]) => void
  onAddSpawn: (point: [number, number]) => void
  onAddObjective: (point: [number, number]) => void
  onAddProp: (point: [number, number]) => void
  onMoveSpawn: (uid: string, point: [number, number]) => void
  onMoveObjective: (uid: string, point: [number, number]) => void
  onMoveProp: (uid: string, point: [number, number]) => void
  onMoveZone: (uid: string, points: [number, number][]) => void
  onMoveZoneVertex: (uid: string, index: number, point: [number, number]) => void
  onInsertZoneVertex: (uid: string, index: number, point: [number, number]) => void
  onRemoveZoneVertex: (uid: string, index: number) => void
}

const verificationText = { draft: '草稿', confirmed: '确认' } as const

function spawnIcon(spawn: ModeSpawnPoint, selected: boolean, own: boolean): L.DivIcon {
  const color = own ? '#01ff84' : '#e0453a'
  const suffix = own ? 'g' : 'r'
  const icon = `${spawn.side === 'attack' ? 'g' : 'f'}_jdbsd_${suffix}`
  const vehicle = spawn.vehicleDeploy ? '<i class="fa-solid fa-truck-fast" aria-hidden="true"></i>' : ''
  return L.divIcon({
    className: 'mode-config-spawn-wrap',
    html: `<div class="mode-config-spawn${selected ? ' selected' : ''}" style="--mode-spawn-color:${color}">
      <span class="mode-config-spawn-core"><img src="${POINT_ICON_BASE}/${icon}.png" draggable="false" /></span>
      <span class="mode-config-spawn-name">${escapeHtml(spawn.name)}</span>
      <span class="mode-config-spawn-meta">${vehicle}${verificationText[spawn.verification]}</span>
    </div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  })
}

function objectiveIcon(point: ModeObjectivePoint, selected: boolean): L.DivIcon {
  return L.divIcon({
    className: 'mode-config-objective-wrap',
    html: `<div class="cap-marker active${selected ? ' selected' : ''}" style="--c:#f4cf67">
      <img src="${POINT_ICON_BASE}/${escapeHtml(point.icon)}.png" draggable="false" />
      <span class="cap-tag">${escapeHtml(point.name)}</span>
    </div>`,
    iconSize: [44, 52],
    iconAnchor: [22, 42],
  })
}

const PROP_THEME: Record<string, { color: string; size: number }> = {
  载具补给站: { color: '#2f6fed', size: 28 },
  固定防空炮: { color: '#e0453a', size: 28 },
  固定机枪: { color: '#f08c2a', size: 26 },
  岸防炮: { color: '#d63f3f', size: 28 },
  滑索: { color: '#2ec4b6', size: 24 },
  电梯: { color: '#8b98ab', size: 24 },
  固定弹药箱: { color: '#f4cf67', size: 24 },
}

function propIcon(prop: ModeMapProp, selected: boolean): L.DivIcon {
  const theme = PROP_THEME[prop.name] ?? { color: '#8b98ab', size: 26 }
  return L.divIcon({
    className: `mode-config-prop-wrap${selected ? ' selected' : ''}`,
    html: `<div class="prop-marker" style="--pc:${theme.color}">
      <span class="prop-bg"></span>
      <img src="${POINT_ICON_BASE}/${escapeHtml(prop.icon)}.png" draggable="false" />
    </div>`,
    iconSize: [theme.size, theme.size],
    iconAnchor: [theme.size / 2, theme.size / 2],
  })
}

const vertexIconCache = new Map<number, L.DivIcon>()

function vertexIcon(index: number): L.DivIcon {
  const cached = vertexIconCache.get(index)
  if (cached) return cached
  const icon = L.divIcon({
    className: 'mode-config-vertex-wrap',
    html: `<div class="mode-config-vertex">${index + 1}</div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  })
  vertexIconCache.set(index, icon)
  return icon
}

const ZONE_EDGE_INSERT_TOLERANCE = 12

function closestPointOnSegment(point: L.Point, start: L.Point, end: L.Point): L.Point {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return start
  const ratio = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
  return L.point(start.x + dx * ratio, start.y + dy * ratio)
}

interface ZoneVertexMarkerProps {
  zoneUid: string
  index: number
  point: [number, number]
  map: L.Map
  canRemove: boolean
  onPreview: (uid: string, index: number, point: [number, number]) => void
  onMove: (uid: string, index: number, point: [number, number]) => void
  onRemove: (uid: string, index: number) => void
}

function ZoneVertexMarker({ zoneUid, index, point, map, canRemove, onPreview, onMove, onRemove }: ZoneVertexMarkerProps) {
  const markerRef = useRef<L.Marker | null>(null)
  const draggingRef = useRef(false)
  const dragPositionRef = useRef<[number, number]>(point)
  const restoreMapDragRef = useRef(false)

  useEffect(() => () => {
    if (restoreMapDragRef.current) map.dragging.enable()
  }, [map])

  useEffect(() => {
    const element = markerRef.current?.getElement()
    if (!element) return
    element.title = canRemove ? '右键删除顶点' : '区域至少需要保留 3 个顶点'
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault()
      event.stopImmediatePropagation()
      if (canRemove) onRemove(zoneUid, index)
    }
    element.addEventListener('contextmenu', handleContextMenu, true)
    return () => element.removeEventListener('contextmenu', handleContextMenu, true)
  }, [canRemove, index, onRemove, zoneUid])

  const eventHandlers = useMemo<L.LeafletEventHandlerFnMap>(() => ({
    add(event) {
      const element = (event.target as L.Marker).getElement()
      if (element) L.DomEvent.disableClickPropagation(element)
    },
    dragstart(event) {
      const latlng = (event.target as L.Marker).getLatLng()
      draggingRef.current = true
      dragPositionRef.current = [latlng.lat, latlng.lng]
      restoreMapDragRef.current = map.dragging.enabled()
      if (restoreMapDragRef.current) map.dragging.disable()
    },
    drag(event) {
      const latlng = (event.target as L.Marker).getLatLng()
      const nextPoint: [number, number] = [latlng.lat, latlng.lng]
      dragPositionRef.current = nextPoint
      onPreview(zoneUid, index, nextPoint)
    },
    dragend(event) {
      const latlng = (event.target as L.Marker).getLatLng()
      const finalPoint: [number, number] = [latlng.lat, latlng.lng]
      dragPositionRef.current = finalPoint
      onPreview(zoneUid, index, finalPoint)
      onMove(zoneUid, index, finalPoint)
      draggingRef.current = false
      if (restoreMapDragRef.current) map.dragging.enable()
      restoreMapDragRef.current = false
    },
    click(event) {
      L.DomEvent.stopPropagation(event.originalEvent)
    },
  }), [index, map, onMove, onPreview, zoneUid])

  const markerPosition = draggingRef.current ? dragPositionRef.current : point
  return (
    <Marker
      ref={markerRef}
      position={markerPosition}
      icon={vertexIcon(index)}
      draggable
      interactive
      bubblingMouseEvents={false}
      zIndexOffset={1200}
      eventHandlers={eventHandlers}
    />
  )
}

function DraftZoneVertexMarker({
  point,
  index,
  onRemove,
}: {
  point: [number, number]
  index: number
  onRemove: (index: number) => void
}) {
  const markerRef = useRef<L.Marker | null>(null)

  useEffect(() => {
    const element = markerRef.current?.getElement()
    if (!element) return
    element.title = '右键取消此顶点'
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault()
      event.stopImmediatePropagation()
      onRemove(index)
    }
    element.addEventListener('contextmenu', handleContextMenu, true)
    return () => element.removeEventListener('contextmenu', handleContextMenu, true)
  }, [index, onRemove])

  return (
    <Marker
      ref={markerRef}
      position={point}
      icon={vertexIcon(index)}
      interactive
      bubblingMouseEvents={false}
    />
  )
}

function ModeMapEvents({
  enabled,
  tool,
  zoneDraft,
  onSelect,
  onZoneDraftChange,
  onAddSpawn,
  onAddObjective,
  onAddProp,
}: Pick<
  ModeConfigLayerProps,
  'tool' | 'zoneDraft' | 'onSelect' | 'onZoneDraftChange' | 'onAddSpawn' | 'onAddObjective' | 'onAddProp'
> & { enabled: boolean }) {
  useMapEvents({
    click(event) {
      if (!enabled) return
      const point: [number, number] = [event.latlng.lat, event.latlng.lng]
      if (tool === 'zone') onZoneDraftChange([...zoneDraft, point])
      else if (tool === 'spawn') onAddSpawn(point)
      else if (tool === 'objective') onAddObjective(point)
      else if (tool === 'prop') onAddProp(point)
      else onSelect(null)
    },
  })
  return null
}

/** 放置工具启用时关闭地图平移，让左键点击始终归编辑器处理。 */
function ModeInteractionControl({ editing, tool }: { editing: boolean; tool: ModeEditorTool }) {
  const map = useMap()
  useEffect(() => {
    if (!editing || tool === 'select') return
    const restoreDragging = map.dragging.enabled()
    map.dragging.disable()
    return () => {
      if (restoreDragging) map.dragging.enable()
    }
  }, [editing, map, tool])
  return null
}

export default function ModeConfigLayer({
  config,
  stageId,
  view,
  editing,
  zonesVisible,
  spawnsVisible,
  objectivesVisible,
  propsVisible,
  tool,
  selected,
  selectedItems,
  zoneDraft,
  onSelect,
  onZoneDraftChange,
  onAddSpawn,
  onAddObjective,
  onAddProp,
  onMoveSpawn,
  onMoveObjective,
  onMoveProp,
  onMoveZone,
  onMoveZoneVertex,
  onInsertZoneVertex,
  onRemoveZoneVertex,
}: ModeConfigLayerProps) {
  const map = useMap()
  const zoneDragRef = useRef<{
    uid: string
    start: L.LatLng
    points: [number, number][]
    restoreMapDragging: boolean
  } | null>(null)
  const selectedKeys = useMemo(
    () => new Set((selectedItems.length > 0 ? selectedItems : selected ? [selected] : []).map((item) => `${item.kind}:${item.uid}`)),
    [selected, selectedItems],
  )
  const isSelected = useCallback((kind: ModeEditorSelectionItem['kind'], uid: string) => selectedKeys.has(`${kind}:${uid}`), [selectedKeys])
  const selectFromMouse = useCallback((selection: ModeEditorSelectionItem, event: L.LeafletMouseEvent) => {
    const source = event.originalEvent as MouseEvent
    onSelect(selection, { additive: source.ctrlKey || source.metaKey })
  }, [onSelect])
  const zoneLayerRefs = useRef(new Map<string, L.Polygon>())
  const spawnIcons = useMemo(
    () =>
      new Map(
        config.spawns.filter((spawn) => spawn.stageId === stageId).map((spawn) => [
          spawn.uid,
          spawnIcon(spawn, isSelected('spawn', spawn.uid), spawn.side === view),
        ]),
      ),
    [config.spawns, isSelected, stageId, view],
  )

  const selectedObjective = selected?.kind === 'objective'
    ? config.objectives.find((point) => point.uid === selected.uid) ?? null
    : null
  const selectedZone = selected?.kind === 'zone'
    ? config.zones.find((zone) => zone.uid === selected.uid && zone.stageId === stageId) ?? null
    : selectedObjective
      ? config.zones.find((zone) => zone.uid === selectedObjective.captureZoneUid) ?? null
      : null
  const stageZones = config.zones.filter((zone) => zone.stageId === stageId)
  const stageSpawns = config.spawns.filter((spawn) => spawn.stageId === stageId)
  const stageObjectives = config.objectives.filter((point) => point.stageId === stageId)
  const stageProps = config.props.filter((prop) => prop.stageId === '*' || prop.stageId === stageId)
  const selecting = editing && tool === 'select'
  const selectedEditableZone = selecting
    && selectedZone?.verification === 'draft'
    && selectedZone.points.length > 1
    ? selectedZone
    : null
  const captureZones = useMemo(() => new Map(config.zones.map((zone) => [zone.uid, zone])), [config.zones])

  const registerZoneLayer = useCallback((uid: string, layer: L.Polygon | null) => {
    if (layer) zoneLayerRefs.current.set(uid, layer)
    else zoneLayerRefs.current.delete(uid)
  }, [])

  const beginZoneDrag = useCallback((zone: ModeZone, event: L.LeafletMouseEvent) => {
    if (!selecting || zone.verification !== 'draft' || !isSelected('zone', zone.uid)) return
    L.DomEvent.stop(event.originalEvent)
    const restoreMapDragging = map.dragging.enabled()
    if (restoreMapDragging) map.dragging.disable()
    zoneDragRef.current = {
      uid: zone.uid,
      start: event.latlng,
      points: zone.points.map(([lat, lng]) => [lat, lng]),
      restoreMapDragging,
    }
  }, [isSelected, map, selecting])

  useEffect(() => {
    const preview = (event: L.LeafletMouseEvent) => {
      const drag = zoneDragRef.current
      if (!drag) return
      const dLat = event.latlng.lat - drag.start.lat
      const dLng = event.latlng.lng - drag.start.lng
      zoneLayerRefs.current.get(drag.uid)?.setLatLngs(drag.points.map(([lat, lng]) => [lat + dLat, lng + dLng]))
    }
    const finish = (event: L.LeafletMouseEvent) => {
      const drag = zoneDragRef.current
      if (!drag) return
      zoneDragRef.current = null
      const dLat = event.latlng.lat - drag.start.lat
      const dLng = event.latlng.lng - drag.start.lng
      if (drag.restoreMapDragging) map.dragging.enable()
      if (Math.abs(dLat) < 1e-7 && Math.abs(dLng) < 1e-7) return
      onMoveZone(drag.uid, drag.points.map(([lat, lng]) => [lat + dLat, lng + dLng]))
    }
    map.on('mousemove', preview)
    map.on('mouseup', finish)
    return () => {
      map.off('mousemove', preview)
      map.off('mouseup', finish)
      if (zoneDragRef.current?.restoreMapDragging) map.dragging.enable()
      zoneDragRef.current = null
    }
  }, [map, onMoveZone])

  const previewZoneVertex = useCallback((uid: string, index: number, point: [number, number]) => {
    const zone = config.zones.find((item) => item.uid === uid)
    const layer = zoneLayerRefs.current.get(uid)
    if (!zone || !layer) return
    layer.setLatLngs(zone.points.map((vertex, vertexIndex) => vertexIndex === index ? point : vertex))
  }, [config.zones])

  const removeDraftZoneVertex = useCallback((index: number) => {
    onZoneDraftChange(zoneDraft.filter((_, vertexIndex) => vertexIndex !== index))
  }, [onZoneDraftChange, zoneDraft])

  const insertZoneVertexAtEdge = useCallback((zone: ModeZone, event: L.LeafletMouseEvent) => {
    if (!selecting || zone.verification !== 'draft' || zone.points.length < 2) return

    const pointer = map.latLngToLayerPoint(event.latlng)
    let closestPoint: L.Point | null = null
    let closestDistance = Number.POSITIVE_INFINITY
    let insertIndex = 0

    zone.points.forEach((point, index) => {
      const nextPoint = zone.points[(index + 1) % zone.points.length]
      const start = map.latLngToLayerPoint(L.latLng(point[0], point[1]))
      const end = map.latLngToLayerPoint(L.latLng(nextPoint[0], nextPoint[1]))
      const candidate = closestPointOnSegment(pointer, start, end)
      const distance = pointer.distanceTo(candidate)
      if (distance < closestDistance) {
        closestDistance = distance
        closestPoint = candidate
        insertIndex = index + 1
      }
    })

    if (!closestPoint || closestDistance > ZONE_EDGE_INSERT_TOLERANCE) return
    L.DomEvent.stop(event.originalEvent)
    const latlng = map.layerPointToLatLng(closestPoint)
    onSelect({ kind: 'zone', uid: zone.uid })
    onInsertZoneVertex(zone.uid, insertIndex, [latlng.lat, latlng.lng])
  }, [map, onInsertZoneVertex, onSelect, selecting])

  return (
    <>
    <Pane name="mode-config" className="mode-config-pane" style={{ zIndex: 465 }}>
      <ModeInteractionControl editing={editing} tool={tool} />
      <ModeMapEvents
        enabled={editing}
        tool={tool}
        zoneDraft={zoneDraft}
        onSelect={onSelect}
        onZoneDraftChange={onZoneDraftChange}
        onAddSpawn={onAddSpawn}
        onAddObjective={onAddObjective}
        onAddProp={onAddProp}
      />

      {zonesVisible && selecting ? stageZones
        .filter((zone) => zone.verification === 'draft' && zone.points.length > 1 && zone.uid !== selectedEditableZone?.uid)
        .map((zone) => (
          <Polyline
            key={`${zone.uid}:edge-hit-area`}
            positions={[...zone.points, zone.points[0]]}
            className="mode-config-zone-edge-hit-area"
            pathOptions={{ color: zone.color, opacity: 0, weight: ZONE_EDGE_INSERT_TOLERANCE * 2 }}
            interactive
            bubblingMouseEvents={false}
            eventHandlers={{
              mousedown(event) {
                beginZoneDrag(zone, event)
              },
              click(event) {
                L.DomEvent.stopPropagation(event.originalEvent)
                selectFromMouse({ kind: 'zone', uid: zone.uid }, event)
              },
              dblclick(event) {
                insertZoneVertexAtEdge(zone, event)
              },
            }}
          />
        )) : null}

      {zonesVisible ? stageZones.map((zone: ModeZone) => {
        const active = isSelected('zone', zone.uid)
          || selectedObjective?.captureZoneUid === zone.uid
        const editable = selecting && zone.verification === 'draft'
        return (
          <Polygon
            key={zone.uid}
            ref={(layer) => registerZoneLayer(zone.uid, layer)}
            positions={zone.points}
            className={`mode-config-zone${active ? ' selected' : ''}${selecting ? ' selectable' : ''}${editable ? ' editable' : ''}`}
            pathOptions={{
              color: zone.color,
              weight: active ? 4 : 2,
              opacity: 1,
              fillColor: zone.color,
              fillOpacity: active ? 0.24 : 0.13,
              dashArray: zone.role === 'frontline' ? '10 7' : zone.verification === 'draft' ? '7 5' : undefined,
            }}
            interactive={selecting}
            bubblingMouseEvents={false}
            eventHandlers={{
              mousedown(event) {
                beginZoneDrag(zone, event)
              },
              click(event) {
                if (!selecting) return
                L.DomEvent.stopPropagation(event.originalEvent)
                selectFromMouse({ kind: 'zone', uid: zone.uid }, event)
              },
              dblclick(event) {
                insertZoneVertexAtEdge(zone, event)
              },
            }}
          >
            <Tooltip sticky>
              {zone.name} · {verificationText[zone.verification]}
              {selecting && zone.verification === 'draft' ? ' · 双击边界新增顶点 · 右键顶点删除' : ''}
            </Tooltip>
          </Polygon>
        )
      }) : null}

      {editing && tool === 'zone' && zoneDraft.length > 0 ? (
        <>
          <Polyline positions={zoneDraft} pathOptions={{ color: '#3f8cff', weight: 3, dashArray: '5 4' }} />
          {zoneDraft.map((point, index) => (
            <DraftZoneVertexMarker
              key={`${point[0]}:${point[1]}:${index}`}
              point={point}
              index={index}
              onRemove={removeDraftZoneVertex}
            />
          ))}
        </>
      ) : null}

    </Pane>
    <Pane name="mode-config-markers" className="mode-config-markers-pane" style={{ zIndex: 580 }}>

      {spawnsVisible ? stageSpawns.map((spawn) => (
        <Marker
          key={spawn.uid}
          position={[spawn.lat, spawn.lng]}
          icon={spawnIcons.get(spawn.uid)!}
          draggable={selecting && isSelected('spawn', spawn.uid) && spawn.verification === 'draft'}
          interactive={selecting}
          bubblingMouseEvents={false}
          eventHandlers={{
            click(event) {
              if (!selecting) return
              L.DomEvent.stopPropagation(event.originalEvent)
              selectFromMouse({ kind: 'spawn', uid: spawn.uid }, event)
            },
            dragend(event) {
              const latlng = event.target.getLatLng() as L.LatLng
              onMoveSpawn(spawn.uid, [latlng.lat, latlng.lng])
            },
          }}
        />
      )) : null}

      {objectivesVisible ? stageObjectives.map((point) => (
        <Marker
          key={point.uid}
          position={[point.lat, point.lng]}
          icon={objectiveIcon(point, isSelected('objective', point.uid))}
          draggable={selecting && isSelected('objective', point.uid) && point.verification === 'draft' && captureZones.get(point.captureZoneUid)?.verification === 'draft'}
          interactive={selecting}
          bubblingMouseEvents={false}
          zIndexOffset={580}
          eventHandlers={{
            click(event) {
              if (!selecting) return
              L.DomEvent.stopPropagation(event.originalEvent)
              selectFromMouse({ kind: 'objective', uid: point.uid }, event)
            },
            dragend(event) {
              const latlng = event.target.getLatLng() as L.LatLng
              onMoveObjective(point.uid, [latlng.lat, latlng.lng])
            },
          }}
        />
      )) : null}

      {propsVisible ? stageProps.map((prop) => (
        <Marker
          key={prop.uid}
          position={[prop.lat, prop.lng]}
          icon={propIcon(prop, isSelected('prop', prop.uid))}
          draggable={selecting && isSelected('prop', prop.uid) && prop.verification === 'draft'}
          interactive={selecting}
          bubblingMouseEvents={false}
          zIndexOffset={520}
          eventHandlers={{
            click(event) {
              if (!selecting) return
              L.DomEvent.stopPropagation(event.originalEvent)
              selectFromMouse({ kind: 'prop', uid: prop.uid }, event)
            },
            dragend(event) {
              const latlng = event.target.getLatLng() as L.LatLng
              onMoveProp(prop.uid, [latlng.lat, latlng.lng])
            },
          }}
        >
          <Tooltip sticky>{prop.name} · {verificationText[prop.verification]}</Tooltip>
        </Marker>
      )) : null}
    </Pane>
    <Pane name="mode-config-selected-zone" className="mode-config-selected-zone-pane" style={{ zIndex: 570 }}>
      {editing && zonesVisible && selectedEditableZone ? (
        <>
          <Polyline
            positions={[...selectedEditableZone.points, selectedEditableZone.points[0]]}
            pathOptions={{
              color: selectedEditableZone.color,
              opacity: 1,
              weight: 4,
              dashArray: selectedEditableZone.role === 'frontline' ? '10 7' : '7 5',
            }}
            interactive={false}
          />
          <Polyline
            positions={[...selectedEditableZone.points, selectedEditableZone.points[0]]}
            className="mode-config-zone-edge-hit-area selected"
            pathOptions={{ color: selectedEditableZone.color, opacity: 0, weight: ZONE_EDGE_INSERT_TOLERANCE * 2 }}
            interactive
            bubblingMouseEvents={false}
            eventHandlers={{
              mousedown(event) {
                beginZoneDrag(selectedEditableZone, event)
              },
              click(event) {
                L.DomEvent.stopPropagation(event.originalEvent)
                selectFromMouse({ kind: 'zone', uid: selectedEditableZone.uid }, event)
              },
              dblclick(event) {
                insertZoneVertexAtEdge(selectedEditableZone, event)
              },
            }}
          />
        </>
      ) : null}
    </Pane>
    <Pane name="mode-config-controls" className="mode-config-controls-pane" style={{ zIndex: 590 }}>
      {editing && zonesVisible && selectedZone?.verification === 'draft'
        ? selectedZone.points.map((point, index) => (
            <ZoneVertexMarker
              key={`${selectedZone.uid}:${index}`}
              zoneUid={selectedZone.uid}
              index={index}
              point={point}
              map={map}
              canRemove={selectedZone.points.length > 3}
              onPreview={previewZoneVertex}
              onMove={onMoveZoneVertex}
              onRemove={onRemoveZoneVertex}
            />
          ))
        : null}
    </Pane>
    </>
  )
}
