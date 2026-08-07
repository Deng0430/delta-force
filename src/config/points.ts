import type { StageConfig } from '../types'
import {
  ASCENT_STAGES,
  FLASHPOINT_STAGES,
  FAULT_STAGES,
  BROKENTRACK_STAGES,
  COLOSSEUM_STAGES,
  STORMEYE_STAGES,
  EMBER_STAGES,
  PYRAMID_STAGES,
  TRENCH_STAGES,
  UMUSCANAL_STAGES,
  AFTERSHOCK_STAGES,
  POINT_ICON_BASE,
} from './pointsStages'

export { POINT_ICON_BASE }

/** 各攻防地图的阶段配置（顺序即推进顺序） */
export const STAGES_BY_MAP: Record<string, StageConfig[]> = {
  // 生成数据为 number[][] 结构，运行时均满足 [lat,lng] 二元组约束
  ascent: ASCENT_STAGES as unknown as StageConfig[],
  flashpoint: FLASHPOINT_STAGES as unknown as StageConfig[],
  fault: FAULT_STAGES as unknown as StageConfig[],
  brokentrack: BROKENTRACK_STAGES as unknown as StageConfig[],
  colosseum: COLOSSEUM_STAGES as unknown as StageConfig[],
  stormeye: STORMEYE_STAGES as unknown as StageConfig[],
  ember: EMBER_STAGES as unknown as StageConfig[],
  pyramid: PYRAMID_STAGES as unknown as StageConfig[],
  trench: TRENCH_STAGES as unknown as StageConfig[],
  umuscanal: UMUSCANAL_STAGES as unknown as StageConfig[],
  aftershock: AFTERSHOCK_STAGES as unknown as StageConfig[],
}

/** 取某地图的阶段数量 */
export function stageCount(mapId: string): number {
  return STAGES_BY_MAP[mapId]?.length ?? 0
}
