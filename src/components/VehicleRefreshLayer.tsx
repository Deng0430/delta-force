import { useMemo } from 'react'
import { Marker, Popup, Tooltip } from 'react-leaflet'
import * as L from 'leaflet'
import type { ModeVehicleRefreshPoint, ModeVehicleRefreshRule, TacticalBattleContext } from '../types'
import { refreshTriggerLabel } from '../utils/vehicleRefreshRules'
import { evaluateVehicleRefreshRule, isVehicleRefreshRuleInStage } from '../utils/vehicleRefreshRuntime'
import { platform } from '../platform'

export type RuntimeVehicleRefreshPoint = Omit<ModeVehicleRefreshPoint, 'verification'>
export type RuntimeVehicleRefreshRule = Omit<ModeVehicleRefreshRule, 'verification'>

interface VehicleRefreshLayerProps {
  points: RuntimeVehicleRefreshPoint[]
  rules: RuntimeVehicleRefreshRule[]
  context: TacticalBattleContext
  stages: Array<{ id: string; points: import('../types').CapturePoint[] }>
  currentStageIndex: number
  usedRuleIds: string[]
  deployedRuleIds: string[]
  visible: boolean
  interactive: boolean
  onDeploy: (rule: RuntimeVehicleRefreshRule, point: RuntimeVehicleRefreshPoint, force: boolean) => void
  onRestore: (ruleUid: string) => void
  onLocateVehicle: (ruleUid: string) => void
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function refreshPointIcon(
  pointRules: RuntimeVehicleRefreshRule[],
  context: TacticalBattleContext,
  usedRuleIds: Set<string>,
  stages: VehicleRefreshLayerProps['stages'],
  currentStageIndex: number,
): L.DivIcon {
  const deployableRules = pointRules.filter((rule) => rule.action === 'refresh')
  const allUsed = deployableRules.length > 0 && deployableRules.every((rule) => usedRuleIds.has(rule.uid))
  const anyUsed = deployableRules.some((rule) => usedRuleIds.has(rule.uid))
  const anyEligible = deployableRules.some((rule) => !usedRuleIds.has(rule.uid) && evaluateVehicleRefreshRule(rule, context, { stages, currentStageIndex }).eligible)
  const status = allUsed ? 'used' : anyEligible ? 'eligible' : anyUsed ? 'partial' : 'locked'
  const first = deployableRules[0]
  const image = first?.vehicle.iconUrl
    ? `<img src="${escapeAttribute(first.vehicle.iconUrl)}" draggable="false" />`
    : '<i class="fa-solid fa-truck-fast" aria-hidden="true"></i>'
  const count = deployableRules.length > 1 ? `<b>${deployableRules.length}</b>` : ''
  const touchSize = platform.kind === 'android' ? 44 : 38
  return L.divIcon({
    className: 'vehicle-refresh-marker-wrap',
    html: `<div class="vehicle-refresh-marker ${status}"><span class="vehicle-refresh-pulse"></span>${image}${count}<i class="fa-solid fa-rotate refresh-symbol" aria-hidden="true"></i></div>`,
    iconSize: [touchSize, touchSize],
    iconAnchor: [touchSize / 2, touchSize / 2],
    popupAnchor: [0, -18],
  })
}

export default function VehicleRefreshLayer({
  points,
  rules,
  context,
  stages,
  currentStageIndex,
  usedRuleIds,
  deployedRuleIds,
  visible,
  interactive,
  onDeploy,
  onRestore,
  onLocateVehicle,
}: VehicleRefreshLayerProps) {
  const used = useMemo(() => new Set(usedRuleIds), [usedRuleIds])
  const deployed = useMemo(() => new Set(deployedRuleIds), [deployedRuleIds])
  const currentStageRules = useMemo(() => rules.filter((rule) => isVehicleRefreshRuleInStage(rule, {
    stages,
    currentStageIndex,
  })), [currentStageIndex, rules, stages])
  if (!visible) return null

  return <>
    {points.map((point) => {
      const pointRules = currentStageRules.filter((rule) => rule.refreshPointUid === point.uid)
      if (pointRules.length === 0) return null
      return (
        <Marker
          key={point.uid}
          position={[point.lat, point.lng]}
          icon={refreshPointIcon(pointRules, context, used, stages, currentStageIndex)}
          interactive={interactive}
          bubblingMouseEvents={false}
          zIndexOffset={650}
        >
          <Tooltip direction="top" offset={[0, -16]}>{point.name} · {pointRules.length} 条刷新规则</Tooltip>
          <Popup className="vehicle-refresh-popup" minWidth={290} maxWidth={360}>
            <div className="vehicle-refresh-card">
              <header><i className="fa-solid fa-truck-fast" /><span><strong>{point.name}</strong><small>官方载具刷新位置</small></span></header>
              <div className="vehicle-refresh-rule-list">
                {pointRules.map((rule) => {
                  const isUsed = used.has(rule.uid)
                  const isDeployed = deployed.has(rule.uid)
                  const evaluation = evaluateVehicleRefreshRule(rule, context, { stages, currentStageIndex })
                  return (
                    <section key={rule.uid} className={isUsed ? 'used' : evaluation.eligible ? 'eligible' : 'locked'}>
                      <div className="vehicle-refresh-rule-main">
                        {rule.vehicle.iconUrl ? <img src={rule.vehicle.iconUrl} alt="" /> : <i className="fa-solid fa-truck" />}
                        <span><strong>{rule.vehicle.name} × {rule.quantity}</strong><small>{rule.side === 'attack' ? '进攻方' : '防守方'} · {refreshTriggerLabel(rule.trigger)}</small></span>
                        <em>{isUsed ? isDeployed ? '本轮已部署' : '本轮已使用' : evaluation.eligible ? '可部署' : rule.action === 'disable' ? '取消刷新' : '条件未满足'}</em>
                      </div>
                      <p>{isUsed ? isDeployed ? '该规则本轮已经使用；载具损失后也不会自动再次刷新。' : '该规则产生的载具已损失，本轮不会再次自动刷新。' : evaluation.reason}</p>
                      {rule.note ? <p className="note">{rule.note}</p> : null}
                      {rule.action === 'refresh' ? <div className="vehicle-refresh-rule-actions">
                        {isUsed ? <>
                          {isDeployed ? <button type="button" onClick={() => onLocateVehicle(rule.uid)}>定位兵棋</button> : null}
                          <button type="button" className="restore" onClick={() => onRestore(rule.uid)}>复原刷新规则</button>
                        </> : evaluation.eligible ? (
                          <button type="button" className="deploy" onClick={() => onDeploy(rule, point, false)}>部署为载具兵棋</button>
                        ) : (
                          <button type="button" onClick={() => onDeploy(rule, point, true)}>忽略条件部署</button>
                        )}
                      </div> : null}
                    </section>
                  )
                })}
              </div>
            </div>
          </Popup>
        </Marker>
      )
    })}
  </>
}
