import { useEffect, useState, type CSSProperties } from 'react'
import type { OperatorUnit, Side, TacticalOrderType, TacticalRoute, TacticalRouteLineStyle } from '../types'
import { ORDER_STATUS_OPTIONS, ORDER_TYPE_OPTIONS, ROUTE_LINE_OPTIONS, orderTypeOf } from '../config/routes'
import { teamOf } from '../config/operators'

interface RouteEditorPanelProps {
  route: TacticalRoute
  view: Side
  availableOperators: OperatorUnit[]
  branchPicking: boolean
  onPatch: (patch: Partial<TacticalRoute>) => void
  onCopy: () => void
  onReverse: () => void
  onBranch: () => void
  onDelete: () => void
  onClose: () => void
}

export default function RouteEditorPanel({ route, view, availableOperators, branchPicking, onPatch, onCopy, onReverse, onBranch, onDelete, onClose }: RouteEditorPanelProps) {
  const [name, setName] = useState(route.name)
  const [opacity, setOpacity] = useState(Math.round(route.opacity * 100))

  useEffect(() => setName(route.name), [route.uid, route.name])
  useEffect(() => setOpacity(Math.round(route.opacity * 100)), [route.uid, route.opacity])

  const commitName = () => {
    const next = name.trim() || '未命名行动指令'
    setName(next)
    if (next !== route.name) onPatch({ name: next })
  }

  const changeType = (orderType: TacticalOrderType) => {
    const meta = orderTypeOf(orderType)
    onPatch({ orderType, color: meta.color, lineStyle: meta.lineStyle })
  }

  const anchoredOperator = route.anchorOperatorUid
    ? availableOperators.find((operator) => operator.uid === route.anchorOperatorUid)
    : undefined
  const operatorSelectionLocked = route.anchorMode === 'operator' && Boolean(route.anchorOperatorUid)
  const anchoredOperatorName = anchoredOperator?.name ?? '绑定干员'
  const selectedOperators = availableOperators.filter((operator) => route.operatorIds.includes(operator.uid))
  const wholeTeam = availableOperators.length > 0 && availableOperators.every((operator) => route.operatorIds.includes(operator.uid))
  const executorLabel = operatorSelectionLocked
    ? anchoredOperatorName
    : wholeTeam
      ? `${route.team}队全队`
      : selectedOperators.length === 0
        ? '未指定干员'
        : selectedOperators.length <= 2
          ? selectedOperators.map((operator) => operator.name).join('、')
          : `${selectedOperators.slice(0, 2).map((operator) => operator.name).join('、')}等${selectedOperators.length}人`
  const anchorLabel = route.anchorMode === 'team'
    ? '队伍兵棋'
    : route.anchorMode === 'operator'
      ? '干员兵棋'
      : route.anchorMode === 'vehicle'
        ? '载具兵棋'
        : route.anchorMode === 'branch'
          ? '路线节点'
          : '自由起点'
  const teamColor = teamOf(route.team).color

  return (
    <div className="route-editor-panel" onMouseDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
      <div className="route-editor-head">
        <span><i className="fa-solid fa-route" aria-hidden="true" /> 行动指令</span>
        <button type="button" onClick={onClose} aria-label="关闭路线属性">×</button>
      </div>

      <div className="route-editor-overview" style={{ '--route-team-color': teamColor } as CSSProperties}>
        <div className="route-editor-identity">
          <span className={`route-editor-side ${route.side === view ? 'own' : 'enemy'}`}>{route.side === view ? '己方' : '敌方'}</span>
          <span className="route-editor-team" title={`${route.team}队`}>{route.team}</span>
          <b title={selectedOperators.map((operator) => operator.name).join('、')}>{executorLabel}</b>
          {route.vehicleIds.length > 0 && <em><i className="fa-solid fa-truck-monster" />{route.vehicleIds.length}</em>}
        </div>
        <div className="route-editor-summary">
          <span><i className="fa-solid fa-route" />{route.waypoints.length - 1}段</span>
          <span><i className="fa-solid fa-link" />{anchorLabel}</span>
          <span title={route.target?.label}><i className="fa-solid fa-crosshairs" />{route.target?.label ?? '无目标'}</span>
        </div>
      </div>

      <label className="route-editor-name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
        />
      </label>

      <div className="route-editor-choice">
        <span>指令类型</span>
        <div className="route-order-types">
          {ORDER_TYPE_OPTIONS.map((item) => (
            <button type="button" key={item.id} className={route.orderType === item.id ? 'active' : ''} style={{ '--route-choice-color': item.color } as CSSProperties} onClick={() => changeType(item.id)}>
              <i className={`fa-solid ${item.icon}`} aria-hidden="true" /><b>{item.label}</b>
            </button>
          ))}
        </div>
      </div>

      <div className="route-editor-choice">
        <span>执行状态</span>
        <div className="route-order-statuses">
          {ORDER_STATUS_OPTIONS.map((item) => (
            <button type="button" key={item.id} className={`${route.status === item.id ? 'active' : ''} status-${item.id}`} onClick={() => onPatch({ status: item.id })}>
              <i className={`fa-solid ${item.icon}`} aria-hidden="true" /><b>{item.label}</b>
            </button>
          ))}
        </div>
      </div>

      <div className="route-editor-style-row">
        <label className="route-editor-field color">
          <span>指令色</span>
          <input type="color" value={route.color} onChange={(e) => onPatch({ color: e.target.value })} />
        </label>
        <label className="route-editor-field">
          <span>线型</span>
          <select value={route.lineStyle} onChange={(e) => onPatch({ lineStyle: e.target.value as TacticalRouteLineStyle })}>
            {ROUTE_LINE_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label className="route-editor-field opacity">
          <span>透明度 <b>{opacity}%</b></span>
          <input
            type="range"
            min={20}
            max={100}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            onPointerUp={() => onPatch({ opacity: opacity / 100 })}
            onKeyUp={() => onPatch({ opacity: opacity / 100 })}
            onBlur={() => onPatch({ opacity: opacity / 100 })}
          />
        </label>
      </div>

      <div className="route-editor-members">
        <span>
          执行干员 <b>{operatorSelectionLocked ? `${anchoredOperatorName}（绑定锁定）` : `${route.operatorIds.length}/${availableOperators.length}`}</b>
        </span>
        <div className="route-editor-member-list">
          {availableOperators.map((operator) => {
            const checked = route.operatorIds.includes(operator.uid)
            return (
              <button
                type="button"
                key={operator.uid}
                className={`${checked ? 'active' : ''} ${operator.status === 'killed' || operatorSelectionLocked ? 'disabled' : ''} ${operator.uid === anchoredOperator?.uid ? 'locked-anchor' : ''}`}
                disabled={operator.status === 'killed' || operatorSelectionLocked}
                title={operatorSelectionLocked
                  ? `${anchoredOperatorName}的单兵路线；请先点击“解绑”再调整执行干员`
                  : `${operator.name} · ${operator.lat == null ? '未部署' : '已部署'}`}
                onClick={() => onPatch({
                  operatorIds: checked
                    ? route.operatorIds.filter((uid) => uid !== operator.uid)
                    : [...route.operatorIds, operator.uid],
                })}
              >
                <i className={`fa-solid ${operatorSelectionLocked && operator.uid === anchoredOperator?.uid ? 'fa-lock' : checked ? 'fa-check' : 'fa-user'}`} aria-hidden="true" />
                {operator.name}
              </button>
            )
          })}
        </div>
        {operatorSelectionLocked && <small><i className="fa-solid fa-lock" /> 单兵路线仅由绑定干员执行，解绑后可改为小队协同。</small>}
      </div>

      <div className="route-editor-actions">
        <button type="button" onClick={onCopy}><i className="fa-regular fa-copy" />复制</button>
        <button type="button" onClick={onReverse}><i className="fa-solid fa-right-left" />反转</button>
        {(route.anchorMode !== 'free' || route.target) && (
          <button
            type="button"
            title="保留路线归属与执行成员，仅解除起终点和兵棋的坐标绑定"
            onClick={() => onPatch({
              anchorMode: 'free',
              anchorOperatorUid: undefined,
              anchorVehicleUid: undefined,
              teamMarkerUid: '',
              branchFromRouteUid: undefined,
              branchFromWaypointIndex: undefined,
              target: undefined,
            })}
          >
            <i className="fa-solid fa-link-slash" />解绑
          </button>
        )}
        <button type="button" className={branchPicking ? 'active' : ''} onClick={onBranch}><i className="fa-solid fa-code-branch" />{branchPicking ? '选择节点' : '创建分支'}</button>
        <button type="button" className="danger" onClick={onDelete}><i className="fa-regular fa-trash-can" />删除</button>
      </div>

      <div className={`route-editor-hint ${branchPicking ? 'active' : ''}`}>
        {branchPicking ? '请点击路线上的任意编号节点作为分支起点' : '双击路线段插点 · 拖动编号节点调整 · 中心手柄移动整线'}
      </div>
    </div>
  )
}
