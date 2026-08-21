import { useEffect, useRef, useState } from 'react'
import type { Side, TacticalPlan } from '../types'

interface TacticalBoardModalProps {
  open: boolean
  mapId: string
  /** 地图 id → 名称（方案列表展示） */
  mapNameOf: (id: string) => string
  mapName: string
  view: Side
  stageId: string
  /** 当前地图全部阶段（用于范围选择展示） */
  stageLabel: string
  stageOptions: Array<{ id: string; label: string }>
  round: number
  roundOptions: number[]
  roundOptionsByStage: Record<string, number[]>
  plans: TacticalPlan[]
  /** 导出战术板：stageMode 为 'current' 当前阶段 / 'all' 全部阶段 */
  onExport: (stageMode: 'current' | 'all' | 'overview', stageId: string, round: number) => void
  onExportNative: (scope: 'all' | 'stage' | 'current') => void
  onImportNative: (file: File) => Promise<void>
  /** 保存当前战术为方案（自定义名称） */
  onSavePlan: (name: string) => void
  /** 应用方案到当前地图/阶段/视角 */
  onApplyPlan: (plan: TacticalPlan) => void
  /** 删除方案 */
  onDeletePlan: (id: string) => void
  onClose: () => void
}

export default function TacticalBoardModal({
  open,
  mapId,
  mapNameOf,
  mapName,
  view,
  stageId,
  stageLabel,
  stageOptions,
  round,
  roundOptions,
  roundOptionsByStage,
  plans,
  onExport,
  onExportNative,
  onImportNative,
  onSavePlan,
  onApplyPlan,
  onDeletePlan,
  onClose,
}: TacticalBoardModalProps) {
  const [tab, setTab] = useState<'export' | 'plans'>('export')
  const [stageMode, setStageMode] = useState<'current' | 'all' | 'overview'>('current')
  const [exportStage, setExportStage] = useState(stageId)
  const [exportRound, setExportRound] = useState(round)
  const [name, setName] = useState('')
  const [exporting, setExporting] = useState(false)
  const [nativeMenuOpen, setNativeMenuOpen] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)
  const nativeMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!nativeMenuOpen) return
    const close = (event: PointerEvent) => {
      if (!nativeMenuRef.current?.contains(event.target as Node)) setNativeMenuOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [nativeMenuOpen])

  // 打开时重置状态
  useEffect(() => {
    if (open) {
      setTab('export')
      setStageMode('current')
      setExportStage(stageId)
      setExportRound(round)
      setName('')
      setExporting(false)
    }
  }, [open])

  if (!open) return null

  const viewLabel = view === 'attack' ? '攻方' : '守方'
  // 全部方案按创建时间倒序；当前 地图+阶段 的方案带"当前"标记优先展示
  const relatedPlans = plans
    .slice()
    .sort((a, b) => {
      const curA = a.mapId === mapId && a.stageId === stageId ? 0 : 1
      const curB = b.mapId === mapId && b.stageId === stageId ? 0 : 1
      if (curA !== curB) return curA - curB
      return b.createdAt - a.createdAt
    })

  const handleSave = () => {
    const n = name.trim()
    if (!n) return
    onSavePlan(n)
    setName('')
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      await onExport(stageMode, exportStage, exportRound)
    } finally {
      setExporting(false)
    }
  }

  const stageRounds = roundOptionsByStage[exportStage] ?? roundOptions

  return (
    <div className="tb-overlay" onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose()
    }}>
      <div className="tb-modal">
        <div className="tb-head">
          <span className="tb-title">战术板</span>
          <button className="tb-close" onClick={onClose} title="关闭" aria-label="关闭">×</button>
        </div>

        {/* 标签页 */}
        <div className="tb-tabs">
          <button
            className={`tb-tab ${tab === 'export' ? 'active' : ''}`}
            onClick={() => setTab('export')}
          >
            导出战术板
          </button>
          <button
            className={`tb-tab ${tab === 'plans' ? 'active' : ''}`}
            onClick={() => setTab('plans')}
          >
            战术方案（{plans.length}）
          </button>
        </div>

        {/* 导出 */}
        {tab === 'export' && (
          <div className="tb-body">
            <div className="tb-row">
              <span className="tb-label">地图</span>
              <span className="tb-value">{mapName} · {stageLabel}</span>
            </div>
            <div className="tb-row">
              <span className="tb-label">视角</span>
              <span className="tb-value">{viewLabel}</span>
            </div>
            <div className="tb-row">
              <span className="tb-label">导出范围</span>
              <div className="tb-seg">
                <button
                  className={`tb-seg-btn ${stageMode === 'current' ? 'active' : ''}`}
                  onClick={() => setStageMode('current')}
                >
                  指定阶段回合
                </button>
                <button
                  className={`tb-seg-btn ${stageMode === 'all' ? 'active' : ''}`}
                  onClick={() => setStageMode('all')}
                >
                  全部导出
                </button>
                <button className={`tb-seg-btn ${stageMode === 'overview' ? 'active' : ''}`} onClick={() => setStageMode('overview')}>总览导出</button>
              </div>
            </div>
            {stageMode === 'current' && <div className="tb-row tb-wargame-row">
              <span className="tb-label">推演位置</span>
              <div className="tb-wargame-selectors">
                <label><span>阶段</span><select className="tb-select" value={exportStage} onChange={(event) => { const next = event.target.value; setExportStage(next); setExportRound(roundOptionsByStage[next]?.[0] ?? 1) }}>{stageOptions.map((stage) => <option key={stage.id} value={stage.id}>{stage.id} · {stage.label}</option>)}</select></label>
                <label><span>回合</span><select className="tb-select tb-round-select" value={stageRounds.includes(exportRound) ? exportRound : (stageRounds[0] ?? 1)} onChange={(event) => setExportRound(Number(event.target.value))}>{stageRounds.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
              </div>
            </div>}
            <div className="tb-tip">
              {stageMode === 'current'
                ? `导出所选阶段与回合的单页战术板，包含${viewLabel}视角的兵棋、路线、绘制、阵地支援、单兵技能和阶段备注。`
                : stageMode === 'all'
                  ? '导出全部阶段和回合。打开文件后可切换阶段与回合，每次查看一个推演位置，并可在阶段备注与备注总览之间切换。'
                  : '导出全部阶段总览。地图同时呈现各阶段选定回合的战术数据，可分别调整各阶段回合，并在阶段备注与备注总览之间切换。'}
              {' '}导出文件支持缩放、全屏和当前画面 PNG 导出；图标已内嵌，底图与地图引擎仍需联网加载。
            </div>
            <button className="tb-primary" onClick={() => void handleExport()} disabled={exporting}>
              {exporting ? '生成中…' : '导出 HTML 战术板'}
            </button>
            <div className="tb-native-actions">
              <div ref={nativeMenuRef} className="tb-native-export-menu">
                <button className={`tb-mini tb-native-trigger${nativeMenuOpen ? ' active' : ''}`} type="button" aria-haspopup="menu" aria-expanded={nativeMenuOpen} onClick={() => setNativeMenuOpen((value) => !value)}><i className="fa-solid fa-box-archive" aria-hidden="true" /><span>导出原生战术包</span><i className={`fa-solid fa-chevron-${nativeMenuOpen ? 'up' : 'down'} tb-native-chevron`} aria-hidden="true" /></button>
                {nativeMenuOpen && <div className="tb-native-submenu">
                  <button type="button" role="menuitem" onClick={() => { setNativeMenuOpen(false); onExportNative('stage') }}><i className="fa-solid fa-layer-group" aria-hidden="true" /><span><b>当前阶段数据</b><small>当前阶段的全部回合</small></span></button>
                  <button type="button" role="menuitem" onClick={() => { setNativeMenuOpen(false); onExportNative('current') }}><i className="fa-solid fa-location-dot" aria-hidden="true" /><span><b>当前回合数据</b><small>仅当前阶段与当前回合</small></span></button>
                  <button type="button" role="menuitem" onClick={() => { setNativeMenuOpen(false); onExportNative('all') }}><i className="fa-solid fa-database" aria-hidden="true" /><span><b>全部数据</b><small>所有阶段与全部回合</small></span></button>
                </div>}
              </div>
              <button className="tb-mini tb-native-import" type="button" onClick={() => importRef.current?.click()}><i className="fa-solid fa-file-import" aria-hidden="true" /><span>导入原生战术包</span></button>
              <input ref={importRef} type="file" accept="application/json,.json,.dfboard" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void onImportNative(file) }} />
            </div>
            <div className="tb-tip">原生战术包用于在安装了本应用的设备之间完整迁移，包含该地图全部阶段、回合、兵棋、路线、绘制、阵地支援、单兵技能、备注和对局状态。</div>
          </div>
        )}

        {/* 方案管理 */}
        {tab === 'plans' && (
          <div className="tb-body">
            <div className="tb-save-row">
              <input
                className="tb-input"
                value={name}
                maxLength={20}
                placeholder={`为当前战术命名（${mapName} · ${stageLabel} · ${viewLabel}）`}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSave()
                }}
              />
              <button className="tb-primary" onClick={handleSave} disabled={!name.trim()}>
                保存当前战术
              </button>
            </div>
            <div className="tb-tip">
              保存内容：当前{viewLabel}视角的载具部署、画笔绘制、兵棋干员与协同关系。可在任意时刻应用到对应地图与阶段。
            </div>

            {relatedPlans.length === 0 ? (
              <div className="tb-empty">暂无已保存的战术方案。部署好战术布局后，输入名称点击「保存当前战术」。</div>
            ) : (
              <div className="tb-plan-list">
                {relatedPlans.map((p) => (
                  <div key={p.id} className="tb-plan-item">
                    <div className="tb-plan-info">
                      <div className="tb-plan-name">
                        {p.name}
                        <span className="tb-plan-badge">{p.view === 'attack' ? '攻方' : '守方'}</span>
                        {p.mapId === mapId && p.stageId === stageId && (
                          <span className="tb-plan-badge cur">当前</span>
                        )}
                      </div>
                      <div className="tb-plan-meta">
                        {mapNameOf(p.mapId)} · {p.stageId} · {new Date(p.createdAt).toLocaleString('zh-CN')}
                      </div>
                    </div>
                    <div className="tb-plan-actions">
                      <button
                        className="tb-mini"
                        title="应用此方案到当前地图/阶段/视角"
                        onClick={() => onApplyPlan(p)}
                      >
                        应用
                      </button>
                      <button
                        className="tb-mini danger"
                        title="删除方案"
                        onClick={() => onDeletePlan(p.id)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
