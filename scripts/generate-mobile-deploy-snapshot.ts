import fs from 'node:fs'
import path from 'node:path'
import { DEPLOY_BY_MAP } from '../src/config/deployVehicles'

// 烬区已有 mobileAttackDefenseOfficial 独立手游部署；其余官网地图当前
// _mobile.deploy 与 _pc.deploy 相同，仍固化为单独快照以隔离后续 PC 修订。
const MAP_IDS = [
  'ascent',
  'flashpoint',
  'fault',
  'brokentrack',
  'colosseum',
  'stormeye',
  'pyramid',
  'trench',
  'umuscanal',
  'aftershock',
] as const

const maps = Object.fromEntries(MAP_IDS.map((mapId) => [mapId,
  Object.fromEntries(Object.entries(DEPLOY_BY_MAP[mapId] ?? {}).map(([stageId, stage]) => [stageId, {
    attack: stage.attack.map(({ iconUrl: _iconUrl, spawnUid: _spawnUid, ...entry }) => entry),
    defense: stage.defense.map(({ iconUrl: _iconUrl, spawnUid: _spawnUid, ...entry }) => entry),
  }])),
]))

const output = {
  format: 'deltaforce-mobile-deploy-snapshot',
  source: 'local-pc-config-matching-official-mobile-deploy',
  maps,
}

const target = path.resolve('src/config/mobileDeploySnapshot.json')
fs.writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`)
console.log(`Wrote ${target}`)
