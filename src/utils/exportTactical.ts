/**
 * 战术板导出工具（第二十一轮）：
 * 将当前 地图×视角 的战术布置（绘制/载具/兵棋/据点/区域/复活点/道具）导出为
 * 自包含 HTML 战术板：内嵌 Leaflet（CDN）+ 全部图层数据 + 图片转 base64 内联。
 * 打开后可自由缩放/平移查看细节，支持将当前呈现导出为 PNG。
 * 图片内联失败时回退原 URL（HTML 需联网加载瓦片，网络环境下同样可用）。
 */
import type {
  MapConfig,
  BuildingUnit,
  OperatorConnection,
  OperatorUnit,
  PropVisibility,
  Side,
  StageConfig,
  TacticalRoute,
  TeamMarker,
  VehicleItem,
  FieldSupportInstance,
  OperatorSkillAction,
} from '../types'
import { platform } from '../platform'
import { POINT_ICON_BASE } from '../config/points'
import { TEAMS } from '../config/operators'
import { buildingUnitOf } from '../config/buildingUnits'
import { renderTacticalMarkdown } from './tacticalMarkdown'
import leafletJs from 'leaflet/dist/leaflet.js?raw'
import leafletCss from 'leaflet/dist/leaflet.css?raw'

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
  stageMode: 'current' | 'all' | 'overview'
  capturedStageIndex: number
  stages: StageConfig[]
  /** 当前视角绘制 GeoJSON 字符串 */
  geoJson: string
  /** 当前视角载具桶 */
  vehicles: VehicleItem[]
  buildings: BuildingUnit[]
  /** 当前视角兵棋干员桶（含双方） */
  operators: OperatorUnit[]
  /** 当前视角兵棋协同关系 */
  connections: OperatorConnection[]
  /** 当前视角兵棋队标（含双方，第二十三轮） */
  teams: TeamMarker[]
  /** 队伍名称（如主力突破），用于队标上方说明 */
  teamRoles?: Record<string, string>
  /** 当前视角队伍进攻路线 */
  routes: TacticalRoute[]
  fieldSupports?: FieldSupportInstance[]
  skillActions?: OperatorSkillAction[]
  /** 道具是否显示 + 按类型开关 */
  showProps: boolean
  propVis: PropVisibility
  /** 已按 propVis 过滤的道具列表（App 从 MAP_PROPS 提取） */
  propsList: { name: string; icon: string; lat: number; lng: number; stage: string }[]
  /** 当前阶段×回合的推演备注 Markdown。 */
  notesMarkdown?: string
  noteImages?: Record<string, string>
  snapshots?: Array<{
    key: string
    stageId: string
    round: number
    capturedStageIndex: number
    geoJson: string
    vehicles: VehicleItem[]
    buildings: BuildingUnit[]
    operators: OperatorUnit[]
    connections: OperatorConnection[]
    teams: TeamMarker[]
    routes: TacticalRoute[]
    fieldSupports?: FieldSupportInstance[]
    skillActions?: OperatorSkillAction[]
    notesMarkdown: string
  }>
}

/** 收集全部图片 URL（载具/职业/据点/复活点/道具），返回 base64 映射 */
async function collectImages(p: ExportParams): Promise<Record<string, string>> {
  const urls = new Set<string>()
  const allVehicles = [p.vehicles, ...(p.snapshots ?? []).map((snapshot) => snapshot.vehicles)].flat()
  const allOperators = [p.operators, ...(p.snapshots ?? []).map((snapshot) => snapshot.operators)].flat()
  const allBuildings = [p.buildings, ...(p.snapshots ?? []).map((snapshot) => snapshot.buildings)].flat()
  const allSkills = [p.skillActions ?? [], ...(p.snapshots ?? []).map((snapshot) => snapshot.skillActions ?? [])].flat()
  const allSupports = [p.fieldSupports ?? [], ...(p.snapshots ?? []).map((snapshot) => snapshot.fieldSupports ?? [])].flat()
  for (const v of allVehicles) {
    if (v.iconUrl && !v.iconUrl.startsWith('data:')) urls.add(v.iconUrl)
  }
  for (const op of allOperators) {
    urls.add(opIconUrl(op))
  }
  for (const building of allBuildings) urls.add(buildingUnitOf(building.kind).iconUrl)
  for (const skill of allSkills) urls.add(skill.iconUrl ?? `/icons/operators/skills/${skill.operatorId}/skill_${skill.skillSlot}.png`)
  for (const support of allSupports) if (support.iconUrl && !support.iconUrl.startsWith('data:')) urls.add(support.iconUrl)
  const stages = p.stageMode === 'current' ? p.stages.slice(0, p.capturedStageIndex + 1) : p.stages
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
  密集阵: '#32b8c6',
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
  const stageList = p.stageMode === 'current' ? p.stages.slice(0, p.capturedStageIndex + 1) : p.stages

  const viewLabel = p.view === 'attack' ? '攻方' : '守方'
  const rangeLabel = p.stageMode === 'current' ? `指定阶段（${p.stages[p.capturedStageIndex]?.id ?? '-'}）` : p.stageMode === 'overview' ? '总览导出' : '全部阶段（可切换）'

  // 序列化数据（图片映射中 data URI 可能很大，但 JSON 内嵌没问题；转义 < 防止 </script> 截断）
  const data = JSON.stringify({
    config: p.config,
    view: p.view,
    stageMode: p.stageMode,
    capturedStageIndex: p.capturedStageIndex,
    stages: stageList.map((s) => s),
    geoJson: p.geoJson,
    vehicles: p.vehicles,
    buildings: p.buildings,
    operators: p.operators,
    connections: p.connections,
    teams: p.teams,
    teamRoles: p.teamRoles ?? {},
    routes: p.routes,
    fieldSupports: p.fieldSupports ?? [],
    skillActions: p.skillActions ?? [],
    showProps: p.showProps,
    propVis: p.propVis,
    propsList: p.propsList,
    propColor: PROP_COLOR,
    imgs,
    snapshots: (p.snapshots ?? []).map((snapshot) => ({ ...snapshot, fieldSupports: snapshot.fieldSupports ?? [], skillActions: snapshot.skillActions ?? [], notesHtml: renderTacticalMarkdown(snapshot.notesMarkdown, p.noteImages ?? {}) })),
    notesHtml: renderTacticalMarkdown(p.notesMarkdown ?? '', p.noteImages ?? {}),
    allNotesHtml: Array.from(new Map((p.snapshots ?? []).map((snapshot) => [snapshot.stageId, snapshot])).values()).map((snapshot) => '<section><h1>' + escapeHtml(snapshot.stageId) + '</h1>' + renderTacticalMarkdown(snapshot.notesMarkdown, p.noteImages ?? {}) + '</section>').join(''),
  }).replace(/</g, '\\u003c')

  const snapshotStageOptions = Array.from(new Set((p.snapshots ?? []).map((snapshot) => snapshot.stageId))).map((stageId) => `<option value="${escapeHtml(stageId)}">${escapeHtml(stageId)}</option>`).join('')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>战术板 · ${escapeHtml(p.mapName)} · ${viewLabel}视角</title>
<style>${leafletCss}</style>
<style>
  html, body { margin: 0; height: 100%; background: #0e1112; font-family: "Microsoft YaHei", system-ui, sans-serif; }
  #map { width: 100vw; height: 100vh; background: #0e1112; }
  .board-head { position: fixed; top: 10px; left: 50%; transform: translateX(-50%); z-index: 1000;
    background: rgba(14,17,18,.92); border: 1px solid #2b3135; border-radius: 4px; color: #eaebeb;
    font-size: 12px; padding: 6px 14px; display: flex; gap: 14px; align-items: center; box-shadow: 0 2px 10px rgba(0,0,0,.5);
    max-width: calc(100vw - 16px); box-sizing: border-box; overflow-x: auto; scrollbar-width: none; }
  .board-head::-webkit-scrollbar { display: none; }
  .board-head > b, .board-head > span, .board-snapshot-select, .board-actions { white-space: nowrap; flex-shrink: 0; }
  .board-head b { color: #01ff84; }
  .board-actions { display: flex; gap: 5px; margin-left: 2px; flex-shrink: 0; }
  .board-actions button { height: 25px; padding: 0 8px; border: 1px solid #3b454b; border-radius: 3px;
    color: #d8dcde; background: #171d20; cursor: pointer; font: inherit; }
  .board-actions label { display:inline-flex; align-items:center; gap:5px; color:#9fa7ab; }
  .board-actions select { height:25px; border:1px solid #3b454b; border-radius:3px; background:#171d20; color:#d8dcde; font:inherit; }
  .board-actions button:hover { color: #01ff84; border-color: #01ff84; }
  .board-snapshot-select { display: inline-flex; align-items: center; gap: 5px; color: #9fa7ab; }
  .board-snapshot-select select { height: 25px; border: 1px solid #3b454b; border-radius: 3px; background: #171d20; color: #d8dcde; }
  .board-legend { position: fixed; bottom: 14px; left: 14px; z-index: 1000; background: rgba(14,17,18,.88);
    border: 1px solid #2b3135; border-radius: 4px; color: #c9ced1; font-size: 11px; padding: 8px 10px; line-height: 1.8; }
  .board-legend .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; vertical-align: -1px; }
  .board-hint { position: fixed; bottom: 14px; right: 14px; z-index: 1000; color: #6d7377; font-size: 11px;
    background: rgba(14,17,18,.7); border: 1px solid #2b3135; border-radius: 4px; padding: 4px 8px; }
  .board-notes { position: fixed; right: 14px; top: 62px; z-index: 1000; width: min(320px, calc(100vw - 28px)); max-height: 32vh; overflow: auto; box-sizing: border-box; color: #d8dcde; background: rgba(14,17,18,.9); border: 1px solid #2b3135; border-radius: 4px; font-size: 11px; line-height: 1.6; }
  .board-notes header { position: sticky; top: 0; display: flex; align-items: center; min-height: 32px; padding: 0 5px 0 10px; background: rgba(14,17,18,.98); }
  .board-notes b { color: #01ff84; }
  .board-notes button { width: 26px; height: 26px; margin-left: 4px; padding: 0; border: 0; border-radius: 3px; color: #c9ced1; background: transparent; cursor: pointer; font-size: 16px; }
  .board-notes header > button:first-of-type { margin-left: auto; }
  .board-notes button:hover { color: #01ff84; background: #2f3233; }
  .board-notes button svg { width:15px; height:15px; display:block; margin:auto; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
  .board-notes .when-expanded, .board-notes .when-collapsed { display:none; }
  .board-notes.expanded .expand-toggle .when-normal { display:none; }
  .board-notes.expanded .expand-toggle .when-expanded { display:block; }
  .board-notes.collapsed .collapse-toggle .when-normal { display:none; }
  .board-notes.collapsed .collapse-toggle .when-collapsed { display:block; }
  .board-notes #noteScopeToggle { width: auto; min-width: 86px; padding: 0 7px; font-size: 10px; white-space: nowrap; }
  .board-notes-body { padding: 0 10px 8px; }
  .board-notes-body ul, .board-notes-body ol { margin:8px 0; padding-left:24px; }
  .board-notes-body ul { list-style:disc outside; }
  .board-notes-body ol { list-style:decimal outside; }
  .board-notes-body li { display:list-item; margin:3px 0; }
  .board-notes-body img { display:block; width:auto; max-width:100%; height:auto; max-height:none; object-fit:contain; margin:8px 0; border:1px solid #2b3135; }
  .board-notes.collapsed { width: 126px; overflow: hidden; }
  .board-notes.collapsed .board-notes-body { display: none; }
  .board-notes.collapsed header > button:last-of-type { margin-left: auto; }
  .board-notes.expanded { width:min(760px, calc(100vw - 28px)); max-height:72vh; }
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
  .veh-heading { position:absolute; left:50%; top:-7px; width:0; height:0; border-left:4px solid transparent; border-right:4px solid transparent; border-bottom:7px solid var(--vc); transform-origin:50% 22px; z-index:4; }
  .building-marker { position:relative; width:38px; height:38px; display:flex; align-items:center; justify-content:center; }
  .building-marker-ring { position:absolute; inset:-2px; background:var(--bc); clip-path:polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%); filter:drop-shadow(0 0 4px var(--bc)); }
  .building-marker-ring::after { content:''; position:absolute; inset:2px; background:rgba(8,13,15,.94); clip-path:inherit; }
  .building-marker-core { position:relative; z-index:1; width:30px; height:30px; display:flex; align-items:center; justify-content:center; background:var(--bf); border:1px solid rgba(255,255,255,.76); clip-path:polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%); }
  .building-marker-core img { width:23px; height:23px; object-fit:contain; filter:drop-shadow(0 1px 2px rgba(0,0,0,.85)); }
  .building-marker-team { position:absolute; left:-5px; bottom:-5px; z-index:4; width:14px; height:14px; box-sizing:border-box; border:1px solid #fff; border-radius:50%; background:var(--bf); color:#fff; font:800 8px/12px sans-serif; text-align:center; box-shadow:0 0 4px rgba(0,0,0,.85); }
  .building-marker-name { position:absolute; z-index:3; left:50%; bottom:-12px; transform:translateX(-50%); padding:1px 4px; border:1px solid var(--bc); border-radius:2px; background:rgba(8,13,15,.9); color:#fff; white-space:nowrap; font:700 8px/1.2 sans-serif; }
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
  @media (max-width: 1100px) { .board-head { top: 6px; gap: 7px; padding: 5px 8px; font-size: 11px; } .board-actions button, .board-actions select { height: 24px; padding-left: 6px; padding-right: 6px; } }
  @media (max-width: 860px) {
    .board-head { left: 8px; right: 8px; transform: none; width: auto; max-width: none; flex-wrap: wrap; overflow: visible; gap: 5px 8px; padding: 6px 8px; border-radius: 4px; }
    .board-head > b { max-width: 45vw; overflow: hidden; text-overflow: ellipsis; }
    .board-head > span:nth-of-type(3) { display:none; }
    .board-snapshot-select { order: 3; width: 100%; display: flex; align-items: center; gap: 5px; overflow: hidden; }
    .board-snapshot-select select { min-width: 0; flex: 1 1 0; }
    .board-actions { order: 4; width: 100%; margin-left: 0; justify-content: flex-start; overflow-x: auto; padding-bottom: 1px; }
    .board-actions button { flex: 0 0 auto; min-height: 30px; }
    .board-legend { left: 8px; right: 8px; bottom: 52px; display: flex; flex-wrap: wrap; gap: 3px 10px; width: auto; padding: 5px 7px; font-size: 9px; }
    .board-notes { top: auto; right: 8px; bottom: 8px; left: 8px; width: auto; max-height: min(34vh, 280px); font-size: 11px; }
    .board-notes.expanded { top: 8px; right: 8px; bottom: 8px; left: 8px; width: auto; max-height: none; }
    .board-notes.collapsed { left: auto; width: 132px; max-height: 34px; }
    .board-notes header { min-height: 34px; }
    .board-notes-body { padding: 0 9px 9px; }
  }
  @media (max-width: 480px) {
    .board-head { top: 6px; gap: 4px 6px; font-size: 10px; }
    .board-head > b { max-width: 56vw; }
    .board-head > span:nth-of-type(1) { display: none; }
    .board-actions button { height: 28px; padding: 0 7px; font-size: 10px; }
    .board-notes { max-height: min(38vh, 260px); }
    .board-legend { font-size: 8px; }
  }
  @media print { .board-actions, .board-hint, .leaflet-control-container { display:none !important; } }
  body.capturing-png .board-head, body.capturing-png .board-legend, body.capturing-png .board-hint,
  body.capturing-png .leaflet-control-container, body.capturing-png .board-notes > header { display:none !important; }
</style>
</head>
<body>
<div class="board-head">
  <b>${escapeHtml(p.mapName)}</b>
  <span>视角：${viewLabel}</span>
  <span>范围：${rangeLabel}</span>
  ${p.stageMode !== 'current' ? `<label class="board-snapshot-select">推演位置 <select id="snapshotStage">${snapshotStageOptions}</select><select id="snapshotRound"></select></label>` : ''}
  <span>导出时间：${new Date().toLocaleString('zh-CN')}</span>
  <div class="board-actions">
    <button type="button" onclick="map.fitBounds(bounds)">适应地图</button>
    <button type="button" onclick="document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()">全屏</button>
    <button type="button" onclick="exportBoardPng(this)">导出为 PNG</button>
  </div>
</div>
<div class="board-legend">
  <div><span class="dot" style="background:#01ff84"></span>本方（${viewLabel === '攻方' ? '攻方' : '守方'}）</div>
  <div><span class="dot" style="background:#e0453a"></span>敌方</div>
  <div><span class="dot" style="background:#f4cf67"></span>中立 / 待争夺</div>
  <div><span class="dot" style="background:#2f6fed"></span>画笔 / 阵线</div>
</div>
  <div class="board-hint">滚轮缩放 · 拖拽平移 · 底图与 Leaflet 资源需要联网加载</div>
<aside class="board-notes" id="boardNotes"><header><b>推演备注</b>${p.stageMode !== 'current' ? '<button type="button" id="noteScopeToggle" title="切换备注范围">总览</button>' : ''}<button class="expand-toggle" type="button" title="放大备注" aria-label="放大备注" aria-expanded="false" onclick="const panel=document.getElementById('boardNotes');const expanded=panel.classList.toggle('expanded');this.title=expanded?'还原备注':'放大备注';this.setAttribute('aria-label',this.title);this.setAttribute('aria-expanded',String(expanded))"><svg class="when-normal" viewBox="0 0 16 16"><path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4"/></svg><svg class="when-expanded" viewBox="0 0 16 16"><path d="M2 6h4V2M14 6h-4V2M2 10h4v4M14 10h-4v4"/></svg></button><button class="collapse-toggle" type="button" title="收起备注" aria-label="收起备注" aria-expanded="true" onclick="const panel=document.getElementById('boardNotes');const collapsed=panel.classList.toggle('collapsed');const expandButton=panel.querySelector('.expand-toggle');if(expandButton) expandButton.style.display=collapsed?'none':'';this.title=collapsed?'展开备注':'收起备注';this.setAttribute('aria-label',this.title);this.setAttribute('aria-expanded',String(!collapsed))"><svg class="when-normal" viewBox="0 0 16 16"><path d="m3 6 5 5 5-5"/></svg><svg class="when-collapsed" viewBox="0 0 16 16"><path d="m3 10 5-5 5 5"/></svg></button></header><div class="board-notes-body" id="boardNotesBody"></div></aside>
<div id="map"></div>
<script>${leafletJs}<\/script>
<script>
async function exportBoardPng(button) {
  const previous = button.textContent
  button.disabled = true
  button.textContent = '选择当前标签页…'
  let stream
  try {
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('当前浏览器不支持屏幕捕获')
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'browser' }, audio: false, preferCurrentTab: true })
    const track = stream.getVideoTracks()[0]
    if (track.getSettings().displaySurface && track.getSettings().displaySurface !== 'browser') {
      throw new Error('请在系统选择器中选择“当前标签页”，窗口截图会包含浏览器界面')
    }
    document.body.classList.add('capturing-png')
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    await new Promise((resolve) => setTimeout(resolve, 180))
    const video = document.createElement('video')
    video.srcObject = stream
    video.muted = true
    await video.play()
    await new Promise((resolve) => { if (video.readyState >= 2) resolve(); else video.onloadeddata = resolve })
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    const link = document.createElement('a')
    link.download = (document.title || '战术板') + '.png'
    link.href = canvas.toDataURL('image/png')
    link.click()
  } catch (error) {
    console.error(error)
    if (error?.name !== 'NotAllowedError') alert(error?.message || 'PNG 导出失败')
  } finally {
    document.body.classList.remove('capturing-png')
    stream?.getTracks().forEach((track) => track.stop())
    button.disabled = false
    button.textContent = previous
  }
}
const RAW = ${data};
const snapshotsByStage = (RAW.snapshots || []).reduce((groups, snapshot) => { (groups[snapshot.stageId] ||= []).push(snapshot); return groups }, {});
Object.values(snapshotsByStage).forEach((items) => items.sort((a, b) => a.round - b.round));
const roundSelection = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
const selectedSnapshots = Object.entries(snapshotsByStage).map(([stageId, items]) => items.find((item) => String(item.round) === roundSelection[stageId]) || items[0]);
const selectedStageId = roundSelection._stage || Object.keys(snapshotsByStage)[0];
const activeSnapshot = selectedSnapshots.find((item) => item.stageId === selectedStageId) || selectedSnapshots[0];
const mergeGeoJson = (items) => JSON.stringify({ type: 'FeatureCollection', features: items.flatMap((item) => { try { return JSON.parse(item.geoJson || '{}').features || [] } catch { return [] } }) });
const overviewData = selectedSnapshots.length ? {
  ...RAW,
  geoJson: mergeGeoJson(selectedSnapshots),
  vehicles: selectedSnapshots.flatMap((item) => item.vehicles || []),
  buildings: selectedSnapshots.flatMap((item) => item.buildings || []),
  operators: selectedSnapshots.flatMap((item) => item.operators || []),
  connections: selectedSnapshots.flatMap((item) => item.connections || []),
  teams: selectedSnapshots.flatMap((item) => item.teams || []),
  routes: selectedSnapshots.flatMap((item) => item.routes || []),
  fieldSupports: selectedSnapshots.flatMap((item) => item.fieldSupports || []),
  skillActions: selectedSnapshots.flatMap((item) => item.skillActions || []),
  notesHtml: activeSnapshot?.notesHtml || '',
} : RAW;
const D = RAW.stageMode === 'overview' ? overviewData : RAW.stageMode === 'all' && activeSnapshot ? { ...RAW, ...activeSnapshot, capturedStageIndex: RAW.stages.findIndex((stage) => stage.id === activeSnapshot.stageId), notesHtml: '<section><h1>' + activeSnapshot.stageId + '</h1>' + (activeSnapshot.notesHtml || '') + '</section>' } : RAW;
const snapshotStage = document.getElementById('snapshotStage');
const snapshotRound = document.getElementById('snapshotRound');
const refreshRoundOptions = () => {
  if (!snapshotStage || !snapshotRound) return;
  const items = snapshotsByStage[snapshotStage.value] || [];
  snapshotRound.innerHTML = items.map((item) => '<option value="' + item.round + '">回合 ' + item.round + '</option>').join('');
  snapshotRound.value = roundSelection[snapshotStage.value] || String(items[0]?.round || 1);
};
if (snapshotStage && snapshotRound) {
  snapshotStage.value = selectedStageId;
  refreshRoundOptions();
  snapshotStage.addEventListener('change', () => { refreshRoundOptions(); const params = new URLSearchParams(location.hash.slice(1)); params.set('_stage', snapshotStage.value); params.set(snapshotStage.value, snapshotRound.value); location.hash = params.toString(); location.reload() });
  snapshotRound.addEventListener('change', () => { const params = new URLSearchParams(location.hash.slice(1)); params.set('_stage', snapshotStage.value); params.set(snapshotStage.value, snapshotRound.value); location.hash = params.toString(); location.reload() });
}
const notesBody = document.getElementById('boardNotesBody');
let showingAllNotes = RAW.stageMode !== 'current';
const renderNotes = () => { if (notesBody) notesBody.innerHTML = showingAllNotes ? (RAW.allNotesHtml || D.notesHtml || '') : (D.notesHtml || ''); const toggle = document.getElementById('noteScopeToggle'); if (toggle) toggle.textContent = showingAllNotes ? '查看当前阶段' : '查看总览'; };
renderNotes();
document.getElementById('noteScopeToggle')?.addEventListener('click', () => { showingAllNotes = !showingAllNotes; renderNotes(); });
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
const smoothExportPath = (points) => {
  if (points.length < 3) return points;
  const result = [points[0]];
  const steps = 12;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps, t2 = t * t, t3 = t2 * t;
      result.push([
        .5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        .5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  return result;
};
(D.routes || []).forEach((route) => {
  if (!route.waypoints || route.waypoints.length < 2) return;
  const color = route.status === 'completed' ? '#7f888f' : route.status === 'cancelled' ? '#656b70' : (route.color || routeTeamColor[route.team] || '#f4cf67');
  const dash = route.lineStyle === 'dotted' ? '2 7' : route.lineStyle === 'dashed' ? '12 7' : undefined;
  const statusOpacity = route.status === 'cancelled' ? .35 : route.status === 'completed' ? .58 : route.status === 'planned' ? .72 : 1;
  const baseWeight = typeof route.strokeWidth === 'number' && Number.isFinite(route.strokeWidth) ? Math.max(1, Math.min(10, route.strokeWidth)) : 3.5;
  const renderedRoutePoints = route.geometryType === 'curve' ? smoothExportPath(route.waypoints) : route.waypoints;
  L.polyline(renderedRoutePoints, { color, weight: route.status === 'executing' ? Math.max(baseWeight + 1, 5) : baseWeight, opacity: (route.opacity || .92) * statusOpacity, dashArray: dash, interactive: false }).addTo(map);
  const end = renderedRoutePoints[renderedRoutePoints.length - 1];
  const prev = renderedRoutePoints[renderedRoutePoints.length - 2];
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
  const labelPos = route.labelPosition || [(renderedRoutePoints[0][0] + renderedRoutePoints[1][0]) / 2, (renderedRoutePoints[0][1] + renderedRoutePoints[1][1]) / 2];
  const typeLabel = ({ move:'机动', attack:'进攻', recon:'侦察', flank:'迂回', retreat:'撤退', escort:'护送', resupply:'补给', hold:'防御' })[route.orderType] || route.orderType;
  const label = '<span class="route-order-badge" style="--rc:' + color + '">' + (route.orderType === 'hold' ? '◆ ' : '') + esc(route.team + '队 · ' + typeLabel) + '</span>';
  L.marker(labelPos, { icon: L.divIcon({ className: '', html: label, iconSize: [80, 18], iconAnchor: [40, 9] }), interactive: false }).addTo(map);
});

/* ---------- 兵棋协同关系 + 干员 ---------- */
if ((D.operators && D.operators.length) || (D.teams && D.teams.length) || (D.skillActions && D.skillActions.length) || (D.fieldSupports && D.fieldSupports.length)) {
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
  (D.operators || []).forEach((op) => {
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
    L.marker([op.lat, op.lng], { icon: L.divIcon({ className: 'op-marker-wrap', html, iconSize: [22, 22], iconAnchor: [11, 11] }), interactive: true }).addTo(opLayer);
  });
  /* 单兵技能：导出技能图标、起点连线及范围/路径。 */
  const skillByOperator = {}; (D.operators || []).forEach((op) => { skillByOperator[op.uid] = op; });
  (D.skillActions || []).forEach((skill) => {
    const source = skillByOperator[skill.sourceOperatorUid];
    const geometry = skill.geometry;
    const start = source && source.lat != null ? [source.lat, source.lng] : null;
    const curveControls = geometry ? (geometry.controls || (geometry.control ? [geometry.control] : [])) : [];
    const curveNodes = geometry && geometry.type === 'curve' ? [start || geometry.start, ...curveControls, geometry.end] : null;
    const points = geometry ? (geometry.points || curveNodes) : null;
    const end = geometry ? (geometry.position || geometry.center || geometry.end || (points && points[points.length - 1])) : start;
    if (!end) return;
    const color = skill.side === D.view ? '#55d68b' : '#ef6b68';
    // 与应用内一致：只有明确绑定目标单位的点技能显示来源关联线。
    if (geometry && geometry.type === 'point' && skill.targetUid && start) {
      L.polyline([start, end], { color, weight: 1.5, dashArray: '4 5', opacity: .7, interactive: false }).addTo(opLayer);
    }
    if (geometry && geometry.type === 'area') {
      const mapHeight = Math.abs(Number(D.config.northEast[0]) - Number(D.config.southWest[0])) || 230;
      // 与应用内 OperatorSkillLayer 保持一致：radiusRatio 是地图纬度跨度的比例，
      // 再按统一的 230 地图单位系数换算为 Leaflet 米制半径。
      const bounds = map.options.maxBounds ? L.latLngBounds(map.options.maxBounds) : map.getBounds();
      const latSpan = Math.max(1, bounds.getNorth() - bounds.getSouth());
      const radiusUnits = geometry.radiusRatio
        ? map.distance(end, [end[0] + latSpan * Number(geometry.radiusRatio) * (230 / latSpan), end[1]])
        : Number(geometry.radius || 60);
      L.circle(end, { radius: radiusUnits, color, weight: 1.5, opacity: .8, fillOpacity: .18, interactive: false }).addTo(opLayer);
    }
    else if (geometry && geometry.type === 'line' && points) {
      const bounds = map.options.maxBounds ? L.latLngBounds(map.options.maxBounds) : map.getBounds();
      const latSpan = Math.max(1, bounds.getNorth() - bounds.getSouth());
      const width = geometry.widthRatio
        ? latSpan * Number(geometry.widthRatio) * (230 / latSpan)
        : Number(geometry.width || 12);
      L.polyline(points, { color, weight: width, opacity: .25, interactive: false }).addTo(opLayer);
    }
    else if (geometry && geometry.type === 'curve' && curveNodes) {
      L.polyline(smoothExportPath(curveNodes), { color, weight: 2.5, opacity: .82, interactive: false }).addTo(opLayer);
    }
    else if (geometry && geometry.type === 'trajectory' && points && (skill.placementMode === 'guided-path' || skill.sourceKind === 'tactical-item')) {
      const livePoints = start && points.length > 1 ? [start, ...points.slice(1)] : points;
      L.polyline(livePoints, { color, weight: 2, dashArray: '8 5', opacity: .85, interactive: false }).addTo(opLayer);
    }
    const iconUrl = skill.iconUrl || ('/icons/operators/skills/' + skill.operatorId + '/skill_' + skill.skillSlot + '.png');
    const html = '<span style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:rgba(8,13,15,.92);border:2px solid ' + color + ';box-shadow:0 0 0 2px rgba(8,13,15,.8)"><img src="' + img(iconUrl) + '" style="width:20px;height:20px;object-fit:contain" draggable="false" /></span>';
    L.marker(end, { icon: L.divIcon({ className: 'skill-export-marker', html, iconSize: [30, 30], iconAnchor: [15, 15] }), interactive: false, zIndexOffset: 900 }).addTo(opLayer);
  });
  /* 阵地支援：导出中心图标与范围圈。 */
  const supportLayer = L.layerGroup().addTo(map);
  (D.fieldSupports || []).forEach((support) => {
    const color = support.side === D.view ? '#01ff84' : '#e0453a';
    const html = '<span style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:rgba(8,13,15,.92);border:2px solid ' + color + ';box-shadow:0 0 0 2px rgba(8,13,15,.85)"><img src="' + img(support.iconUrl) + '" style="width:23px;height:23px;object-fit:contain" draggable="false" /></span>';
    L.marker([support.lat, support.lng], { icon: L.divIcon({ className: 'support-export-marker', html, iconSize: [34, 34], iconAnchor: [17, 17] }), interactive: false, zIndexOffset: 920 }).addTo(supportLayer);
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
      + '<span class="tm-name">' + esc(((D.teamRoles || {})[tm.team] || tm.name || (tm.team + '队'))) + '</span></div>';
    L.marker([tm.lat, tm.lng], { icon: L.divIcon({ className: 'tm-wrap', html, iconSize: [30, 30], iconAnchor: [15, 15] }), interactive: true }).addTo(tmLayer);
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
      + '<span class="veh-heading" style="transform:translateX(-50%) rotate(' + (v.rotation || 0) + 'deg)" title="朝向 ' + (v.rotation || 0) + '°"></span>'
      + teamBadge
      + '<span class="veh-name">' + esc(v.name) + '</span></div>';
    L.marker([v.lat, v.lng], { icon: L.divIcon({ className: 'veh-marker-wrap', html, iconSize: [30, 30], iconAnchor: [15, 15] }), interactive: true }).addTo(vehLayer);
  });
}

/* ---------- 建筑兵棋 ---------- */
const buildingMeta = ${JSON.stringify(Object.fromEntries((['fixed-machine-gun', 'fixed-anti-air', 'coastal-gun'] as const).map((kind) => [kind, buildingUnitOf(kind)])))};
const buildingLayer = L.layerGroup().addTo(map);
(D.buildings || []).forEach((building) => {
  const meta = buildingMeta[building.kind] || buildingMeta['fixed-machine-gun'];
  const color = building.side === D.view ? '#01ff84' : '#e0453a', fill = building.team ? (routeTeamColor[building.team] || color) : color;
  const teamBadge = building.team ? '<span class="building-marker-team">' + esc(building.team) + '</span>' : '';
  const html = '<div class="building-marker" style="--bc:' + color + ';--bf:' + fill + '"><span class="building-marker-ring"></span><span class="building-marker-core"><img src="' + img(meta.iconUrl) + '" style="transform:rotate(' + (building.rotation || 0) + 'deg)" draggable="false" /></span>' + teamBadge + '<span class="building-marker-name">' + esc(building.name || meta.name) + '</span></div>';
  L.marker([building.lat, building.lng], { icon: L.divIcon({ className:'building-marker-wrap', html, iconSize:[38,38], iconAnchor:[19,19] }), interactive:true }).addTo(buildingLayer);
});

/* ---------- 据点 / 区域 / 复活点 / 道具（静态层，按范围过滤） ---------- */
const staticLayer = L.layerGroup().addTo(map);
const overviewStatic = RAW.stageMode === 'overview';
const staticStages = overviewStatic ? RAW.stages : D.stages;
const normalizePolygonRing = (points) => {
  if (!Array.isArray(points)) return [];
  const clean = points.filter((point, index) => Array.isArray(point) && point.length >= 2 && (index === 0 || point[0] !== points[index - 1]?.[0] || point[1] !== points[index - 1]?.[1]));
  if (clean.length < 3) return clean;
  const first = clean[0];
  const closedAt = clean.findIndex((point, index) => index >= 3 && point[0] === first[0] && point[1] === first[1]);
  return closedAt >= 3 ? clean.slice(0, closedAt) : clean;
};
staticStages.forEach((st, idx) => {
  const status = overviewStatic ? 'active' : idx < D.capturedStageIndex ? 'captured' : idx === D.capturedStageIndex ? 'active' : 'locked';
  const color = status === 'captured' ? (D.view === 'attack' ? '#01ff84' : '#e0453a') : status === 'active' ? '#f4cf67' : (D.view === 'attack' ? '#e0453a' : '#01ff84');
  // 防线区域（仅当前激活阶段）
  if ((overviewStatic || status === 'active') && st.zone) {
    L.polygon(normalizePolygonRing(st.zone.latlngs), { color, weight: 2.5, dashArray: '10 7', opacity: .9, fillColor: color, fillOpacity: 0, interactive: false }).addTo(staticLayer);
  }
  // 据点可占领区域（已解锁阶段）
  if (status !== 'locked') {
    (st.points || []).forEach((pt) => {
      if (pt.capturable && pt.capturable.length >= 3) {
        L.polygon(normalizePolygonRing(pt.capturable), { color, weight: status === 'active' ? 2.2 : 1.4, opacity: .85, fillColor: color, fillOpacity: status === 'active' ? .1 : .04, interactive: false }).addTo(staticLayer);
      }
    });
  }
  // 据点标记
  (st.points || []).forEach((pt) => {
    const html = '<div class="cap-marker ' + status + '" style="--c:' + color + '"><img src="' + img('${POINT_ICON_BASE}/' + pt.icon + '.png') + '" draggable="false" /><span class="cap-tag">' + esc(pt.name) + '</span></div>';
    L.marker([pt.lat, pt.lng], { icon: L.divIcon({ className: 'cap-marker-wrap', html, iconSize: [44, 52], iconAnchor: [22, 42] }), interactive: false }).addTo(staticLayer);
  });
});
// 单阶段导出显示当前阶段；全部导出显示每个阶段的活动区与复活点。
const curStage = D.stages[D.capturedStageIndex];
const visibleSpawnStages = overviewStatic ? RAW.stages : (curStage ? [curStage] : []);
visibleSpawnStages.forEach((visibleStage) => {
  // 当前阶段攻/守活动区：与正式版 ActivityZones 的阵营配色保持一致。
  const addActivityZone = (points, own) => {
    const ring = normalizePolygonRing(points);
    if (ring.length < 3) return;
    const color = own ? '#01ff84' : '#e0453a';
    L.polygon(ring, { color, weight: 2, opacity: .9, dashArray: own ? undefined : '6 4',
      fillColor: color, fillOpacity: 0, interactive: false }).addTo(staticLayer);
  };
  addActivityZone(visibleStage.attackBaseZone, D.view === 'attack');
  addActivityZone(visibleStage.defenseBaseZone, D.view === 'defense');

  const ownAtk = D.view === 'attack';
  const spawnOwn = { icon: ownAtk ? 'g_jdbsd_g' : 'f_jdbsd_g', color: '#01ff84' };
  const spawnEnemy = { icon: ownAtk ? 'f_jdbsd_r' : 'g_jdbsd_r', color: '#e0453a' };
  (visibleStage.attackSpawns || []).forEach((pos, i) => {
    const t = D.view === 'attack' ? spawnOwn : spawnEnemy;
    const label = (visibleStage.attackSpawnNames || [])[i] || visibleStage.id + ' · ' + (D.view === 'attack' ? '己方复活点' : '敌方复活点');
    const html = '<div class="spawn-marker" style="--c:' + t.color + '"><img src="' + img('${POINT_ICON_BASE}/' + t.icon + '.png') + '" draggable="false" /><span class="spawn-tag">' + esc(label) + '</span></div>';
    L.marker([pos[0], pos[1]], { icon: L.divIcon({ className: 'spawn-marker-wrap', html, iconSize: [44, 52], iconAnchor: [22, 42] }), interactive: false }).addTo(staticLayer);
  });
  (visibleStage.defenseSpawns || []).forEach((pos, i) => {
    const t = D.view === 'defense' ? spawnOwn : spawnEnemy;
    const label = (visibleStage.defenseSpawnNames || [])[i] || visibleStage.id + ' · ' + (D.view === 'defense' ? '己方复活点' : '敌方复活点');
    const html = '<div class="spawn-marker" style="--c:' + t.color + '"><img src="' + img('${POINT_ICON_BASE}/' + t.icon + '.png') + '" draggable="false" /><span class="spawn-tag">' + esc(label) + '</span></div>';
    L.marker([pos[0], pos[1]], { icon: L.divIcon({ className: 'spawn-marker-wrap', html, iconSize: [44, 52], iconAnchor: [22, 42] }), interactive: false }).addTo(staticLayer);
  });
});

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
export function downloadText(filename: string, text: string, mime?: string): void {
  void platform.downloadText(filename, text, mime)
}
