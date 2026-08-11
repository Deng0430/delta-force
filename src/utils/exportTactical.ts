/**
 * 战术板导出工具（第二十一轮）：
 * 将当前 地图×视角 的战术布置（绘制/载具/兵棋/据点/区域/复活点/道具）导出为
 * 自包含 HTML 战术板：内嵌 Leaflet（CDN）+ 全部图层数据 + 图片转 base64 内联。
 * 打开后可自由缩放/平移查看细节，支持浏览器打印。
 * 图片内联失败时回退原 URL（HTML 需联网加载瓦片，网络环境下同样可用）。
 */
import type {
  MapConfig,
  OperatorConnection,
  OperatorUnit,
  PropVisibility,
  Side,
  StageConfig,
  TacticalRoute,
  TeamMarker,
  VehicleItem,
} from '../types'
import { platform } from '../platform'
import { POINT_ICON_BASE } from '../config/points'
import { TEAMS } from '../config/operators'

/** HTML 转义（导出标题/标注用；本地实现避免引入 Leaflet 依赖链） */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 阵营色（与主应用一致） */
const SIDE_COLOR = {
  own: { bright: '#01ff84', deep: '#067a4e' },
  enemy: { bright: '#e0453a', deep: '#a02a22' },
} as const

export interface ExportParams {
  config: MapConfig
  mapName: string
  view: Side
  /** 当前阶段 / 全部阶段 */
  stageMode: 'current' | 'all'
  capturedStageIndex: number
  stages: StageConfig[]
  /** 当前视角绘制 GeoJSON 字符串 */
  geoJson: string
  /** 当前视角载具桶 */
  vehicles: VehicleItem[]
  /** 当前视角兵棋干员桶（含双方） */
  operators: OperatorUnit[]
  /** 当前视角兵棋协同关系 */
  connections: OperatorConnection[]
  /** 当前视角兵棋队标（含双方，第二十三轮） */
  teams: TeamMarker[]
  /** 当前视角队伍进攻路线 */
  routes: TacticalRoute[]
  /** 道具是否显示 + 按类型开关 */
  showProps: boolean
  propVis: PropVisibility
  /** 已按 propVis 过滤的道具列表（App 从 MAP_PROPS 提取） */
  propsList: { name: string; icon: string; lat: number; lng: number; stage: string }[]
}

/** 收集全部图片 URL（载具/职业/据点/复活点/道具），返回 base64 映射 */
async function collectImages(p: ExportParams): Promise<Record<string, string>> {
  const urls = new Set<string>()
  for (const v of p.vehicles) {
    if (v.iconUrl && !v.iconUrl.startsWith('data:')) urls.add(v.iconUrl)
  }
  for (const op of p.operators) {
    urls.add(opIconUrl(op))
  }
  const stages = p.stageMode === 'all' ? p.stages : p.stages.slice(0, p.capturedStageIndex + 1)
  const curStage = p.stages[p.capturedStageIndex]
  for (const st of stages) {
    for (const pt of st.points) urls.add(`${POINT_ICON_BASE}/${pt.icon}.png`)
  }
  if (curStage) {
    curStage.attackSpawns.forEach(() => urls.add(`${POINT_ICON_BASE}/g_jdbsd_g.png`))
    curStage.attackSpawns.forEach(() => urls.add(`${POINT_ICON_BASE}/g_jdbsd_r.png`))
    curStage.defenseSpawns.forEach(() => urls.add(`${POINT_ICON_BASE}/f_jdbsd_g.png`))
    curStage.defenseSpawns.forEach(() => urls.add(`${POINT_ICON_BASE}/f_jdbsd_r.png`))
  }
  if (p.showProps) {
    for (const pr of p.propsList) urls.add(`${POINT_ICON_BASE}/${pr.icon}.png`)
  }
  const map: Record<string, string> = {}
  const tasks: Promise<void>[] = []
  for (const u of urls) {
    tasks.push(
      fetch(u)
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('bad status'))))
        .then((b) => {
          const fr = new FileReader()
          return new Promise<string>((resolve) => {
            fr.onload = () => resolve(String(fr.result))
            fr.onerror = () => resolve('')
            fr.readAsDataURL(b)
          })
        })
        .then((data) => {
          if (data) map[u] = data
        })
        .catch(() => {
          /* 内联失败：HTML 端回退原 URL */
        }),
    )
  }
  await Promise.all(tasks)
  return map
}

/** 干员职业图标 URL */
function opIconUrl(op: OperatorUnit): string {
  const clsMap: Record<string, string> = {
    assault: 'cls_assault.png',
    engineer: 'cls_engineer.png',
    medical: 'cls_support.png',
    recon: 'cls_recon.png',
  }
  return `/icons/operators/${clsMap[op.cls] ?? 'cls_assault.png'}`
}

/** 道具主题色（与 MapPropsLayer 一致） */
const PROP_COLOR: Record<string, string> = {
  载具补给站: '#2f6fed',
  固定防空炮: '#e0453a',
  固定机枪: '#f08c2a',
  岸防炮: '#d63f3f',
  滑索: '#2ec4b6',
  电梯: '#8b98ab',
  固定弹药箱: '#f4cf67',
}

/**
 * 生成自包含 HTML 战术板。
 * 图片映射 dataUrlByUrl：url → base64 data URI；缺失时 HTML 端用原 url。
 */
export async function buildTacticalHtml(p: ExportParams): Promise<string> {
  const imgs = await collectImages(p)

  // 需要传给 HTML 的道具列表（按 propVis 开启项）
  const stageList = p.stageMode === 'all' ? p.stages : p.stages.slice(0, p.capturedStageIndex + 1)

  const viewLabel = p.view === 'attack' ? '攻方' : '守方'
  const rangeLabel = p.stageMode === 'current' ? `当前阶段（${p.stages[p.capturedStageIndex]?.id ?? '-'}）` : '全部阶段'

  // 序列化数据（图片映射中 data URI 可能很大，但 JSON 内嵌没问题；转义 < 防止 </script> 截断）
  const data = JSON.stringify({
    config: p.config,
    view: p.view,
    stageMode: p.stageMode,
    capturedStageIndex: p.capturedStageIndex,
    stages: stageList.map((s) => s),
    geoJson: p.geoJson,
    vehicles: p.vehicles,
    operators: p.operators,
    connections: p.connections,
    teams: p.teams,
    routes: p.routes,
    showProps: p.showProps,
    propVis: p.propVis,
    propsList: p.propsList,
    propColor: PROP_COLOR,
    imgs,
  }).replace(/</g, '\\u003c')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>战术板 · ${escapeHtml(p.mapName)} · ${viewLabel}视角</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>
  html, body { margin: 0; height: 100%; background: #0e1112; font-family: "Microsoft YaHei", system-ui, sans-serif; }
  #map { width: 100vw; height: 100vh; background: #0e1112; }
  .board-head { position: fixed; top: 10px; left: 50%; transform: translateX(-50%); z-index: 1000;
    background: rgba(14,17,18,.92); border: 1px solid #2b3135; border-radius: 4px; color: #eaebeb;
    font-size: 12px; padding: 6px 14px; display: flex; gap: 14px; align-items: center; box-shadow: 0 2px 10px rgba(0,0,0,.5); }
  .board-head b { color: #01ff84; }
  .board-actions { display: flex; gap: 5px; margin-left: 2px; }
  .board-actions button { height: 25px; padding: 0 8px; border: 1px solid #3b454b; border-radius: 3px;
    color: #d8dcde; background: #171d20; cursor: pointer; font: inherit; }
  .board-actions button:hover { color: #01ff84; border-color: #01ff84; }
  .board-legend { position: fixed; bottom: 14px; left: 14px; z-index: 1000; background: rgba(14,17,18,.88);
    border: 1px solid #2b3135; border-radius: 4px; color: #c9ced1; font-size: 11px; padding: 8px 10px; line-height: 1.8; }
  .board-legend .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; vertical-align: -1px; }
  .board-hint { position: fixed; bottom: 14px; right: 14px; z-index: 1000; color: #6d7377; font-size: 11px;
    background: rgba(14,17,18,.7); border: 1px solid #2b3135; border-radius: 4px; padding: 4px 8px; }
  .leaflet-container { font: inherit; }
  /* ---------- 兵棋干员（精简版，与主应用一致） ---------- */
  .op-marker { position: relative; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; border-radius: 50%;
    border: 1px solid rgba(14,17,18,.7); box-shadow: 0 1px 4px rgba(0,0,0,.55); }
  .op-marker .op-side-ring { position: absolute; inset: -3px; border-radius: 50%; border: 2px solid var(--op-side);
    box-shadow: 0 0 6px 1px var(--op-side), inset 0 0 3px var(--op-side); pointer-events: none; z-index: 0; }
  .op-marker .op-team-bg { position: absolute; inset: 0; border-radius: 50%;
    background: linear-gradient(135deg, var(--op-team) 0%, var(--op-team-dark) 100%); opacity: .95; pointer-events: none; }
  .op-marker .op-cls-main { width: 13px; height: 13px; object-fit: contain;
    filter: brightness(0) invert(1) drop-shadow(0 0 2px rgba(0,0,0,.55)); z-index: 1; pointer-events: none; }
  .op-marker .op-code { position: absolute; top: -14px; left: 50%; transform: translateX(-50%); font-size: 11px; font-weight: 700;
    color: var(--op-team); background: rgba(14,17,18,.92); border: 1px solid var(--op-team); border-radius: 2px; padding: 0 3px;
    line-height: 1.3; white-space: nowrap; }
  .op-marker .op-name { position: absolute; bottom: -14px; left: 50%; transform: translateX(-50%); font-size: 11px; font-weight: 700;
    color: var(--op-team); text-shadow: 0 1px 1px rgba(0,0,0,.95), 1px 0 1px rgba(0,0,0,.9), -1px 0 1px rgba(0,0,0,.9), 0 -1px 1px rgba(0,0,0,.9);
    background: var(--op-side-deep); border: 1px solid var(--op-side); border-radius: 2px; padding: 0 3px; line-height: 1.3; white-space: nowrap; }
  .op-marker .op-status-dot { position: absolute; right: -1px; bottom: -1px; width: 8px; height: 8px; border-radius: 50%;
    background: var(--st, #01ff84); border: 2px solid var(--bg0, #0e1112); box-shadow: 0 0 3px rgba(0,0,0,.6), 0 0 5px var(--st, #01ff84); }
  /* ---------- 载具卡片（精简版） ---------- */
  .veh-marker { position: relative; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; }
  .veh-marker .veh-side-ring { position: absolute; inset: -4px; background: transparent;
    filter: drop-shadow(0 0 2px var(--vc)) drop-shadow(0 0 5px var(--vc)); pointer-events: none; z-index: 0; }
  .veh-marker .veh-side-ring::before { content: ''; position: absolute; inset: 0; background: var(--vc);
    clip-path: polygon(29.3% 0,70.7% 0,100% 29.3%,100% 70.7%,70.7% 100%,29.3% 100%,0 70.7%,0 29.3%); }
  .veh-marker .veh-side-ring::after { content: ''; position: absolute; inset: 2px; background: rgba(8,13,15,.94);
    clip-path: polygon(29.3% 0,70.7% 0,100% 29.3%,100% 70.7%,70.7% 100%,29.3% 100%,0 70.7%,0 29.3%); box-shadow: inset 0 0 4px var(--vc); }
  .veh-marker .veh-bg { position: absolute; inset: 1px; background: var(--vf); clip-path: polygon(29.3% 0,70.7% 0,100% 29.3%,100% 70.7%,70.7% 100%,29.3% 100%,0 70.7%,0 29.3%); opacity: .9;
    box-shadow: 0 1px 5px rgba(0,0,0,.6); }
  .veh-marker .veh-icon { position: relative; z-index: 1; width: 72%; height: 72%; object-fit: contain;
    filter: drop-shadow(0 1px 2px rgba(0,0,0,.7)); }
  .veh-marker.no-legend .veh-icon { width: 80%; height: 80%; }
  .veh-marker .veh-name { position: absolute; bottom: -13px; left: 50%; transform: translateX(-50%); font-size: 8px; font-weight: 600;
    color: #fff; background: rgba(14,17,18,.85); border: 1px solid var(--vc); border-radius: 2px; padding: 0 3px;
    line-height: 1.4; white-space: nowrap; pointer-events: none; }
  /* ---------- 兵棋队标（第二十三轮） ---------- */
  .tm-marker { position: relative; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border-radius: 50%;
    border: 1px solid rgba(14,17,18,.7); box-shadow: 0 1px 4px rgba(0,0,0,.55); }
  .tm-marker .tm-side-ring { position: absolute; inset: -4px; border-radius: 50%; border: 2px solid var(--tm-side);
    box-shadow: 0 0 6px 1px var(--tm-side), inset 0 0 3px var(--tm-side); pointer-events: none; z-index: 0; }
  .tm-marker .tm-team-bg { position: absolute; inset: 0; border-radius: 50%;
    background: linear-gradient(135deg, var(--tm-team) 0%, var(--tm-team-dark) 100%); opacity: .95; pointer-events: none; }
  .tm-marker .tm-letter { position: relative; z-index: 1; font-size: 17px; font-weight: 800; color: #fff;
    text-shadow: 0 1px 2px rgba(0,0,0,.8); pointer-events: none; }
  .tm-marker .tm-name { position: absolute; top: -14px; left: 50%; transform: translateX(-50%); font-size: 11px; font-weight: 700;
    color: var(--tm-team); text-shadow: 0 1px 1px rgba(0,0,0,.95), 1px 0 1px rgba(0,0,0,.9), -1px 0 1px rgba(0,0,0,.9), 0 -1px 1px rgba(0,0,0,.9);
    background: var(--tm-side-deep); border: 1px solid var(--tm-side); border-radius: 2px; padding: 0 2px;
    line-height: 1.3; white-space: nowrap; pointer-events: none; }
  /* ---------- 据点 / 复活点 / 道具 ---------- */
  .cap-marker, .spawn-marker, .prop-marker { position: relative; display: flex; align-items: center; justify-content: center; }
  .cap-marker, .spawn-marker { transition: transform .14s ease, opacity .14s ease; }
  .cap-marker img, .spawn-marker img { width: 26px; height: 26px; object-fit: contain; z-index: 1; }
  .cap-marker.captured, .cap-marker.locked { opacity: .45; }
  .cap-marker:hover, .spawn-marker:hover { transform: scale(1.15); opacity: 1; }
  .cap-tag, .spawn-tag { position: absolute; top: -8px; left: 50%; transform: translateX(-50%); font-size: 9px; font-weight: 700;
    color: #fff; background: rgba(14,17,18,.85); border: 1px solid var(--c, #f4cf67); border-radius: 2px; padding: 0 3px;
    white-space: nowrap; pointer-events: none; }
  .prop-marker { width: 26px; height: 26px; }
  .prop-marker .prop-bg { position: absolute; inset: 1px; border-radius: 50%; background: var(--pc); opacity: .9; }
  .prop-marker img { width: 70%; height: 70%; object-fit: contain; z-index: 1; filter: drop-shadow(0 1px 2px rgba(0,0,0,.7)); }
  /* ---------- 绘制文字 ---------- */
  .text-marker-wrap { background: transparent; border: none; overflow: visible; }
  .text-marker { position: absolute; left: 0; top: 0; transform: translate(-50%, -50%); box-sizing: border-box;
    width: max-content; min-width: 96px; max-width: 320px; min-height: 34px; padding: 6px 10px; border-radius: 0;
    line-height: 1.3; white-space: pre-wrap; overflow-wrap: anywhere; pointer-events: none; }
  /* ---------- 箭头 marker ---------- */
  .arrow-head { pointer-events: none; }
  .route-order-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 5px; color: var(--rc);
    background: rgba(8,13,15,.92); border: 1px solid var(--rc); border-radius: 2px; font: 700 9px/1.2 sans-serif;
    box-shadow: 0 1px 5px rgba(0,0,0,.6); white-space: nowrap; }
  .route-waypoint { display:flex; align-items:center; justify-content:center; width:15px; height:15px; box-sizing:border-box;
    color:#fff; background:rgba(8,13,15,.94); border:1px solid var(--rwc); border-radius:50%; box-shadow:0 0 0 1px rgba(0,0,0,.8);
    font:800 8px/1 sans-serif; text-shadow:0 1px 1px #000; }
  .route-waypoint.origin { border-radius:2px; color:var(--rwa); }
  .route-waypoint.end { border-radius:2px; color:var(--rwa); }
  @media (max-width: 860px) { .board-head { left: 10px; right: 10px; transform: none; flex-wrap: wrap; } .board-head > span:nth-of-type(3) { display:none; } }
  @media print { .board-actions, .board-hint, .leaflet-control-container { display:none !important; } }
</style>
</head>
<body>
<div class="board-head">
  <b>${escapeHtml(p.mapName)}</b>
  <span>视角：${viewLabel}</span>
  <span>范围：${rangeLabel}</span>
  <span>导出时间：${new Date().toLocaleString('zh-CN')}</span>
  <div class="board-actions">
    <button type="button" onclick="map.fitBounds(bounds)">适应地图</button>
    <button type="button" onclick="document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()">全屏</button>
    <button type="button" onclick="window.print()">打印</button>
  </div>
</div>
<div class="board-legend">
  <div><span class="dot" style="background:#01ff84"></span>本方（${viewLabel === '攻方' ? '攻方' : '守方'}）</div>
  <div><span class="dot" style="background:#e0453a"></span>敌方</div>
  <div><span class="dot" style="background:#f4cf67"></span>中立 / 待争夺</div>
  <div><span class="dot" style="background:#2f6fed"></span>画笔 / 阵线</div>
</div>
<div class="board-hint">滚轮缩放 · 拖拽平移 · 底图与 Leaflet 资源需要联网加载</div>
<div id="map"></div>
<script>
const D = ${data};
const cfg = D.config;
const map = L.map('map', { crs: L.CRS.Simple, minZoom: cfg.minZoom, maxZoom: cfg.maxZoom, zoomControl: true, attributionControl: false });
const bounds = L.latLngBounds(cfg.southWest, cfg.northEast);
L.tileLayer(cfg.tileUrl, { bounds, minZoom: cfg.minZoom, maxZoom: cfg.maxZoom, maxNativeZoom: cfg.maxNativeZoom, tileSize: 256, noWrap: true }).addTo(map);
map.fitBounds(bounds);
map.setMaxBounds(bounds);
const img = (u) => D.imgs[u] || u;

/* ---------- 绘制箭头：与正式版一致，使用 SVG marker-end 直接挂在线段末端 ---------- */
const exportArrowMarkerCache = new Set();
const exportArrowSpec = (style) => {
  if (style === 'outline' || style === 'chevron') return { d: 'M 0 0 L 10 5 L 0 10', fill: 'none', stroke: true };
  if (style === 'triangle') return { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'currentColor', stroke: false };
  if (style === 'diamond') return { d: 'M 5 0 L 10 5 L 5 10 L 0 5 z', fill: 'currentColor', stroke: false };
  return { d: 'M 0 0 L 10 5 L 0 10 L 3.5 5 z', fill: 'currentColor', stroke: false };
};
const exportArrowMarkerId = (style, size, color) => 'board-arrow-' + String(style).replace(/[^a-z0-9_-]/gi, '') + '-' + size + '-' + String(color).replace(/[^a-z0-9]/gi, '');
const attachExportArrow = (line, props) => {
  const path = line.getElement();
  const svg = path && path.ownerSVGElement;
  if (!path || !svg) return;
  const style = String(props.arrowStyle || 'triangle');
  const size = Number(props.arrowSize || 12);
  const color = String(props.color || '#ffd54a');
  const id = exportArrowMarkerId(style, size, color);
  if (!exportArrowMarkerCache.has(id)) {
    const NS = 'http://www.w3.org/2000/svg';
    const defs = svg.querySelector('defs') || (() => { const d = document.createElementNS(NS, 'defs'); svg.appendChild(d); return d; })();
    const marker = document.createElementNS(NS, 'marker');
    marker.id = id;
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('refX', '9');
    marker.setAttribute('refY', '5');
    marker.setAttribute('markerWidth', String(size));
    marker.setAttribute('markerHeight', String(size));
    marker.setAttribute('markerUnits', 'userSpaceOnUse');
    marker.setAttribute('orient', 'auto');
    const spec = exportArrowSpec(style);
    const head = document.createElementNS(NS, 'path');
    head.setAttribute('d', spec.d);
    head.setAttribute('fill', spec.stroke ? 'none' : color);
    if (spec.stroke) {
      head.setAttribute('stroke', color);
      head.setAttribute('stroke-width', '1.6');
      head.setAttribute('stroke-linecap', 'round');
      head.setAttribute('stroke-linejoin', 'round');
    }
    marker.appendChild(head);
    defs.appendChild(marker);
    exportArrowMarkerCache.add(id);
  }
  path.setAttribute('marker-end', 'url(#' + id + ')');
};

/* ---------- 绘制图层 ---------- */
try {
  const fc = JSON.parse(D.geoJson || '{"type":"FeatureCollection","features":[]}');
  const dashOf = (d) => d === 'dashed' ? '10 6' : d === 'dotted' ? '2 5' : undefined;
  const styleOf = (props, isPolygon) => ({
    color: props.color || '#ffd54a', weight: (props.type === 'defense' && isPolygon) ? 0 : (props.weight || 4),
    dashArray: dashOf(props.dash), opacity: .9,
    fillColor: props.fillColor || props.color || '#ffd54a',
    fillOpacity: (props.type === 'rect' || props.type === 'circle') ? (props.fillEnabled === true ? .28 : 0) : (props.type === 'defense' && isPolygon ? .95 : 0),
  });
  const drawLayer = L.layerGroup().addTo(map);
  for (const f of (fc.features || [])) {
    const props = f.properties || {};
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'Point') {
      if (props.type === 'circle') {
        L.circle([g.coordinates[1], g.coordinates[0]], Object.assign({ radius: Number(props.radius || 100) }, styleOf(props, false))).addTo(drawLayer);
      } else if (props.type === 'text') {
        const esc = String(props.text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const fs = Number(props.fontSize || 16);
        const col = props.color || '#ffffff';
        const bg = props.bg && props.bg !== 'transparent' ? props.bg : 'transparent';
        const bw = Number(props.borderWidth || 0);
        const bs = bw > 0 && props.borderStyle && props.borderStyle !== 'none' ? props.borderStyle : 'solid';
        const bc = props.borderColor || col;
        const tw = Math.max(48, Number(props.textWidth || 160));
        const tr = Number(props.textRotation || 0);
        const css = 'color:' + col + ';background:' + bg + ';font-size:' + fs + 'px;font-weight:' + (props.fontWeight || 'normal') +
          ';font-style:' + (props.fontStyle || 'normal') + ';text-align:' + (props.textAlign || 'center') +
          (props.fontFamily ? ';font-family:' + props.fontFamily : '') +
          ';width:' + tw + 'px;max-width:none;transform:translate(-50%,-50%) rotate(' + tr + 'deg)' +
          ';border:' + (bw > 0 ? bw + 'px ' + bs + ' ' + bc : 'none');
        const html = '<div class="text-marker" style="' + css + '">' + esc + '</div>';
        L.marker([g.coordinates[1], g.coordinates[0]], { icon: L.divIcon({ className: 'text-marker-wrap', html, iconSize: [1, 1], iconAnchor: [0, 0] }), interactive: false }).addTo(drawLayer);
      }
      continue;
    }
    const coords = (g.type === 'LineString' || g.type === 'Polygon') ? g.coordinates : null;
    if (!coords) continue;
    const latlngs = g.type === 'Polygon' ? coords[0].map((c) => [c[1], c[0]]) : coords.map((c) => [c[1], c[0]]);
    if (props.type === 'rect' && g.type === 'Polygon') {
      L.polygon(latlngs, styleOf(props, true)).addTo(drawLayer);
    } else if (props.type === 'circle' && g.type === 'Polygon') {
      // 椭圆（第十五轮：圆形拉成椭圆后以多边形环存储）
      L.polygon(latlngs, styleOf(props, true)).addTo(drawLayer);
    } else if (props.type === 'defense' && g.type === 'Polygon') {
      // 防线三角：实心填充（战略地图风格）
      L.polygon(latlngs, styleOf(props, true)).addTo(drawLayer);
    } else if (props.type === 'arrow' && g.type === 'LineString' && latlngs.length >= 2) {
      const line = L.polyline(latlngs, styleOf(props, false)).addTo(drawLayer);
      attachExportArrow(line, props);
    } else {
      L.polyline(latlngs, styleOf(props, false)).addTo(drawLayer);
    }
  }
} catch (e) { console.error('绘制渲染失败', e); }

/* ---------- 队伍进攻路线 ---------- */
const routeTeamColor = ${JSON.stringify(Object.fromEntries(TEAMS.map((t) => [t.id, t.color])))};
(D.routes || []).forEach((route) => {
  if (!route.waypoints || route.waypoints.length < 2) return;
  const color = route.status === 'completed' ? '#7f888f' : route.status === 'cancelled' ? '#656b70' : (route.color || routeTeamColor[route.team] || '#f4cf67');
  const dash = route.lineStyle === 'dotted' ? '2 7' : route.lineStyle === 'dashed' ? '12 7' : undefined;
  const statusOpacity = route.status === 'cancelled' ? .35 : route.status === 'completed' ? .58 : route.status === 'planned' ? .72 : 1;
  L.polyline(route.waypoints, { color, weight: route.status === 'executing' ? 5 : 4, opacity: (route.opacity || .92) * statusOpacity, dashArray: dash, interactive: false }).addTo(map);
  const end = route.waypoints[route.waypoints.length - 1];
  const prev = route.waypoints[route.waypoints.length - 2];
  if (route.orderType !== 'hold') {
    const deg = Math.atan2(-(end[0] - prev[0]), end[1] - prev[1]) * 180 / Math.PI;
    const arrow = '<span style="display:block;color:' + color + ';font-size:20px;line-height:20px;text-shadow:0 0 3px #000;transform:rotate(' + deg + 'deg)">▶</span>';
    L.marker(end, { icon: L.divIcon({ className: '', html: arrow, iconSize: [20, 20], iconAnchor: [10, 10] }), interactive: false, zIndexOffset: 720 }).addTo(map);
  }
  // 仅标出途经点；起点由部署单位表达，终点由路线箭头表达。
  route.waypoints.slice(1, -1).forEach((point, offset) => {
    const label = String(offset + 1);
    const html = '<span class="route-waypoint" style="--rwc:' + (routeTeamColor[route.team] || color) + ';--rwa:' + color + '">' + label + '</span>';
    L.marker(point, { icon: L.divIcon({ className: '', html, iconSize: [15, 15], iconAnchor: [7.5, 7.5] }), interactive: false, zIndexOffset: 710 }).addTo(map);
  });
  const labelPos = route.labelPosition || [(route.waypoints[0][0] + route.waypoints[1][0]) / 2, (route.waypoints[0][1] + route.waypoints[1][1]) / 2];
  const typeLabel = ({ move:'机动', attack:'进攻', recon:'侦察', flank:'迂回', retreat:'撤退', escort:'护送', resupply:'补给', hold:'防御' })[route.orderType] || route.orderType;
  const label = '<span class="route-order-badge" style="--rc:' + color + '">' + (route.orderType === 'hold' ? '◆ ' : '') + esc(route.team + '队 · ' + typeLabel) + '</span>';
  L.marker(labelPos, { icon: L.divIcon({ className: '', html: label, iconSize: [80, 18], iconAnchor: [40, 9] }), interactive: false }).addTo(map);
});

/* ---------- 兵棋协同关系 + 干员 ---------- */
if (D.operators && D.operators.length) {
  const byUid = {}; D.operators.forEach((o) => { byUid[o.uid] = o; });
  const connLayer = L.layerGroup().addTo(map);
  (D.connections || []).forEach((c) => {
    const a = byUid[c.operatorAId], b = byUid[c.operatorBId];
    if (!a || !b || a.lat == null || b.lat == null) return;
    const own = a.side === D.view;
    const relationColor = own ? '#01ff84' : '#e0453a';
    L.polyline([[a.lat, a.lng], [b.lat, b.lng]], { color: relationColor, weight: 1.8, opacity: .58,
      dashArray: '2 7', lineCap: 'round', interactive: false }).addTo(connLayer);
    const middle = [(a.lat + b.lat) / 2, (a.lng + b.lng) / 2];
    const relationHtml = '<span title="协同关系：' + esc(a.name) + ' ↔ ' + esc(b.name) + '" style="display:flex;align-items:center;justify-content:center;width:14px;height:14px;box-sizing:border-box;color:' + relationColor + ';background:rgba(8,13,15,.9);border:1px solid currentColor;border-radius:50%;font:800 8px/1 sans-serif">协</span>';
    L.marker(middle, { icon: L.divIcon({ className: '', html: relationHtml, iconSize: [16, 16], iconAnchor: [8, 8] }), interactive: false }).addTo(connLayer);
  });
  const opLayer = L.layerGroup().addTo(map);
  const teamColor = ${JSON.stringify(Object.fromEntries(TEAMS.map((t) => [t.id, t.color])))};
  const clsImg = { assault: '/icons/operators/cls_assault.png', engineer: '/icons/operators/cls_engineer.png', medical: '/icons/operators/cls_support.png', recon: '/icons/operators/cls_recon.png' };
  D.operators.forEach((op) => {
    if (op.lat == null || op.lng == null) return;
    const own = op.side === D.view;
    const sc = own ? ${JSON.stringify(SIDE_COLOR.own)} : ${JSON.stringify(SIDE_COLOR.enemy)};
    const tc = teamColor[op.team] || '#8f9aa3';
    const statusColor = op.status === 'alive' ? '#01ff84' : op.status === 'injured' ? '#f4cf67' : '#7a8185';
    const html = '<div class="op-marker" style="--op-team:' + tc + ';--op-team-dark:' + darken(tc) + ';--op-side:' + sc.bright + ';--op-side-deep:' + sc.deep + ';--st:' + statusColor + '">'
      + '<span class="op-side-ring"></span><span class="op-team-bg"></span>'
      + '<img class="op-cls-main" src="' + img(clsImg[op.cls] || clsImg.assault) + '" draggable="false" />'
      + '<span class="op-code">' + esc(op.name) + '</span>'
      + '<span class="op-name">' + esc(op.name) + '</span>'
      + '<span class="op-status-dot" style="background:' + statusColor + '"></span></div>';
    L.marker([op.lat, op.lng], { icon: L.divIcon({ className: 'op-marker-wrap', html, iconSize: [22, 22], iconAnchor: [11, 11] }), interactive: false }).addTo(opLayer);
  });
  /* 兵棋通用队标：只表达队伍字母与归属。 */
  const tmLayer = L.layerGroup().addTo(map);
  (D.teams || []).forEach((tm) => {
    if (tm.lat == null || tm.lng == null) return;
    const own = tm.side === D.view;
    const sc = own ? ${JSON.stringify(SIDE_COLOR.own)} : ${JSON.stringify(SIDE_COLOR.enemy)};
    const tc = teamColor[tm.team] || '#8f9aa3';
    const html = '<div class="tm-marker" style="--tm-team:' + tc + ';--tm-team-dark:' + darken(tc) + ';--tm-side:' + sc.bright + ';--tm-side-deep:' + sc.deep + '">'
      + '<span class="tm-side-ring"></span><span class="tm-team-bg"></span>'
      + '<span class="tm-letter">' + esc(tm.team) + '</span>'
      + '<span class="tm-name">' + esc(tm.name || '') + '</span></div>';
    L.marker([tm.lat, tm.lng], { icon: L.divIcon({ className: 'tm-wrap', html, iconSize: [30, 30], iconAnchor: [15, 15] }), interactive: false }).addTo(tmLayer);
  });
}

/* ---------- 载具 ---------- */
if (D.vehicles && D.vehicles.length) {
  const vehLayer = L.layerGroup().addTo(map);
  D.vehicles.forEach((v) => {
    const color = v.side === D.view ? '#01ff84' : '#e0453a';
    const legend = v.iconUrl && String(v.iconUrl).startsWith('data:');
    const cls = 'veh-marker' + (legend ? '' : ' no-legend');
    const rot = v.rotation ? 'transform:rotate(' + v.rotation + 'deg)' : '';
    const tc = v.team ? (routeTeamColor[v.team] || color) : color;
    const teamBadge = v.team ? '<span style="position:absolute;left:-5px;bottom:-5px;z-index:4;width:14px;height:14px;border-radius:50%;background:' + tc + ';border:1px solid #fff;color:#fff;font:800 8px/14px sans-serif;text-align:center">' + esc(v.team) + '</span>' : '';
    const html = '<div class="' + cls + '" style="--vc:' + color + ';--vf:' + tc + '">'
      + '<span class="veh-side-ring"></span><span class="veh-bg"></span>'
      + '<img class="veh-icon" src="' + img(v.iconUrl) + '" style="' + rot + '" draggable="false" />'
      + teamBadge
      + '<span class="veh-name">' + esc(v.name) + '</span></div>';
    L.marker([v.lat, v.lng], { icon: L.divIcon({ className: 'veh-marker-wrap', html, iconSize: [30, 30], iconAnchor: [15, 15] }), interactive: false }).addTo(vehLayer);
  });
}

/* ---------- 据点 / 区域 / 复活点 / 道具（静态层，按范围过滤） ---------- */
const staticLayer = L.layerGroup().addTo(map);
D.stages.forEach((st, idx) => {
  const status = idx < D.capturedStageIndex ? 'captured' : idx === D.capturedStageIndex ? 'active' : 'locked';
  const color = status === 'captured' ? (D.view === 'attack' ? '#01ff84' : '#e0453a') : status === 'active' ? '#f4cf67' : (D.view === 'attack' ? '#e0453a' : '#01ff84');
  // 防线区域（仅当前激活阶段）
  if (status === 'active' && st.zone) {
    L.polygon(st.zone.latlngs, { color, weight: 2.5, dashArray: '10 7', opacity: .9, fillColor: color, fillOpacity: 0, interactive: false }).addTo(staticLayer);
  }
  // 据点可占领区域（已解锁阶段）
  if (status !== 'locked') {
    (st.points || []).forEach((pt) => {
      if (pt.capturable && pt.capturable.length >= 3) {
        L.polygon(pt.capturable, { color, weight: status === 'active' ? 2.2 : 1.4, opacity: .85, fillColor: color, fillOpacity: status === 'active' ? .1 : .04, interactive: false }).addTo(staticLayer);
      }
    });
  }
  // 据点标记
  (st.points || []).forEach((pt) => {
    const html = '<div class="cap-marker ' + status + '" style="--c:' + color + '"><img src="' + img('${POINT_ICON_BASE}/' + pt.icon + '.png') + '" draggable="false" /><span class="cap-tag">' + esc(pt.name) + '</span></div>';
    L.marker([pt.lat, pt.lng], { icon: L.divIcon({ className: 'cap-marker-wrap', html, iconSize: [44, 52], iconAnchor: [22, 42] }), interactive: false }).addTo(staticLayer);
  });
});
// 复活点（当前激活阶段）
const curStage = D.stages[D.capturedStageIndex];
if (curStage) {
  // 当前阶段攻/守活动区：与正式版 ActivityZones 的阵营配色保持一致。
  const addActivityZone = (points, own) => {
    if (!points || points.length < 3) return;
    const color = own ? '#01ff84' : '#e0453a';
    L.polygon(points, { color, weight: 2, opacity: .9, dashArray: own ? undefined : '6 4',
      fillColor: color, fillOpacity: 0, interactive: false }).addTo(staticLayer);
  };
  addActivityZone(curStage.attackBaseZone, D.view === 'attack');
  addActivityZone(curStage.defenseBaseZone, D.view === 'defense');

  const ownAtk = D.view === 'attack';
  const spawnOwn = { icon: ownAtk ? 'g_jdbsd_g' : 'f_jdbsd_g', color: '#01ff84' };
  const spawnEnemy = { icon: ownAtk ? 'f_jdbsd_r' : 'g_jdbsd_r', color: '#e0453a' };
  (curStage.attackSpawns || []).forEach((pos, i) => {
    const t = D.view === 'attack' ? spawnOwn : spawnEnemy;
    const label = (curStage.attackSpawnNames || [])[i] || (D.view === 'attack' ? '己方复活点' : '敌方复活点');
    const html = '<div class="spawn-marker" style="--c:' + t.color + '"><img src="' + img('${POINT_ICON_BASE}/' + t.icon + '.png') + '" draggable="false" /><span class="spawn-tag">' + esc(label) + '</span></div>';
    L.marker([pos[0], pos[1]], { icon: L.divIcon({ className: 'spawn-marker-wrap', html, iconSize: [44, 52], iconAnchor: [22, 42] }), interactive: false }).addTo(staticLayer);
  });
  (curStage.defenseSpawns || []).forEach((pos, i) => {
    const t = D.view === 'defense' ? spawnOwn : spawnEnemy;
    const label = (curStage.defenseSpawnNames || [])[i] || (D.view === 'defense' ? '己方复活点' : '敌方复活点');
    const html = '<div class="spawn-marker" style="--c:' + t.color + '"><img src="' + img('${POINT_ICON_BASE}/' + t.icon + '.png') + '" draggable="false" /><span class="spawn-tag">' + esc(label) + '</span></div>';
    L.marker([pos[0], pos[1]], { icon: L.divIcon({ className: 'spawn-marker-wrap', html, iconSize: [44, 52], iconAnchor: [22, 42] }), interactive: false }).addTo(staticLayer);
  });
}

/* ---------- 道具（按 propVis 开启项） ---------- */
if (D.showProps && D.propsList && D.propsList.length) {
  (D.propsList || []).forEach((pr) => {
    if (!(D.propVis && D.propVis[pr.name] !== false)) return;
    const color = (D.propColor || {})[pr.name] || '#8b98ab';
    const html = '<div class="prop-marker" style="--pc:' + color + '"><span class="prop-bg"></span><img src="' + img('${POINT_ICON_BASE}/' + pr.icon + '.png') + '" draggable="false" /></div>';
    L.marker([pr.lat, pr.lng], { icon: L.divIcon({ className: 'prop-marker-wrap', html, iconSize: [26, 26], iconAnchor: [13, 13] }), interactive: false }).addTo(staticLayer);
  });
}

/* ---------- 辅助函数 ---------- */
function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function darken(hex, f) { f = f || .6; const m = String(hex).replace('#',''); if (m.length < 6) return hex;
  const r = Math.round(parseInt(m.slice(0,2),16)*f), g = Math.round(parseInt(m.slice(2,4),16)*f), b = Math.round(parseInt(m.slice(4,6),16)*f);
  return 'rgb(' + r + ',' + g + ',' + b + ')'; }
<\/script>
</body>
</html>`
}

/** 触发浏览器下载 */
export function downloadText(filename: string, text: string): void {
  void platform.downloadText(filename, text)
}
