/** 攻防双方 */
export type Side = 'attack' | 'defense'

/** 画笔工具模式（问题4：新增橡皮擦；第九轮：新增普通画笔 pen；第十一轮：新增套索 lasso；第二十二轮：新增防线 defense；第十六轮：编辑能力常驻，删除独立编辑工具） */
export type ToolMode = 'pan' | 'pen' | 'line' | 'arrow' | 'rect' | 'circle' | 'text' | 'eraser' | 'lasso' | 'defense'

/** 画笔线型（问题4：实线/虚线/点线） */
export type DashType = 'solid' | 'dashed' | 'dotted'

/** 线条路径样式（第二十二轮：直线 / 曲线贝塞尔 / 手绘自由轨迹） */
export type CurveStyle = 'straight' | 'smooth' | 'freehand'

/** 橡皮擦模式：局部裁断笔迹 / 触碰即删除整个图形 */
export type EraserMode = 'stroke' | 'shape'

/** 箭头头部形状（第十六轮：新增 实心 solid / 空心 outline / 三角形 triangle；旧样式保留兼容） */
export type ArrowHeadStyle = 'triangle' | 'classic' | 'chevron' | 'diamond' | 'solid' | 'outline'

/** 画笔工具设置（问题4：颜色/线宽/线型；箭头：形状/大小；第二十二轮：路径样式） */
export interface DrawSettings {
  color: string
  weight: number
  dash: DashType
  /** 箭头头部形状（默认实心三角） */
  arrowStyle: ArrowHeadStyle
  /** 箭头头部大小 px（6-20） */
  arrowSize: number
  /** 线条路径样式：直线 / 曲线（贝塞尔，绘制时拖控制点） / 手绘（按住自由画），作用于 line/arrow/defense */
  curve: CurveStyle
  /** 曲线曲度（0-100，越大越弯；仅 curve=smooth 时生效） */
  curveAmount: number
  /** 矩形/圆形填充色 */
  fillColor: string
  /** 矩形/圆形是否填充（默认 false） */
  fillEnabled: boolean
  /** 橡皮擦笔头直径 px */
  eraserSize: number
  /** 橡皮擦工作模式 */
  eraserMode: EraserMode
}

/**
 * 点位状态（按攻防推进阶段）：
 * captured = 已攻下（进攻方占领）/ active = 当前争夺（中立）/ locked = 未激活（防守方控制）
 */
export type PointStatus = 'active' | 'captured' | 'locked'

/** 攻防据点（坐标来自官网地图工具脚本，已换算为地图经纬度） */
export interface CapturePoint {
  name: string
  lat: number
  lng: number
  /** 备注（如 滩头前线） */
  note: string
  /** 官网图标名（dzc_i 目录下，如 q_jd_a） */
  icon: string
  /** 据点可占领区域边界（官网据点对象 border 换算），实线边框渲染 */
  capturable: [number, number][]
}

/** 区域多边形（官网 区域 border 数据） */
export interface ZonePolygon {
  name: string
  latlngs: [number, number][]
}

/** 官网攻防载具模板（按阶段配置，位置为官方部署点） */
export interface StageVehicle {
  name: string
  badge: string
  category: VehicleCategory
  /** 官网图标名（dzc_i 目录，如 q_cfz） */
  icon: string
  /** 官网激活条件（展示用） */
  trigger: string
  /** 官方初始部署位置 [lat, lng] */
  pos: [number, number]
  /** 该载具全部官方部署点 [lat, lng][] */
  posList: [number, number][]
}

/** 地图道具（官网地图工具数据：固定防空炮/固定机枪/岸防炮/滑索/电梯/固定弹药箱/载具补给站） */
export interface MapProp {
  name: string
  /** 官网图标名（dzc_i 目录，如 q_gdaap） */
  icon: string
  lat: number
  lng: number
  /** 阶段归属（如 攀升S1 / S1），可为空表示全局 */
  stage: string
}

/** 攻防阶段配置（阶段顺序即攻防推进顺序） */
export interface StageSpawnPoint {
  /** 复活点稳定唯一 ID；名称与数组顺序改变时保持不变。 */
  uid: string
  stageId: string
  name: string
  side: Side
  lat: number
  lng: number
}

export interface StageConfig {
  id: string
  label: string
  points: CapturePoint[]
  /** 防线区域（官网"区域"对象 border，虚线边框） */
  zone: ZonePolygon | null
  /** 统一复活点数据；正式版与模式编辑器均以 uid 作为身份。 */
  spawns: StageSpawnPoint[]
  /** 进攻方复活点（本阶段全部进攻方基地，同级无优先级，问题2） */
  attackSpawns: [number, number][]
  /** 防守方复活点（本阶段全部防守方基地，同级无优先级） */
  defenseSpawns: [number, number][]
  /** 进攻方复活点基地名（与 attackSpawns 一一对应，如 "北边滩头"/"海上基地"；用于载具部署过滤） */
  attackSpawnNames?: string[]
  /** 防守方复活点基地名（与 defenseSpawns 一一对应） */
  defenseSpawnNames?: string[]
  /** 进攻方基地区域边界（攻方可活动区域） */
  attackBaseZone: [number, number][]
  /** 防守方基地区域边界（守方可活动区域） */
  defenseBaseZone: [number, number][]
  /** 本阶段攻方可部署载具（官网数据） */
  attackVehicles: StageVehicle[]
  /** 本阶段守方可部署载具（官网攻防模式无守方载具） */
  defenseVehicles: StageVehicle[]
}

/** 地图配置（对齐官网 df.qq.com/cp/a20240729directory 数据） */
export interface MapConfig {
  id: string
  name: string
  enName: string
  /** 腾讯 CDN 瓦片目录名，如 map_pc / map_ljd_pc */
  layerName: string
  /** 瓦片 URL 模板（含 {z}_{x}_{y} 占位） */
  tileUrl: string
  minZoom: number
  initZoom: number
  maxZoom: number
  /** 瓦片原始最高缩放级，超出后由 Leaflet 放大 */
  maxNativeZoom: number
  /** 官网 mapScaleInfo.boundsW（负值） */
  boundsW: number
  /** 官网 mapScaleInfo.boundsH */
  boundsH: number
  /** 地图可视范围（CRS.Simple 坐标），对应官网 southWest / northEast */
  southWest: [number, number]
  northEast: [number, number]
  /** 初始视角中心 */
  initCenter: [number, number]
}

/** 自定义游戏模式配置的核验状态。 */
export type ModeConfigVerification = 'draft' | 'confirmed'

/** 自定义模式区域语义；颜色仍可单独调整。 */
export type ModeZoneKind = 'own' | 'enemy' | 'neutral' | 'restricted'
export type ModeZoneRole = 'attack-base' | 'defense-base' | 'capture' | 'frontline' | 'custom'

export interface ModeZone {
  uid: string
  stageId: string
  name: string
  kind: ModeZoneKind
  role: ModeZoneRole
  /** role=capture 时绑定的据点 uid。 */
  objectiveUid?: string
  color: string
  points: [number, number][]
  verification: ModeConfigVerification
}

export interface ModeSpawnPoint extends StageSpawnPoint {
  vehicleDeploy: boolean
  /** 旧版分类字段，保留用于导入兼容；新配置以 deployVehicles 为准。 */
  vehicleCategories: VehicleCategory[]
  deployVehicles: ModeDeployVehicle[]
  verification: ModeConfigVerification
}

export interface ModeDeployVehicle {
  name: string
  icon: string
  iconUrl: string
  legendKey?: string
  badge: string
  category: VehicleCategory
  cd: number
  num: number
  allowTeammate: boolean
}

/** 自定义模式据点标记，使用攻防模式相同的 q_jd_* 正式图标。 */
export interface ModeObjectivePoint {
  uid: string
  stageId: string
  name: string
  note: string
  icon: string
  /** 与据点标识绑定的占领区 uid。 */
  captureZoneUid: string
  lat: number
  lng: number
  verification: ModeConfigVerification
}

/** 自定义模式地图道具；stageId='*' 表示所有阶段可见。 */
export interface ModeMapProp {
  uid: string
  stageId: string
  name: string
  icon: string
  lat: number
  lng: number
  verification: ModeConfigVerification
}

export type ModeVehicleRefreshTriggerType =
  | 'tickets'
  | 'match-time'
  | 'objective-countdown'
  | 'objective-captured'
  | 'map-event'

/** 胜者为王载具刷新条件；实时比赛状态暂不由应用自动读取。 */
export interface ModeVehicleRefreshTrigger {
  type: ModeVehicleRefreshTriggerType
  /** 兵力为 number；时间使用 HH:mm 或原始事件说明。 */
  value: number | string
}

/** 可被多条刷新规则共用的地图坐标。 */
export interface ModeVehicleRefreshPoint {
  uid: string
  name: string
  lat: number
  lng: number
  verification: ModeConfigVerification
}

/** 胜者为王模式的条件式载具刷新规则。 */
export interface ModeVehicleRefreshRule {
  uid: string
  objective: string
  side: Side
  action: 'refresh' | 'disable'
  trigger: ModeVehicleRefreshTrigger
  vehicle: ModeDeployVehicle
  quantity: number
  /** 空字符串表示尚未在地图上标注；多条规则可引用同一刷新位置。 */
  refreshPointUid: string
  note: string
  verification: ModeConfigVerification
}

/** 模式地图自身的阶段定义；允许不同于攻防模式增删阶段。 */
export interface ModeStageDefinition {
  id: string
  label: string
}

/** 某个模式在一张底图上的差异覆盖配置。 */
export interface ModeMapOverride {
  mapId: string
  notes: string
  stages: ModeStageDefinition[]
  zones: ModeZone[]
  spawns: ModeSpawnPoint[]
  objectives: ModeObjectivePoint[]
  props: ModeMapProp[]
  vehicleRefreshPoints: ModeVehicleRefreshPoint[]
  vehicleRefreshRules: ModeVehicleRefreshRule[]
  updatedAt: number
}

/** 通用模式档案；每张地图只保存相对攻防模式不同的覆盖数据。 */
export interface GameModeProfile {
  id: string
  name: string
  description: string
  maps: Record<string, ModeMapOverride>
  /** 支持双数据端的模式按 PC / PE（移动端游戏数据）分别保存；maps 保持为 PC 兼容别名。 */
  platformMaps?: Partial<Record<'pc' | 'mobile', Record<string, ModeMapOverride>>>
  createdAt: number
  updatedAt: number
}

export interface ModeConfigStore {
  version: 34
  activeModeId: string
  profiles: GameModeProfile[]
}

export type ModeEditorTool = 'select' | 'zone' | 'spawn' | 'objective' | 'prop' | 'vehicle-refresh'

export type ModeEditorSelection =
  | { kind: 'zone'; uid: string }
  | { kind: 'spawn'; uid: string }
  | { kind: 'objective'; uid: string }
  | { kind: 'prop'; uid: string }
  | { kind: 'vehicle-refresh-point'; uid: string }
  | null

export type ModeEditorSelectionItem = Exclude<ModeEditorSelection, null>

export interface ModeEditorSession {
  open: boolean
  profileId: string | null
  stageId: string
  tool: ModeEditorTool
  zoneRole: ModeZoneRole
  selected: ModeEditorSelection
  /** 多选集合；selected 始终指向最后操作的主选项，供属性面板和顶点编辑使用。 */
  selectedItems: ModeEditorSelectionItem[]
  zoneDraft: [number, number][]
}

/** 载具分类 */
export type VehicleCategory = 'tank' | 'ifv' | 'apc' | 'recon' | 'helo' | 'water' | 'supply'

/** 已放置的载具实例 */
export interface VehicleItem {
  uid: string
  name: string
  category: VehicleCategory
  side: Side
  /** 所属小队；旧存档载具在读取时自动归入 A 队 */
  team?: OperatorTeam
  /** 卡片徽标（图标加载失败时兜底） */
  badge: string
  /** 官网图标 URL（dzc_i/q_*.png） */
  iconUrl: string
  lat: number
  lng: number
  /** 所属阶段（如 S1） */
  stageId: string
  /** 旋转角度（度，0-360，问题3：滚轮旋转，持久化） */
  rotation: number
  /** 是否显示随兵棋朝向旋转的枪线。 */
  fireLineEnabled?: boolean
  /** 枪线地图距离。 */
  fireLineLength?: number
  /** 是否为玩家自定义部署（非官方固定部署点，问题3） */
  custom?: boolean
  /** 本方/敌方部署（本方=绿底、敌方=红底；旧数据无此字段时按 side 兼容） */
  own?: boolean
  /** 由胜者为王载具刷新规则创建；官方刷新点本身不会被转换或移动。 */
  sourceType?: 'vehicle-refresh'
  sourceRuleUid?: string
  sourcePointUid?: string
}

/** 兵棋推演中的固定建筑单位；仅区分阵营，不隶属于任何小队。 */
export type BuildingUnitKind = 'fixed-machine-gun' | 'fixed-anti-air' | 'coastal-gun'

export interface BuildingUnit {
  uid: string
  kind: BuildingUnitKind
  name: string
  side: Side
  team?: OperatorTeam
  lat: number
  lng: number
  stageId: string
  rotation: number
  fireLineEnabled?: boolean
  fireLineLength?: number
}

/** 文字标注（由画笔 GeoJSON 中的 Point 特征推导） */
export interface TextAnnotation {
  uid: string
  text: string
  lat: number
  lng: number
}

/** 进行中的文字标注编辑会话（由地图图层发起，原位编辑器消费） */
export interface ActiveTextEdit {
  /** 唯一编辑会话编号；所有异步回调必须校验该编号，避免旧会话清理新会话。 */
  sessionId: number
  uid: string
  lat: number
  lng: number
  initialText: string
  commit: (text: string) => void
  cancel: () => void
  /** 幂等释放原位编辑器拥有的 DOM、事件监听及地图状态。 */
  dispose: () => void
  /** 重复请求编辑同一文本时只恢复焦点，不创建第二套编辑器。 */
  focus?: () => void
  /** 原位编辑器读取当前文本，避免使用独立浮层输入框。 */
  getText?: () => string
  /** 地图容器内的像素坐标（第十三轮：文字编辑器跟随标注位置显示） */
  containerPoint?: { x: number; y: number }
}

/** 文字标注样式（第十五轮：编辑工具下可调字号/底色/边框/字体/字重/颜色/对齐） */
export interface TextStyleProps {
  /** 字号 px（8-72） */
  fontSize?: number
  /** 文字颜色 */
  color?: string
  /** 背景颜色；空/transparent = 透明背景 */
  backgroundColor?: string
  /** 边框颜色 */
  borderColor?: string
  /** 边框宽度 px（0 = 无边框） */
  borderWidth?: number
  /** 边框样式 */
  borderStyle?: 'solid' | 'dashed' | 'dotted' | 'none'
  /** 字体族（默认 / 微软雅黑 / Arial / 楷体 / 黑体 / 宋体） */
  fontFamily?: string
  /** 字重 */
  fontWeight?: 'normal' | 'bold'
  /** 斜体 */
  fontStyle?: 'normal' | 'italic'
  /** 对齐方式 */
  textAlign?: 'left' | 'center' | 'right'
  /** 文本框宽度 px */
  width?: number
  /** 顺时针旋转角度 */
  rotation?: number
}

/** 单张地图的完整战术数据 */
export interface MapState {
  /** 载具按攻/守方分桶存储（与画笔绘制对称：切换视角只显示当前视角桶） */
  vehicles: Record<Side, VehicleItem[]>
  /** 兵棋推演建筑单位，按当前攻/守视角分档保存；单位本身只有阵营属性。 */
  buildings: Record<Side, BuildingUnit[]>
  /** 每方独立画笔图层（GeoJSON FeatureCollection 字符串） */
  drawings: Record<Side, string>
  /** 兵棋推演干员（按攻/守分桶；每方默认 5 队×4 人 = 20 人） */
  operators: Record<Side, OperatorUnit[]>
  /** 兵棋推演协同关系（按攻/守视角分桶） */
  connections: Record<Side, OperatorConnection[]>
  /** 兵棋推演队标（按攻/守分桶，仅表达队伍归属） */
  teams: Record<Side, TeamMarker[]>
  /** 兵棋推演进攻路线（按视角分桶） */
  routes: Record<Side, TacticalRoute[]>
  /** 阵地支援效果，按攻/守分桶保存。 */
  fieldSupports: Record<Side, FieldSupportInstance[]>
  /** 当前阶段/回合内的干员技能行动。 */
  skillActions: OperatorSkillAction[]
  /** 兵棋推演控制状态（回合数等） */
  wargame: WargameState
  /** 按阶段×回合保存的兵棋/绘制快照。 */
  tacticalBuckets?: TacticalBucketStore
}

export interface TacticalBucket {
  key: string
  stageId: string
  round: number
  updatedAt: number
  vehicles: Record<Side, VehicleItem[]>
  buildings: Record<Side, BuildingUnit[]>
  drawings: Record<Side, string>
  operators: Record<Side, OperatorUnit[]>
  connections: Record<Side, OperatorConnection[]>
  teams: Record<Side, TeamMarker[]>
  routes: Record<Side, TacticalRoute[]>
  fieldSupports: Record<Side, FieldSupportInstance[]>
  /** 干员技能的独立使用记录；同一技能可在同一回合重复使用。 */
  skillActions: OperatorSkillAction[]
  notesMarkdown: string
}

export type OperatorSkillActionGeometry =
  | { type: 'point'; position: [number, number] }
  | { type: 'area'; center: [number, number]; radius: number; radiusRatio?: number }
  | { type: 'line'; points: [number, number][]; width?: number; widthRatio?: number }
  | { type: 'trajectory'; points: [number, number][] }
  | { type: 'curve'; start: [number, number]; controls?: [number, number][]; control?: [number, number]; end: [number, number] }

export interface OperatorSkillAction {
  uid: string
  sourceOperatorUid: string
  operatorId: string
  /** 技能槽位；战术道具行动没有槽位。 */
  skillSlot?: 1 | 2 | 3 | 4
  skillName: string
  kind: 'ultimate' | 'gadget' | 'passive'
  sourceKind?: 'skill' | 'tactical-item'
  tacticalItemId?: string
  tacticalItemUseType?: 'carry' | 'self' | 'placement' | 'launcher' | 'target'
  iconUrl?: string
  placementMode?: 'self' | 'target-point' | 'area' | 'trajectory' | 'guided-path' | 'target-unit' | 'ally-unit'
  side: Side
  geometry?: OperatorSkillActionGeometry
  targetUid?: string
  effectArea?: boolean
  canBindTarget?: boolean
  tracking?: boolean
  sector?: boolean
  visible: boolean
  createdAt: number
}

/** 阵地支援图标定义。 */
export interface FieldSupportDefinition {
  id: string
  name: string
  iconUrl: string
  description: string
  defaultRadius: number
}

/** 已放置的阵地支援范围。 */
export interface FieldSupportInstance {
  uid: string
  definitionId: string
  name: string
  iconUrl: string
  side: Side
  lat: number
  lng: number
  radius: number
  stageId: string
}

export interface TacticalBucketStore {
  activeKey: string
  buckets: Record<string, TacticalBucket>
}

/** 干员职业（三角洲行动四类定位） */
export type OperatorClass = 'assault' | 'engineer' | 'medical' | 'recon'

/** 干员生命状态（兵棋推演） */
export type OperatorStatus = 'alive' | 'injured' | 'killed'

/** 干员所属队伍（每方 A-E 五个队） */
export type OperatorTeam = 'A' | 'B' | 'C' | 'D' | 'E'

/** 兵棋推演：单个干员单位 */
export interface OperatorUnit {
  uid: string
  /** 干员代号（如 A1/B3），同一方内唯一 */
  name: string
  side: Side
  team: OperatorTeam
  /** 具体干员档案 id（config/operatorProfiles.ts，如 红狼=10000/蜂医=10001） */
  operatorId: string
  /** 职业（随所选干员档案派生，存一份便于查询/兼容旧数据） */
  cls: OperatorClass
  status: OperatorStatus
  /** 地图坐标；null = 未部署 */
  lat: number | null
  lng: number | null
  /** 步兵朝向（0=正北）。 */
  rotation?: number
  fireLineEnabled?: boolean
  fireLineLength?: number
  /** 当前选择使用的干员技能槽位；技能与 operatorId 绑定。 */
  activeSkillSlot?: 1 | 2 | 3 | 4
}

/** 兵棋推演：干员间协同关系；仅表示双方协同，不表示移动。 */
export interface OperatorConnection {
  id: string
  /** 所属视角（跟随干员所在方） */
  side: Side
  operatorAId: string
  operatorBId: string
  /** 创建关系的队伍；允许同阵营跨队协同。 */
  team: OperatorTeam
  /** 旧存档兼容字段；当前协同关系统一使用无方向点线。 */
  style: 'solid' | 'dashed'
  label?: string
  createdAt: number
}

/** 旧存档兼容类型；队标界面不再区分步兵/载具职责。 */
export type TeamRoleType = 'infantry' | 'vehicle'

/**
 * 兵棋推演：队标棋子（第二十三轮新增）。
 * 一种简化部署单位——不需要逐个部署干员时，用队标表示一个小队：
 * 样式与干员棋子相近（队伍色圆底 + 队伍字母 + 小队名），
 * 大小与载具卡片相当（30px）。每个阵营的每支队伍部署一个。
 */
export interface TeamMarker {
  uid: string
  /** 所属阵营（攻/守） */
  side: Side
  /** 所属队伍（决定圆底颜色/字母） */
  team: OperatorTeam
  /** 旧存档兼容字段；不再影响队标外观或职责。 */
  role: TeamRoleType
  /** 小队名称（棋子上方，如 "A队1排"） */
  name: string
  /** 地图坐标；null = 未部署 */
  lat: number | null
  lng: number | null
  rotation?: number
  fireLineEnabled?: boolean
  fireLineLength?: number
}

/** 行动指令类型（路线 V2） */
export type TacticalOrderType = 'move' | 'attack' | 'recon' | 'flank' | 'retreat' | 'escort' | 'resupply' | 'hold'

/** 行动指令执行状态 */
export type TacticalOrderStatus = 'planned' | 'pending' | 'executing' | 'completed' | 'cancelled'

/** 路线线型 */
export type TacticalRouteLineStyle = 'solid' | 'dashed' | 'dotted'
export type TacticalRouteGeometry = 'straight' | 'curve'

/** 路线终点吸附目标 */
export interface TacticalRouteTarget {
  kind: 'point' | 'team' | 'operator' | 'vehicle' | 'building'
  uid: string
  label: string
}

/** 兵棋推演：由队标发起的路线行动指令 */
export interface TacticalRoute {
  uid: string
  /** 路线所属阵营与小队 */
  side: Side
  team: OperatorTeam
  /** 发起路线的队标；用于队标移动时同步路线起点 */
  teamMarkerUid: string
  /** 起点锚定方式：队标 / 干员 / 载具 / 父路线节点 / 自由起点 */
  anchorMode: 'team' | 'operator' | 'vehicle' | 'building' | 'branch' | 'free'
  /** 干员独立任务路线的起点锚定干员 */
  anchorOperatorUid?: string
  /** 载具任务路线或自由路线吸附后锚定的载具 */
  anchorVehicleUid?: string
  /** 建筑单位任务路线的起点锚定建筑。 */
  anchorBuildingUid?: string
  name: string
  /** 单条路线标签开关；未设置兼容为显示。 */
  showLabel?: boolean
  orderType: TacticalOrderType
  status: TacticalOrderStatus
  /** 自定义路线色；行动类型切换时会应用该类型默认色 */
  color: string
  lineStyle: TacticalRouteLineStyle
  geometryType?: TacticalRouteGeometry
  opacity: number
  /** 线条粗细（像素）；旧存档缺失时使用默认值。 */
  strokeWidth?: number
  /** 地图坐标 [lat, lng]；首点始终锚定队标 */
  waypoints: [number, number][]
  /** 指令标签的自定义地图位置；未设置时自动放在路线首段中点。 */
  labelPosition?: [number, number]
  /** 创建路线时自动绑定的同队兵棋资源 */
  operatorIds: string[]
  vehicleIds: string[]
  /** 终点吸附的兵棋/地图对象 */
  target?: TacticalRouteTarget
  /** 分支来源；分支首点锚定父路线节点，而不是队标 */
  branchFromRouteUid?: string
  branchFromWaypointIndex?: number
  createdAt: number
}

/** 兵棋推演状态（回合制推进） */
export interface WargameState {
  /** 是否启用兵棋推演模式（控制干员/联线图层显示） */
  enabled: boolean
  /** 当前回合数 */
  round: number
  /** 联线是否显示（数据保留，可隐藏） */
  showConnections: boolean
  /** 枪线总显示开关；关闭时保留各兵棋的独立设置。 */
  showFireLines: boolean
  /** 是否显示兵棋路线的指令标签。 */
  showRouteLabels: boolean
  /** 旧版阶段/回合备注字段，仅用于兼容迁移。 */
  notesMarkdown: string
  /** 按阶段保存的 Markdown 推演备注；切换回合时保持不变。 */
  stageNotes: Record<string, string>
  /** 备注内粘贴图片的数据，以短 ID 引用，避免正文存入超长 data URL。 */
  noteImages: Record<string, string>
  /** 是否处于协同关系编辑模式（依次点击两名干员建立关系） */
  connectMode: boolean
  /** 各小队作用描述（可编辑，键为队伍 id：A/B/C/D/E；缺省回退 TEAMS.desc） */
  teamRoles: Record<string, string>
  /** 手动设置的对局状态，用于判断胜者为王载具刷新规则是否满足。 */
  battleContext: TacticalBattleContext
  /** 每个战术视角中本轮已经使用过的刷新规则；载具损失后仍保留。 */
  usedVehicleRefreshRuleIds: Record<Side, string[]>
}

export interface TacticalBattleContext {
  /** 进攻方当前兵力；防守方固定为 null，表示无限兵力。 */
  tickets: Record<Side, number | null>
  /** 已进行的比赛时间（秒）；null 表示尚未设置。 */
  matchTimeSeconds: number | null
  /** 据点实时占领状态，以据点名称为键。 */
  objectiveStates: Record<string, TacticalObjectiveState>
  /** 旧版简单占领列表，仅用于读取迁移。 */
  capturedObjectives?: string[]
  /** 据点倒计时剩余秒数，以据点名称为键；null/缺失表示尚未设置。 */
  objectiveCountdowns: Record<string, number | null>
  /** 已触发的地图事件名称。 */
  mapEvents: string[]
}

export type TacticalObjectiveOwner = Side | 'neutral'

export interface TacticalObjectiveState {
  /** 据点当前归属；neutral 表示中立/正在占领。 */
  owner: TacticalObjectiveOwner
  /** 正在读条的一方；已有归属时只能是另一方。 */
  capturingSide: Side | null
  /** 连续占领进度，范围 0-100。 */
  progress: number
}

/** 撤回/恢复历史快照：双方载具 + 双方绘制（按 地图+视角 分栈） */
export interface MapStateSnapshot {
  vehicles: Record<Side, VehicleItem[]>
  buildings?: Record<Side, BuildingUnit[]>
  drawings: Record<Side, string>
  /** 兵棋推演干员与联线（v9 新增，随快照入栈） */
  operators: Record<Side, OperatorUnit[]>
  connections: Record<Side, OperatorConnection[]>
  /** 兵棋推演队标（v11 新增，随快照入栈） */
  teams: Record<Side, TeamMarker[]>
  routes: Record<Side, TacticalRoute[]>
  fieldSupports?: Record<Side, FieldSupportInstance[]>
  skillActions?: OperatorSkillAction[]
}

/** 撤回/恢复历史条目 */
export interface HistoryEntry {
  before: MapStateSnapshot
  after: MapStateSnapshot
}

/** 历史栈键：`${gameDataPlatform}:${modeId}:${mapId}:${view}` */
export type HistoryKey = string

/** 所有战术上下文的数据（以“游戏数据端:模式ID:地图ID”为键） */
export type MapsData = Record<string, MapState>

/**
 * 战术方案（第二十一轮：保存各阶段默认战术部署）：
 * 记录某个 地图×阶段×视角 下的完整战术布置快照，可自定义名称后保存/应用。
 */
export interface TacticalPlan {
  id: string
  /** 自定义战术名称（如 "开局强攻 A 点"） */
  name: string
  mapId: string
  /** 《三角洲行动》游戏数据端，不表示应用运行平台。 */
  gameDataPlatform: 'pc' | 'mobile'
  /** 方案所属游戏模式，避免攻防/胜者/自定义模式互相覆盖。 */
  modeId: string
  stageId: string
  view: Side
  createdAt: number
  /** 该视角载具桶（含本方/敌方载具） */
  vehicles: VehicleItem[]
  /** 该视角绘制 GeoJSON */
  drawings: string
  /** 该视角兵棋干员桶（含双方 40 人） */
  operators: OperatorUnit[]
  /** 该视角兵棋协同关系 */
  connections: OperatorConnection[]
  /** 该视角兵棋队标（第二十三轮） */
  teams: TeamMarker[]
  /** 该视角的队伍进攻路线 */
  routes: TacticalRoute[]
  fieldSupports?: FieldSupportInstance[]
  skillActions?: OperatorSkillAction[]
  /** 保存方案时本轮已经使用的载具刷新规则（包括兵棋已损失的规则）。 */
  usedVehicleRefreshRuleIds?: string[]
  /** 保存方案时的兵力、时间、据点占领与地图事件状态。 */
  battleContext?: TacticalBattleContext
}

/** 图层显示开关（问题1：地图道具等图层控制） */
export interface LayerVisibility {
  props: boolean
  /** “据点与防线”总开关。 */
  points: boolean
  /** 据点标识（A点图标 + "据点A"字样），可与据点区域分离隐藏 */
  pointsLabels: boolean
  /** 据点图标下方的名称文字。 */
  pointAnnotations: boolean
  /** 据点自身的可占领区域。 */
  pointsCapture: boolean
  /** 据点当前所在阶段的防线区域。 */
  pointsFrontline: boolean
  spawns: boolean
  /** 复活点图标下方的名称文字。 */
  spawnAnnotations: boolean
  zones: boolean
  /** 胜者为王的条件式载具刷新位置。 */
  vehicleRefresh: boolean
}

/** 地图道具按类型显示开关（问题2：每个道具类型独立控制） */
export type PropVisibility = Record<string, boolean>

/** localStorage 持久化结构 */
export interface PersistedAppState {
  version: number
  lastMapId: string
  lastView: Side
  maps: MapsData
  /** 各战术上下文当前激活阶段下标，键同 maps。 */
  progress: Record<string, number>
  /** 战术方案库（第二十一轮：按 地图×阶段×视角 保存的默认部署） */
  plans: TacticalPlan[]
  /** 界面折叠状态（左右工具栏收起/展开）+ 图层/道具开关 + 画笔设置 */
  ui: {
    paletteOpen: boolean
    panelOpen: boolean
    /** 左下角区域图例是否展开。 */
    legendOpen: boolean
    /** 左侧栏宽度：250px 最小，默认 300px，最大 440px。 */
    leftPanelWidth: number
    /** Android 官方地图图标视觉比例；触控热区不随之缩放。 */
    mapMarkerScale: number
    layers: LayerVisibility
    propVis: PropVisibility
    /** 画笔工具设置（问题4：颜色/线宽/线型） */
    draw: DrawSettings
    /** 左侧面板折叠区块展开状态（地图分层/道具子列表/自定义载具/兵棋推演），持久化避免收缩后重置 */
    sections: {
      layers: boolean
      props: boolean
      points: boolean
      vehicles: boolean
      wargame: boolean
      /** 自定义载具内部分组（地面/空中/水上）展开状态，按组名存储 */
      vehGroups: Record<string, boolean>
    }
  }
}
