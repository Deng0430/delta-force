const fs = require('fs')
const path = require('path')
const vm = require('vm')

const SPECS = [
  ['ascent', 'pc', 'map_pc'],
  ['flashpoint', 'ljd', 'map_ljd'],
  ['fault', 'dc', 'map_dc'],
  ['brokentrack', 'dg', 'map_dg'],
  ['colosseum', 'dsc', 'map_dsc'],
  ['stormeye', 'hdz', 'map_hdz'],
  ['ember', 'jq', 'map_jq'],
  ['pyramid', 'jzt', 'map_jzt'],
  ['trench', 'qhz', 'map_qhz'],
  ['umuscanal', 'wmsyh', 'map_wmsyh'],
  ['aftershock', 'yz', 'map_yz'],
]
const PROP_NAMES = new Set(['载具补给站', '固定防空炮', '固定机枪', '岸防炮', '滑索', '电梯', '固定弹药箱'])
const DIFFERENT_MAPS = new Set(['ascent', 'flashpoint', 'trench', 'umuscanal', 'aftershock'])

const round = (value) => Math.round(value * 1000) / 1000
const parseXY = (value) => {
  const match = /X=([\d.-]+),Y=([\d.-]+)/.exec(value || '')
  return match ? [Number(match[1]), Number(match[2])] : null
}

function converter(info) {
  const bound = 128
  const xRatio = info.width / bound
  const yRatio = info.height / bound
  return (x, y) => {
    let projectedX
    let projectedY
    if (info.rotate === 90) {
      projectedX = bound - (info.centerY + y) / yRatio
      projectedY = -bound + (info.centerX - x) / xRatio
    } else if (info.rotate === -90) {
      projectedX = bound + (info.centerY + y) / yRatio
      projectedY = -bound - (info.centerX - x) / xRatio
    } else {
      projectedX = bound - (info.centerX - x) / xRatio
      projectedY = -bound - (info.centerY + y) / yRatio
    }
    return [round(projectedY), round(projectedX)]
  }
}

function loadOfficial(file) {
  const context = { window: {} }
  vm.createContext(context)
  vm.runInContext(fs.readFileSync(file, 'utf8'), context)
  return context.window
}

function pointOf(item, convert) {
  return convert(Number(item.x), Number(item.y))
}

function borderOf(item, convert) {
  return (item.border || []).map(parseXY).filter(Boolean).map(([x, y]) => convert(x, y))
}

function stageOf(items, index, convert, initItems = items) {
  const points = items.filter((item) => /^q_jd_/.test(item.icon || '')).map((item) => {
    const [lat, lng] = pointOf(item, convert)
    return { name: item.name, lat, lng, note: item['自定义区域'] === '-' ? '' : (item['自定义区域'] || ''), icon: item.icon, capturable: borderOf(item, convert) }
  })
  const zoneItem = items.find((item) => item.name === '区域' || item.icon === 'g_qy')
  // 基地区域优先读取 init.typeList。腾讯当前 map_dg.js 的 mapArticle
  // 把断轨 S4 守方 border 错误复制成攻方 border，而 init 中仍是正确数据。
  const attackBases = initItems.filter((item) => item.name === '进攻方基地' || item.icon === 'g_jdbsd_r')
  const defenseBases = initItems.filter((item) => item.name === '防守方基地' || item.icon === 'f_jdbsd_g')
  const ignored = new Set([...points.map((point) => point.icon), 'g_qy', 'g_jdbsd_r', 'f_jdbsd_g'])
  const vehicleItems = items.filter((item) => !ignored.has(item.icon) && !PROP_NAMES.has(item.name))
  const vehicles = {}
  for (const item of vehicleItems) {
    const key = `${item.name}|${item.icon}`
    ;(vehicles[key] ||= { name: item.name, icon: item.icon, trigger: item['激活条件'] === '-' ? '' : (item['激活条件'] || ''), positions: [] }).positions.push(pointOf(item, convert))
  }
  const firstBorder = (bases) => borderOf(bases.find((item) => item.border?.length) || {}, convert)
  return {
    id: `S${index + 1}`,
    points,
    zone: zoneItem ? { latlngs: borderOf(zoneItem, convert) } : null,
    attackSpawns: attackBases.map((item) => pointOf(item, convert)),
    attackSpawnNames: attackBases.map((item) => item['自定义区域'] || null),
    defenseSpawns: defenseBases.map((item) => pointOf(item, convert)),
    defenseSpawnNames: defenseBases.map((item) => item['自定义区域'] || null),
    attackBaseZone: firstBorder(attackBases),
    defenseBaseZone: firstBorder(defenseBases),
    vehicles: Object.values(vehicles),
  }
}

const temp = process.env.TEMP
const output = { maps: {}, props: {} }
for (const [mapId, officialKey, fileStem] of SPECS) {
  if (!DIFFERENT_MAPS.has(mapId)) continue
  const window = loadOfficial(path.join(temp, `df_official_${fileStem}.js`))
  const info = window[officialKey].info
  const convert = converter(info)
  const mobile = window[`${officialKey}_mobile`]
  output.maps[mapId] = mobile.mapArticle.map((items, index) => stageOf(items, index, convert, mobile.init[index]?.typeList ?? items))
  output.props[mapId] = mobile.mapArticle.flatMap((items, index) => items
    .filter((item) => PROP_NAMES.has(item.name))
    .map((item) => {
      const [lat, lng] = pointOf(item, convert)
      return { name: item.name, icon: item.icon, lat, lng, stage: item.region || `S${index + 1}` }
    }))
}

const target = path.resolve('src/config/mobileOfficialData.ts')
const source = `// 腾讯官方地图工具手游攻防数据（2026-08-11 提取），由 scripts/generate-mobile-official-data.cjs 生成\n` +
  `export const MOBILE_OFFICIAL_DATA = ${JSON.stringify(output, null, 2)} as const\n`
fs.writeFileSync(target, source)
console.log(`Wrote ${target}`)
