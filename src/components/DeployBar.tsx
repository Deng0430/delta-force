import { useMemo } from 'react'
import type { Side } from '../types'
import {
  DEPLOY_BY_MAP,
  DEPLOY_VEHICLE_CATALOG,
  localDeployIconUrl,
  type DeployVehicleEntry,
  type StageDeploy,
} from '../config/deployVehicles'

/** 选中的出生点（由 SpawnMarkers 点击触发） */
export interface DeployTarget {
  /** 复活点唯一 ID。 */
  uid: string
  stageId: string
  side: Side
  /** 出生点坐标 [lat, lng] */
  pos: [number, number]
  /** 基地名（null=附属复活点，无载具部署，不弹部署栏） */
  baseName: string | null
}

interface DeployBarProps {
  /** 地图 id（查 DEPLOY_BY_MAP 取对应地图的载具部署数据） */
  mapId: string
  /** 当前攻防视角（决定该出生点为本方/敌方：本方部署绿底，敌方红底） */
  view: Side
  target: DeployTarget | null
  /** 自定义模式使用编辑器导出的正式版部署表；未提供时使用攻防模式内置数据。 */
  deployByStage?: Record<string, StageDeploy>
  onClose: () => void
  /** 部署某载具到出生点附近 */
  onDeploy: (entry: DeployVehicleEntry, target: DeployTarget) => void
}

/**
 * 底部载具部署栏（仿官网 deploy-swiper）：
 * 点击出生点后出现，展示该出生点可部署载具的各类信息
 * （名称/图标/CD 冷却/可部署数量/投放方式），点击"部署"将载具放置到出生点附近。
 * 本方出生点部署的载具绿底，非本方（敌方）出生点也可部署（战术推演），载具红底。
 */
export default function DeployBar({ mapId, view, target, deployByStage, onClose, onDeploy }: DeployBarProps) {
  const list = useMemo<DeployVehicleEntry[]>(() => {
    if (!target) return []
    const stage = (deployByStage ?? DEPLOY_BY_MAP[mapId])?.[target.stageId]
    if (!stage) return []
    // 名称只负责显示；载具始终通过稳定复活点 UID 关联。
    return (stage[target.side] ?? [])
      .filter((v) => v.spawnUid === target.uid)
      .map((vehicle) => {
        const current = DEPLOY_VEHICLE_CATALOG.find((item) => item.name === vehicle.name)
          ?? DEPLOY_VEHICLE_CATALOG.find((item) => item.icon === vehicle.icon)
        return current ? { ...vehicle, iconUrl: current.iconUrl } : vehicle
      })
  }, [deployByStage, mapId, target])

  if (!target || list.length === 0) return null

  const sideLabel = target.side === 'attack' ? '进攻方' : '防守方'
  const isOwn = target.side === view
  const ownLabel = isOwn ? '本方' : '敌方'

  return (
    <>
      {/* 点击空白处（地图其他区域）关闭部署栏 */}
      <div className="deploy-bar-mask" onClick={onClose} aria-hidden="true" />
      <div
        className="deploy-bar show"
        onClick={(e) => {
          // 阻止点击部署栏内部冒泡到遮罩（避免误关）
          e.stopPropagation()
        }}
      >
        <div className="deploy-bar-head">
          <span className="deploy-bar-title">
            {ownLabel}{sideLabel}载具部署
            <em className="deploy-bar-stage">阶段 {target.stageId.replace('S', '')}</em>
          </span>
          <span className="deploy-bar-hint">
            点击「部署」放置载具到出生点附近（{ownLabel}载具{isOwn ? '绿' : '红'}底），点击空白处关闭
          </span>
          <button className="deploy-bar-close" onClick={onClose} title="关闭部署栏" aria-label="关闭部署栏">
            ✕
          </button>
        </div>
        <div className="deploy-list">
          {list.map((v) => (
            <div key={`${v.icon}-${v.cd}-${v.num}`} className="deploy-card">
              <div className="deploy-card-name">{v.name}</div>
              <div className="deploy-card-bot">
                <div className="deploy-card-img-ctn">
                  <img
                    className="deploy-card-img"
                    src={v.iconUrl || localDeployIconUrl(v.icon)}
                    alt={v.name}
                    draggable={false}
                    onError={(e) => {
                      const image = e.currentTarget as HTMLImageElement
                      const fallback = localDeployIconUrl(v.icon)
                      if (image.src !== new URL(fallback, window.location.href).href) {
                        image.src = fallback
                      } else {
                        image.style.display = 'none'
                      }
                    }}
                  />
                </div>
                <div className="deploy-card-info">
                  <div className="deploy-card-cd">{v.cd}s</div>
                  <div className="deploy-card-num">可部署:{v.num}</div>
                  <div className="deploy-card-note">{v.note}</div>
                </div>
              </div>
              <button
                className="deploy-card-btn"
                onClick={() => onDeploy(v, target)}
                title={`部署 ${v.name} 到出生点附近`}
              >
                部署
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
