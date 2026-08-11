const fs = require('fs')
const vm = require('vm')

for (const file of process.argv.slice(2)) {
  const context = { window: {} }
  vm.createContext(context)
  vm.runInContext(fs.readFileSync(file, 'utf8'), context)
  const infoKey = Object.keys(context.window).find((key) => !/_pc$|_mobile$|_pc_s$|_mobile_s$/.test(key) && context.window[key]?.info)
  if (!infoKey) continue
  const pc = context.window[`${infoKey}_pc`]
  const mobile = context.window[`${infoKey}_mobile`]
  console.log(JSON.stringify({
    file,
    key: infoKey,
    layerPc: context.window[infoKey].info.names_pc,
    layerMobile: context.window[infoKey].info.names_mobile,
    sameInit: JSON.stringify(pc?.init) === JSON.stringify(mobile?.init),
    sameArticle: JSON.stringify(pc?.mapArticle) === JSON.stringify(mobile?.mapArticle),
    sameDeploy: JSON.stringify(pc?.deploy) === JSON.stringify(mobile?.deploy),
    stagesPc: pc?.init?.length,
    stagesMobile: mobile?.init?.length,
  }))
}
