import fs from 'node:fs'
import path from 'node:path'
import { STAGES_BY_MAP } from '../src/config/points'
import { MAP_PROPS } from '../src/config/pointsStages'

const PARITY_MAP_IDS = ['fault', 'brokentrack', 'colosseum', 'stormeye', 'pyramid'] as const

const maps = Object.fromEntries(PARITY_MAP_IDS.map((mapId) => [mapId, {
  // 这些官网手游对象当前与 PC 对象内容相同，但仍固化为独立快照，避免今后
  // PC 数据修订无意间改变手游数据。
  stages: structuredClone(STAGES_BY_MAP[mapId] ?? []),
  props: structuredClone(MAP_PROPS[mapId] ?? []),
}]))

const output = {
  format: 'deltaforce-mobile-pc-parity-snapshot',
  source: 'local-pc-config',
  maps,
}

const target = path.resolve('src/config/mobilePcParitySnapshot.json')
fs.writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`)
console.log(`Wrote ${target}`)
