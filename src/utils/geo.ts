import * as L from 'leaflet'
import type { FeatureCollection, Point } from 'geojson'
import type { MapConfig, TextAnnotation, TextStyleProps } from '../types'

/** 由地图配置构造 Leaflet 边界（CRS.Simple 坐标） */
export function mapBounds(cfg: MapConfig): L.LatLngBounds {
  return L.latLngBounds(cfg.southWest, cfg.northEast)
}

/** 生成唯一 ID */
let uidCounter = 0
export function genUid(prefix: string): string {
  uidCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${uidCounter.toString(36)}`
}

/** 空 GeoJSON FeatureCollection */
export function emptyGeoJson(): string {
  return JSON.stringify({ type: 'FeatureCollection', features: [] } satisfies FeatureCollection)
}

/**
 * 计算箭头头部三角形（屏幕像素等宽，不随缩放变化）。
 * 返回 [顶点, 左下角, 右下角] 三个经纬度。
 * 顶点位于绘制终点 end，翼点从 end 沿前进方向 ±150° 外扩（问题3：此前符号取反导致箭头反向）。
 */
export function computeArrowHead(
  map: L.Map,
  start: L.LatLng,
  end: L.LatLng,
  sizePx = 20,
): L.LatLng[] {
  const s = map.latLngToContainerPoint(start)
  const e = map.latLngToContainerPoint(end)
  const angle = Math.atan2(e.y - s.y, e.x - s.x)
  // 翼点 = 顶点 + sizePx * (cos/sin(angle ± 150°))，即向终点后侧两翼外扩
  const p1 = L.point(
    e.x + sizePx * Math.cos(angle + (5 * Math.PI) / 6),
    e.y + sizePx * Math.sin(angle + (5 * Math.PI) / 6),
  )
  const p2 = L.point(
    e.x + sizePx * Math.cos(angle - (5 * Math.PI) / 6),
    e.y + sizePx * Math.sin(angle - (5 * Math.PI) / 6),
  )
  return [end, map.containerPointToLatLng(p1), map.containerPointToLatLng(p2)]
}

/** 从画笔 GeoJSON 中提取文字标注 */
export function extractTextAnnotations(gj: string): TextAnnotation[] {
  try {
    const fc = JSON.parse(gj) as FeatureCollection
    const out: TextAnnotation[] = []
    for (const f of fc.features) {
      if (f.geometry?.type !== 'Point') continue
      const props = (f.properties ?? {}) as Record<string, unknown>
      if (props.type !== 'text') continue
      const coords = (f.geometry as Point).coordinates
      out.push({
        uid: String(props.uid ?? ''),
        text: String(props.text ?? ''),
        lat: coords[1],
        lng: coords[0],
      })
    }
    return out
  } catch {
    return []
  }
}

/** HTML 转义，防止标注内容破坏 divIcon */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 椭圆点集（第十五轮：圆形/椭圆以 48 点多边形近似存储与渲染，支持拉成椭圆）。
 * rx = 水平半轴（lng 方向），ry = 垂直半轴（lat 方向）。
 */
export function ellipsePoints(center: L.LatLng, rx: number, ry: number, n = 48): L.LatLng[] {
  const out: L.LatLng[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    out.push(L.latLng(center.lat + ry * Math.sin(a), center.lng + rx * Math.cos(a)))
  }
  return out
}

/** PPT 式文本框默认样式：透明填充、无边框，仅显示文字。 */
export const DEFAULT_TEXT_STYLE: Required<Pick<TextStyleProps, 'fontSize' | 'color' | 'backgroundColor' | 'fontWeight' | 'textAlign'>> & TextStyleProps = {
  fontSize: 16,
  color: '#ffffff',
  backgroundColor: 'transparent',
  borderColor: '#3f8cff',
  borderWidth: 0,
  borderStyle: 'none',
  fontWeight: 'normal',
  fontStyle: 'normal',
  textAlign: 'center',
  width: 160,
  rotation: 0,
}

/** 从特征属性读取文字样式（旧数据无字段时回退默认） */
export function textStyleFromProps(props: Record<string, unknown>): TextStyleProps {
  return {
    fontSize: Number(props.fontSize ?? DEFAULT_TEXT_STYLE.fontSize) || DEFAULT_TEXT_STYLE.fontSize,
    color: String(props.color ?? DEFAULT_TEXT_STYLE.color),
    backgroundColor:
      props.bg === 'transparent' || props.bg == null || props.bg === ''
        ? 'transparent'
        : String(props.bg),
    borderColor: props.borderColor != null ? String(props.borderColor) : DEFAULT_TEXT_STYLE.borderColor,
    borderWidth: props.borderWidth != null ? Number(props.borderWidth) : 0,
    borderStyle: (props.borderStyle as TextStyleProps['borderStyle']) ?? 'none',
    fontFamily: props.fontFamily != null && String(props.fontFamily) !== '' ? String(props.fontFamily) : undefined,
    fontWeight: (props.fontWeight as TextStyleProps['fontWeight']) ?? 'normal',
    fontStyle: (props.fontStyle as TextStyleProps['fontStyle']) ?? 'normal',
    textAlign: (props.textAlign as TextStyleProps['textAlign']) ?? 'center',
    width: Number(props.textWidth ?? DEFAULT_TEXT_STYLE.width) || DEFAULT_TEXT_STYLE.width,
    rotation: Number(props.textRotation ?? 0) || 0,
  }
}

/** 把文字样式合并回特征属性（存 GeoJSON，随保存落盘） */
export function textStyleToProps(props: Record<string, unknown>, s: TextStyleProps): void {
  props.fontSize = s.fontSize ?? DEFAULT_TEXT_STYLE.fontSize
  props.color = s.color ?? DEFAULT_TEXT_STYLE.color
  props.bg = s.backgroundColor && s.backgroundColor !== 'transparent' ? s.backgroundColor : 'transparent'
  props.borderColor = s.borderColor ?? null
  props.borderWidth = s.borderWidth ?? null
  props.borderStyle = s.borderStyle ?? 'none'
  props.fontFamily = s.fontFamily ?? ''
  props.fontWeight = s.fontWeight ?? 'normal'
  props.fontStyle = s.fontStyle ?? 'normal'
  props.textAlign = s.textAlign ?? 'center'
  props.textWidth = Math.max(48, Number(s.width ?? DEFAULT_TEXT_STYLE.width))
  props.textRotation = Number(s.rotation ?? 0)
}

/** PPT 式透明矩形文本框：所有可编辑样式均以内联样式实时反映。 */
export function textIcon(text: string, style?: TextStyleProps): L.DivIcon {
  const st = style ?? {}
  const fontSize = st.fontSize ?? DEFAULT_TEXT_STYLE.fontSize
  const color = st.color ?? DEFAULT_TEXT_STYLE.color
  const bg = st.backgroundColor && st.backgroundColor !== 'transparent' ? st.backgroundColor : 'transparent'
  const bw = st.borderWidth ?? 0
  const bs = bw > 0 && st.borderStyle && st.borderStyle !== 'none' ? st.borderStyle : 'solid'
  const bc = st.borderColor ?? color
  const width = Math.max(48, Number(st.width ?? DEFAULT_TEXT_STYLE.width))
  const rotation = Number(st.rotation ?? 0)
  const css = [
    `color:${color}`,
    `background:${bg}`,
    `border:${bw > 0 ? `${bw}px ${bs} ${bc}` : 'none'}`,
    `font-size:${fontSize}px`,
    `font-weight:${st.fontWeight ?? 'normal'}`,
    `font-style:${st.fontStyle ?? 'normal'}`,
    `text-align:${st.textAlign ?? 'center'}`,
    `width:${width}px`,
    'max-width:none',
    `transform:translate(-50%,-50%) rotate(${rotation}deg)`,
    st.fontFamily ? `font-family:${st.fontFamily}` : '',
  ]
    .filter(Boolean)
    .join(';')
  return L.divIcon({
    className: 'text-marker-wrap',
    html: `<div class="text-marker" style="${css}">${escapeHtml(text) || '标注'}</div>`,
    // 锚点只代表文本框中心；实际宽高由内容和字号决定。
    iconSize: [1, 1],
    iconAnchor: [0, 0],
  })
}
