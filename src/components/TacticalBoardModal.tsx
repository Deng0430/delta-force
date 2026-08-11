import { useEffect, useState } from 'react'
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
  plans: TacticalPlan[]
  /** 导出战术板：stageMode 为 'current' 当前阶段 / 'all' 全部阶段 */
  onExport: (stageMode: 'current' | 'all') => void
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
  plans,
  onExport,
  onSavePlan,
  onApplyPlan,
  onDeletePlan,
  onClose,
}: TacticalBoardModalProps) {
  const [tab, setTab] = useState<'export' | 'plans'>('export')
  const [stageMode, setStageMode] = useState<'current' | 'all'>('current')
  const [name, setName] = useState('')
  const [exporting, setExporting] = useState(false)

  // 打开时重置状态
  useEffect(() => {
    if (open) {
      setTab('export')
      setStageMode('current')
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
      await onExport(stageMode)
    } finally {
      setExporting(false)
    }
  }

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
                  当前阶段
                </button>
                <button
                  className={`tb-seg-btn ${stageMode === 'all' ? 'active' : ''}`}
                  onClick={() => setStageMode('all')}
                >
                  全部阶段
                </button>
              </div>
            </div>
            <div className="tb-tip">
              导出为单个 HTML 战术板：包含当前{viewLabel}视角的全部绘制、载具、兵棋部署及地图静态层（据点/区域/复活点/道具）。文件内可缩放、全屏、打印并一键适应地图；图标已内嵌，底图与地图引擎仍需联网加载。
            </div>
            <button className="tb-primary" onClick={() => void handleExport()} disabled={exporting}>
              {exporting ? '生成中…' : '导出 HTML 战术板'}
            </button>
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
