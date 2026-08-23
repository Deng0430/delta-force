import type { Side, StageConfig, StageSpawnPoint } from '../types'
import type { DeployVehicleEntry, StageDeploy } from './deployVehicles'
import type { GameDataPlatform } from './gameDataPlatform'

type DeployByMap = Record<string, Record<string, StageDeploy>>

const NAME_OVERRIDES: Record<string, Partial<Record<string, Partial<Record<Side, string[]>>>>> = {
  fault: {
    S1: { attack: ['GTI1号阵地', 'GTI2号阵地', 'GTI3号阵地'], defense: ['哈夫克1号阵地'] },
    S2: { attack: ['GTI4号阵地', 'GTI5号阵地', 'GTI6号阵地'], defense: ['哈夫克2号阵地', '哈夫克3号阵地'] },
    S3: { attack: ['GTI7号阵地', 'GTI8号阵地'], defense: ['哈夫克4号阵地', '哈夫克5号阵地'] },
  },
  aftershock: {
    S3: { attack: ['GTI6号阵地', 'GTI7号阵地'], defense: ['哈夫克4号阵地', '哈夫克5号阵地', '哈夫克6号阵地'] },
    S4: { attack: ['GTI8号阵地', 'GTI9号阵地', 'GTI10号阵地'], defense: ['哈夫克7号阵地', '哈夫克8号阵地', '哈夫克9号阵地'] },
  },
  pyramid: {
    S1: { attack: ['GTI1号阵地', 'GTI2号阵地', 'GTI3号阵地'] },
  },
}

function hash(value: string): string {
  let result = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return (result >>> 0).toString(36)
}

export function makeAttackDefenseSpawnUid(
  platform: GameDataPlatform,
  mapId: string,
  stageId: string,
  side: Side,
  lat: number,
  lng: number,
): string {
  return `spawn_ad_${platform}_${mapId}_${stageId.toLowerCase()}_${side}_${hash(`${lat.toFixed(6)}:${lng.toFixed(6)}`)}`
}

/** 胜者为王内置复活点稳定 UID；生成后会直接固化，不随名称或数组顺序变化。 */
export function makeWinnerSpawnUid(
  platform: GameDataPlatform,
  mapId: string,
  stageId: string,
  side: Side,
  lat: number,
  lng: number,
): string {
  return `spawn_wta_${platform}_${mapId}_${stageId.toLowerCase()}_${side}_${hash(`${lat.toFixed(6)}:${lng.toFixed(6)}`)}`
}

function comparableName(value: string): string {
  return value.trim().replace(/\s+/g, '').replace(/（.*?）|\(.*?\)/g, '')
}

function ordinal(value: string): string | null {
  const match = comparableName(value).match(/(?:GTI|哈夫克|进攻方|防守方)(\d+)号阵地/i)
  return match?.[1] ?? null
}

function namesMatch(left: string, right: string): boolean {
  const a = comparableName(left)
  const b = comparableName(right)
  if (!a || !b) return false
  if (a === b) return true
  const ao = ordinal(a)
  return ao != null && ao === ordinal(b)
}

function stageSpawns(
  platform: GameDataPlatform,
  mapId: string,
  stage: StageConfig,
): StageSpawnPoint[] {
  if (Array.isArray(stage.spawns) && stage.spawns.length > 0) {
    return stage.spawns.map((spawn) => ({ ...spawn, stageId: stage.id }))
  }
  const result: StageSpawnPoint[] = []
  const append = (side: Side, points: [number, number][], names: string[] | undefined) => {
    const overridden = NAME_OVERRIDES[mapId]?.[stage.id]?.[side]
    points.forEach(([lat, lng], index) => {
      const name = names?.[index]?.trim() || overridden?.[index] || `${stage.id} · ${side === 'attack' ? '进攻方' : '防守方'}复活点 ${index + 1}`
      result.push({
        uid: makeAttackDefenseSpawnUid(platform, mapId, stage.id, side, lat, lng),
        stageId: stage.id,
        name,
        side,
        lat,
        lng,
      })
    })
  }
  append('attack', stage.attackSpawns, stage.attackSpawnNames)
  append('defense', stage.defenseSpawns, stage.defenseSpawnNames)
  return result
}

/**
 * 将官网“名称关联”只执行一次，产出应用内部统一的复活点 UID 与载具外键。
 * 官网部署表偶尔引用上一阶段仍存在的基地；这种情况会在当前阶段创建同坐标实例。
 */
export function normalizeAttackDefenseData(
  platform: GameDataPlatform,
  rawStagesByMap: Record<string, StageConfig[]>,
  rawDeployByMap: DeployByMap,
): { stages: Record<string, StageConfig[]>; deploy: DeployByMap } {
  const stages: Record<string, StageConfig[]> = {}
  const deploy: DeployByMap = {}

  for (const [mapId, sourceStages] of Object.entries(rawStagesByMap)) {
    const mapStages = sourceStages.map((stage) => {
      const spawns = stageSpawns(platform, mapId, stage)
      return { ...stage, spawns }
    })
    stages[mapId] = mapStages
    deploy[mapId] = {}

    for (const stage of mapStages) {
      const sourceDeploy = rawDeployByMap[mapId]?.[stage.id] ?? { attack: [], defense: [] }
      const normalizedStage: StageDeploy = { attack: [], defense: [] }
      for (const side of ['attack', 'defense'] as const) {
        normalizedStage[side] = (sourceDeploy[side] ?? []).map((vehicle): DeployVehicleEntry => {
          if (vehicle.spawnUid && stage.spawns.some((spawn) => spawn.uid === vehicle.spawnUid)) return { ...vehicle }
          let match = stage.spawns.find((spawn) => spawn.side === side && namesMatch(spawn.name, vehicle.note))
          if (!match) {
            const candidates = mapStages.flatMap((candidateStage) => candidateStage.spawns)
              .filter((spawn) => spawn.side === side && namesMatch(spawn.name, vehicle.note))
            const exact = candidates.filter((spawn) => comparableName(spawn.name) === comparableName(vehicle.note))
            const uniqueByPosition = (items: StageSpawnPoint[]) => [...new Map(items.map((spawn) => [`${spawn.lat}:${spawn.lng}`, spawn])).values()]
            const exactPositions = uniqueByPosition(exact)
            const candidatePositions = uniqueByPosition(candidates)
            const source = exactPositions.length === 1 ? exactPositions[0] : candidatePositions.length === 1 ? candidatePositions[0] : undefined
            if (source) {
              match = stage.spawns.find((spawn) => spawn.side === side && spawn.lat === source.lat && spawn.lng === source.lng)
              if (!match) {
                match = {
                  ...source,
                  uid: makeAttackDefenseSpawnUid(platform, mapId, stage.id, side, source.lat, source.lng),
                  stageId: stage.id,
                }
                stage.spawns.push(match)
              }
            }
          }
          return match ? { ...vehicle, spawnUid: match.uid } : { ...vehicle }
        })
      }
      deploy[mapId][stage.id] = normalizedStage
    }

    // 兼容仍读取旧数组的导出代码与第三方数据：它们只是统一 spawns 的投影。
    for (const stage of mapStages) {
      const attack = stage.spawns.filter((spawn) => spawn.side === 'attack')
      const defense = stage.spawns.filter((spawn) => spawn.side === 'defense')
      stage.attackSpawns = attack.map((spawn) => [spawn.lat, spawn.lng])
      stage.defenseSpawns = defense.map((spawn) => [spawn.lat, spawn.lng])
      stage.attackSpawnNames = attack.map((spawn) => spawn.name)
      stage.defenseSpawnNames = defense.map((spawn) => spawn.name)
    }
  }
  return { stages, deploy }
}
