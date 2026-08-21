import type {
  ModeDeployVehicle,
  ModeVehicleRefreshRule,
  ModeVehicleRefreshTrigger,
  Side,
} from '../types'
import { MAPS } from '../config/maps'
import { DEPLOY_VEHICLE_CATALOG, type DeployVehicleEntry } from '../config/deployVehicles'

export interface ParsedVehicleRefreshRule {
  mapId: string
  rule: ModeVehicleRefreshRule
}

export interface VehicleRefreshTableResult {
  records: ParsedVehicleRefreshRule[]
  errors: string[]
}

const VEHICLE_ALIASES: Record<string, string[]> = {
  运兵车: ['突击车'],
  大运: ['突击车'],
  小运: ['轻型战术车'],
  轮突: ['FSV轮式突击炮', '轮式突击炮'],
  AAV: ['两栖装甲运输车'],
  乌龟车: ['两栖装甲运输车'],
  防空车: ['LAV AA防空车'],
  攻击艇: ['UCB-95/97攻击艇'],
  小鸟: ['侦察直升机'],
  武直: ['突击直升机'],
  主坦: ['M1A4主战坦克'],
}

function compact(value: string): string {
  return value.replace(/[\s·_\-/]/g, '').toLowerCase()
}

function asModeVehicle(entry: DeployVehicleEntry): ModeDeployVehicle {
  return {
    name: entry.name,
    icon: entry.icon,
    iconUrl: entry.iconUrl,
    legendKey: entry.legendKey,
    badge: entry.badge,
    category: entry.category,
    cd: entry.cd,
    num: entry.num,
    allowTeammate: entry.allowTeammate,
  }
}

export function resolveRefreshVehicle(name: string): ModeDeployVehicle | null {
  const raw = name.trim()
  const candidates = [raw, ...(VEHICLE_ALIASES[raw] ?? [])].map(compact)
  const entry = DEPLOY_VEHICLE_CATALOG.find((vehicle) => {
    const vehicleName = compact(vehicle.name)
    return candidates.some((candidate) => vehicleName === candidate || vehicleName.includes(candidate) || candidate.includes(vehicleName))
  })
  return entry ? asModeVehicle(entry) : null
}

function parseSide(value: string): Side | null {
  const normalized = value.trim()
  if (normalized === '攻' || normalized.includes('进攻')) return 'attack'
  if (normalized === '守' || normalized.includes('防守')) return 'defense'
  return null
}

function parseTrigger(value: string, note: string): ModeVehicleRefreshTrigger | null {
  const raw = value.trim()
  if (/^\d+$/.test(raw)) return { type: 'tickets', value: Number(raw) }
  if (/^\d{1,2}:\d{2}$/.test(raw)) return { type: 'match-time', value: raw }
  if (/倒计时/i.test(raw)) {
    const seconds = Number(raw.match(/\d+/)?.[0] ?? 0)
    return { type: 'objective-countdown', value: seconds }
  }
  if (/拿下|攻下|占领/.test(raw)) return { type: 'objective-captured', value: raw }
  const eventText = raw && raw !== '—' && raw !== '-' ? raw : note.trim()
  return eventText ? { type: 'map-event', value: eventText } : null
}

function splitTableLine(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((cell) => cell.trim())
  return line.split(/\s*,\s*/).map((cell) => cell.trim())
}

/**
 * 解析“地图名 / 类型 / 点位 / 阵营 / 兵力或时间 / 刷新载具 / 备注”的
 * Excel、TSV 或 CSV 文本。表头可有可无；其他模式行会被忽略。
 */
export function parseVehicleRefreshTable(text: string): VehicleRefreshTableResult {
  const records: ParsedVehicleRefreshRule[] = []
  const errors: string[] = []
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  let sequence = 0

  lines.forEach((line, lineIndex) => {
    const cells = splitTableLine(line)
    if (cells.some((cell) => cell === '地图名') || cells.some((cell) => cell === '刷新载具')) return
    if (cells.length < 6) return

    const [mapName, modeName, objective, sideText, triggerText, vehicleText, ...noteCells] = cells
    if (modeName && !modeName.includes('胜者为王')) return
    const map = MAPS.find((item) => compact(item.name) === compact(mapName) || compact(item.id) === compact(mapName))
    if (!map) {
      errors.push(`第 ${lineIndex + 1} 行：无法识别地图“${mapName}”`)
      return
    }
    const side = parseSide(sideText)
    if (!side) {
      errors.push(`第 ${lineIndex + 1} 行：无法识别阵营“${sideText}”`)
      return
    }
    const note = noteCells.join('，').trim()
    const trigger = parseTrigger(triggerText, note)
    if (!trigger) {
      errors.push(`第 ${lineIndex + 1} 行：缺少有效刷新条件`)
      return
    }
    const vehicle = resolveRefreshVehicle(vehicleText)
    if (!vehicle) {
      errors.push(`第 ${lineIndex + 1} 行：无法匹配载具“${vehicleText}”`)
      return
    }

    sequence += 1
    records.push({
      mapId: map.id,
      rule: {
        uid: `vehicle_refresh_rule_${Date.now().toString(36)}_${sequence.toString(36)}`,
        objective: objective.trim().toUpperCase() || '?',
        side,
        action: /不再部署|停止部署|停止刷新|取消部署/.test(note) ? 'disable' : 'refresh',
        trigger,
        vehicle,
        quantity: 1,
        refreshPointUid: '',
        note,
        verification: 'draft',
      },
    })
  })

  return { records, errors }
}

export function vehicleRefreshRuleSignature(rule: ModeVehicleRefreshRule): string {
  return [
    rule.objective,
    rule.side,
    rule.action,
    rule.trigger.type,
    String(rule.trigger.value),
    rule.vehicle.name,
    rule.note,
  ].join('|')
}

export function refreshTriggerLabel(trigger: ModeVehicleRefreshTrigger): string {
  if (trigger.type === 'tickets') return `${trigger.value} 兵力`
  if (trigger.type === 'match-time') return `${trigger.value}`
  if (trigger.type === 'objective-countdown') return `倒计时 ${trigger.value}s`
  if (trigger.type === 'objective-captured') return `据点事件：${trigger.value}`
  return `事件：${trigger.value}`
}
