/** 用户补充的载具图例原图，按项目使用的 deploy key 统一映射。 */
export const VEHICLE_LEGEND_ASSET_BY_DEPLOY_KEY: Readonly<Record<string, string>> = {
  aakfc: '/icons/vehicles/legend/nav_fkc.png',
  orvtjc: '/icons/vehicles/legend/nav_orvtjc.png',
  cfz: '/icons/vehicles/legend/nav_cfz.png',
  lstjp: '/icons/vehicles/legend/nav_lstjp.png',
  sxzjc: '/icons/vehicles/legend/两栖车.png',
  tjzsj: '/icons/vehicles/legend/nav_tjzsj.png',
  xnzsj: '/icons/vehicles/legend/nav_zczsj.png',
  g1bzc: '/icons/vehicles/legend/步战车.png',
  f45azdj: '/icons/vehicles/legend/固定翼.png',
  qxtk: '/icons/vehicles/legend/轻型坦克.png',
  m1a4zztk: '/icons/vehicles/legend/主战坦克.png',
  ymfg: '/icons/vehicles/legend/V-22鱼鹰-透明.png',
  ucb9597: '/icons/vehicles/legend/UCB-95-97攻击艇-透明.png',
}

export function vehicleLegendAssetUrl(deployKey: string): string | undefined {
  return VEHICLE_LEGEND_ASSET_BY_DEPLOY_KEY[deployKey]
}
