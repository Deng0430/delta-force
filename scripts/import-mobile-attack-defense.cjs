const fs = require('node:fs')
const path = require('node:path')

const [sourcePath, mapId = 'ember'] = process.argv.slice(2)
if (!sourcePath) throw new Error('Usage: node scripts/import-mobile-attack-defense.cjs <official-json> [map-id]')

const source = JSON.parse(fs.readFileSync(path.resolve(sourcePath), 'utf8'))
if (source?.mode?.id !== 'attack-defense') throw new Error(`Expected attack-defense mode, received ${source?.mode?.id ?? 'unknown'}`)
const map = source?.maps?.[mapId]
if (!map || !Array.isArray(map.stages)) throw new Error(`Map ${mapId} is missing from the official export`)

const output = {
  format: 'deltaforce-mobile-attack-defense-override',
  schemaVersion: 1,
  source: path.basename(sourcePath),
  updatedAt: new Date().toISOString().slice(0, 10),
  maps: { [mapId]: map },
}

const target = path.resolve(__dirname, '../src/config/mobileAttackDefenseOfficial.json')
fs.writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
console.log(`Wrote ${mapId}: ${map.stages.length} stages, ${(map.props ?? []).length} props -> ${target}`)
