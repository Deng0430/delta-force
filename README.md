<div align="center">
  <img src="./build/logo.png" width="180" alt="三角洲战术地图 Logo" />
  <h1>三角洲战术地图</h1>
  <p>面向《三角洲行动》全面战场的地图标注、兵棋推演与战术方案编辑工具。</p>
</div>

> 本项目是非官方社区工具，与腾讯、琳琅天上及《三角洲行动》官方无隶属或合作关系。

## 项目简介

三角洲战术地图将地图信息、阶段据点、载具部署、干员编组和行动路线集中到一个工作台中。它既可以作为浏览器应用运行，也可以打包为 Windows 桌面应用，适合战前规划、队伍分工、战术复盘和自定义模式配置。

项目不依赖后端服务。编辑状态、战术方案和模式配置默认保存在浏览器或 Electron 的本地存储中。

## 核心功能

- 支持 11 张全面战场地图，并按地图展示阶段、据点、攻守方复活点、活动区域和地图道具。
- 在攻方与守方视角之间独立编辑部署，避免双方标注相互干扰。
- 提供自由画笔、直线、箭头、防线、矩形、圆形、文字、套索和橡皮擦等地图工具。
- 支持颜色、粗细、线型、曲线、箭头样式、填充和橡皮擦范围等绘制参数。
- 支持撤回、恢复、选中删除，以及分别清除绘制、载具或全部战术内容。
- 支持地面、空中和水上载具部署，自定义阵营与小队归属。
- 支持攻守双方干员、小队、队标、状态、协同关系和批量部署管理。
- 支持机动、进攻、侦察、迂回、撤退、护送、补给和固守等行动指令。
- 行动路线可绑定小队、单兵或载具，并支持节点编辑、反转、复制和分支路线。
- 战术方案可以保存、重新应用，并导出为可独立打开的 HTML 战术板。
- 内置独立模式配置器，可编辑阶段、区域、据点、复活点、地图道具和载具规则。

## 技术栈

- React 19 + TypeScript
- Vite 8
- Leaflet + React Leaflet
- Leaflet Draw
- Electron 43
- electron-builder + NSIS

## 环境要求

- Node.js 20.19+、22.12+ 或更高版本
- npm 10+
- Windows 安装包构建需要 Windows x64 环境
- 地图瓦片来自在线资源，使用地图时需要网络连接

## 本地开发

安装依赖：

```bash
npm install
```

启动 Web 开发服务器：

```bash
npm run dev
```

浏览器访问：

```text
http://127.0.0.1:5173
```

Windows 用户也可以双击 `start-server.bat` 启动开发服务器。

## Electron 开发

先在一个终端启动 Vite：

```bash
npm run dev
```

再在另一个终端启动 Electron：

```bash
npm run electron:dev
```

开发模式下 Electron 会加载 `http://127.0.0.1:5173`。

## 构建

构建 Web 静态资源：

```bash
npm run build
```

本地预览生产构建：

```bash
npm run preview
```

构建 Windows x64 NSIS 安装包：

```bash
npm run build:win
```

构建产物输出到 `dist/` 和 `release/`。这些目录不纳入版本控制。

## 项目结构

```text
map-tools/
├─ build/                 # 应用 Logo、Windows 图标与 NSIS 安装脚本
├─ electron/              # Electron 主进程与内置静态服务器
├─ public/                # 干员、载具和界面静态资源
├─ src/
│  ├─ components/        # 地图图层、工具栏、推演面板与模式配置器
│  ├─ config/            # 地图、阶段、据点、干员和载具数据
│  ├─ utils/             # 本地存储、数据转换与战术板导出
│  ├─ App.tsx            # 主应用状态与业务编排
│  └─ types.ts           # 核心数据类型
├─ index.html             # 主地图入口
├─ mode-config.html       # 模式配置器入口
├─ electron-builder.yml   # Windows 打包配置
└─ vite.config.ts         # Web 构建配置
```

## 数据存储

- 主地图状态使用 `deltaforce-tactical-map-v1` 存储键。
- 模式配置使用 `deltaforce-mode-configs-v1` 存储键。
- Web 版数据位于浏览器 `localStorage`。
- 桌面版数据位于 Electron 用户数据目录对应的本地存储中。
- 卸载程序默认保留用户数据，重新安装后可以继续使用已有方案。

## 常用脚本

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动 Vite 开发服务器 |
| `npm run build` | 类型检查并构建 Web 版本 |
| `npm run preview` | 预览生产构建 |
| `npm run electron:dev` | 启动 Electron 开发版 |
| `npm run build:win` | 生成 Windows x64 安装包 |

## 版权与声明

项目中的游戏名称、地图瓦片、干员图像、载具图标及相关素材版权归各自权利方所有。本项目仅用于个人学习、战术研究与非商业交流，请勿用于商业用途或冒充官方产品。
