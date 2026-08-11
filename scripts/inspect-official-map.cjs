const fs = require('fs')
const path = require('path')
const vm = require('vm')

const file = process.argv[2]
if (!file) throw new Error('Usage: node scripts/inspect-official-map.cjs <official-map.js>')

const context = { window: {} }
vm.createContext(context)
vm.runInContext(fs.readFileSync(path.resolve(file), 'utf8'), context)

if (!process.argv.includes('--summary')) for (const [key, value] of Object.entries(context.window)) {
  if (!/_pc$|_mobile$/.test(key) || !value || !('navRegion' in value)) continue
  console.log(`\n${key}`, Object.keys(value))
  for (const property of ['navRegion', 'navRegionInfo', 'init', 'mapArticle', 'deploy']) {
    const item = value[property]
    console.log(property, Array.isArray(item) ? item.length : typeof item)
    console.log(JSON.stringify(item?.[0], null, 2)?.slice(0, 2500))
  }
}

if (process.argv.includes('--summary')) {
  for (const [key, value] of Object.entries(context.window)) {
    if (!/_pc$|_mobile$/.test(key) || !value || !('navRegion' in value)) continue
    console.log(`\nSUMMARY ${key}`)
    for (const property of ['init', 'mapArticle']) {
      console.log(property)
      for (const stage of value[property] || []) {
        const counts = {}
        const items = Array.isArray(stage) ? stage : stage.typeList || []
        for (const item of items) {
          const label = `${item.name}|${item.icon}|${item.region}|${item.isRegion}`
          counts[label] = (counts[label] || 0) + 1
        }
        console.log(stage.title, counts)
        if (property === 'mapArticle') {
          console.log('non-core', items.filter((item) => !/^(q_jd_|g_qy|g_jdbsd_r|f_jdbsd_g)/.test(item.icon || '') && !['载具补给站', '固定防空炮', '固定机枪', '岸防炮', '滑索', '电梯', '固定弹药箱'].includes(item.name)).map((item) => ({ name: item.name, icon: item.icon, faction: item['阵营'], region: item.region, trigger: item['激活条件'] })))
        }
      }
    }
  }
}
