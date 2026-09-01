# 五大联赛数据站 — 实施计划

> 前置文档：`data-site-mvp-plan.md`（数据源调研）
>
> 本文档是**施工图纸**：拿到新项目后按阶段执行，每个阶段有明确验收标准。

---

## 1. 技术栈（已定）

| 层 | 选型 | 理由 |
|---|---|---|
| 构建 | Vite 6 | 快、Vue 生态原生支持 |
| 框架 | Vue 3 (Composition API + `<script setup>`) | 熟悉、组件化、响应式 |
| 状态 | Pinia | 跨源数据缓存、联赛切换状态 |
| 路由 | Vue Router 4 | 多联赛多页面 |
| 语言 | TypeScript (strict) | 70+ 字段统计需要类型安全 |
| 样式 | Tailwind CSS 4 | 组件多、原子化效率高 |
| 图表 | Chart.js (vue-chartjs) 或 ECharts | xG 趋势、生涯曲线（Phase 4 引入） |
| 搜索 | MiniSearch | ~30KB，内存索引 7000 球员 <2s |
| 数据管线 | GitHub Actions (Node.js 内置模块) | 零依赖，与世界杯项目一致 |
| 部署 | GitHub Pages (静态) | 免费、无需服务器 |

---

## 2. 架构总览

```
┌─────────────────────────────────────────────────────────┐
│                    GitHub Actions                        │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ fetch-espn   │  │ fetch-       │  │ fetch-       │  │
│  │ .js          │  │ understat.js │  │ odds.js      │  │
│  │              │  │              │  │ (P2)         │  │
│  │ ESPN core +  │  │ xG/xA 数据   │  │              │  │
│  │ site.api     │  │              │  │              │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │                 │                  │          │
│         ▼                 ▼                  ▼          │
│    data/{league}/    data/{league}/     data/odds/      │
│    teams.json        xg-standings.json  ...             │
│    players/          xg-players.json                    │
│    leaders.json                                         │
│    matches/                                             │
│    standings.json                                       │
└─────────────────────────────────────────────────────────┘
                         │
                    静态 JSON 文件
                    (git commit)
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                    浏览器 (Vue SPA)                      │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  浏览器直连 (实时数据)                            │    │
│  │  ESPN site.api — 比分/阵容/事件/H2H/伤病         │    │
│  │  (已验证 CORS 可用，世界杯项目同款)               │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  静态 JSON 懒加载 (低频数据)                     │    │
│  │  /data/{league}/teams.json → 按需 fetch          │    │
│  │  /data/{league}/players/{id}.json → 点击时加载   │    │
│  │  /data/{league}/leaders.json → 进入排行页加载    │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  Pinia Store 缓存 + LocalStorage TTL                    │
└─────────────────────────────────────────────────────────┘
```

**核心原则：浏览器只 fetch 两类东西**
1. **ESPN site.api**（实时）— 比分、阵容、事件，已有 CORS 验证
2. **本站静态 JSON**（低频）— 球员档案、统计、xG，由 Actions 预生成

**ESPN core API 和 Understat 绝不在浏览器调用**（CORS 未验证/大概率不通），全部走 Actions → 静态文件。

---

## 3. 目录结构

```
football-data/
├── .github/
│   └── workflows/
│       ├── fetch-data.yml          # 定时抓取（每小时/每天）
│       └── deploy.yml              # 构建 + 部署到 Pages
│
├── data/                           # Actions 生成的静态 JSON（git 跟踪）
│   ├── leagues.json                # 联赛列表（slug/名称/赛季/球队数）
│   ├── mappings/
│   │   ├── team-name-map.json      # Understat ↔ ESPN 队名（26条）
│   │   └── player-name-map.json    # 球员姓名映射（7.5% 差异）
│   │
│   ├── eng.1/                      # ← 每个联赛一个目录
│   │   ├── meta.json               # 联赛元数据（名称/赛季/队数/颜色）
│   │   ├── teams.json              # 20 队列表（id/名/颜色/队徽/场馆）~50KB
│   │   ├── standings.json          # 积分榜（本地算或 ESPN 拉）~10KB
│   │   ├── leaders.json            # 12 项排行榜 ~50KB
│   │   ├── matches/                # 赛程按月拆分
│   │   │   ├── 2025-08.json        # 该月所有比赛 ~80KB
│   │   │   ├── 2025-09.json
│   │   │   └── ...
│   │   ├── players/
│   │   │   ├── index.json          # 球员索引（id/名/队/位置）~100KB
│   │   │   ├── 253989.json         # 单球员档案+统计 ~20KB
│   │   │   └── ...                 # 646 个文件
│   │   └── xg/                     # Understat 数据
│   │       ├── standings.json      # 含 xG/xGA/xpts ~30KB
│   │       └── players.json        # 全量球员 xG 统计 ~2MB
│   │
│   ├── esp.1/                      # 同 eng.1 结构
│   ├── ita.1/
│   ├── ger.1/
│   ├── fra.1/
│   │
│   └── fifa.world/                 # 世界杯（可后续迁入）
│
├── scripts/                        # Node.js 抓取脚本（零依赖）
│   ├── fetch-espn-core.js          # 球队/球员/统计/排行榜 → data/{league}/
│   ├── fetch-espn-scores.js        # 赛程/比分 → data/{league}/matches/
│   ├── fetch-understat.js          # xG 数据 → data/{league}/xg/  (已有原型)
│   ├── generate-player-index.js    # 从球员文件生成 index.json
│   ├── build-team-map.js           # 生成/更新队名映射
│   └── lib/
│       ├── http.js                 # 通用 HTTPS 请求（UA/gzip/重试）
│       ├── espn-endpoints.js       # ESPN core/site 端点常量
│       └── understat-endpoints.js  # Understat 端点常量
│
├── src/
│   ├── main.ts
│   ├── App.vue
│   ├── router/
│   │   └── index.ts                # 路由定义
│   │
│   ├── stores/                     # Pinia
│   │   ├── app.ts                  # 全局：当前联赛、语言、主题
│   │   ├── teams.ts                # 球队列表 + 缓存
│   │   ├── standings.ts            # 积分榜
│   │   ├── matches.ts              # 赛程/比分（浏览器直连 ESPN）
│   │   ├── players.ts              # 球员索引 + 按需加载详情
│   │   ├── leaders.ts              # 排行榜
│   │   └── xg.ts                   # Understat xG 数据
│   │
│   ├── composables/                # 可复用逻辑
│   │   ├── useEspanFetch.ts        # 浏览器端 ESPN site.api 封装
│   │   ├── useJsonFetch.ts         # 静态 JSON 懒加载 + 缓存
│   │   ├── useLeague.ts            # 联赛切换逻辑
│   │   ├── useTeamMapping.ts       # 队名/球员名映射
│   │   └── useTimezone.ts          # 时区转换（复用世界杯逻辑）
│   │
│   ├── types/                      # TypeScript 类型
│   │   ├── espn-core.ts            # ESPN core API 响应类型
│   │   ├── espn-site.ts            # ESPN site API 响应类型
│   │   ├── understat.ts            # Understat 响应类型
│   │   └── models.ts               # 前端数据模型（归一化后）
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppHeader.vue       # 顶栏：联赛切换 + 语言
│   │   │   ├── LeagueTabs.vue      # 联赛页签
│   │   │   ├── AppFooter.vue
│   │   │   └── MobileNav.vue       # 移动端导航
│   │   │
│   │   ├── standings/
│   │   │   ├── StandingsTable.vue  # 积分榜表格（通用，传 league prop）
│   │   │   └── StandingsRow.vue    # 单行（名次/队徽/队名/赛/胜/平/负/进/失/净/分）
│   │   │
│   │   ├── matches/
│   │   │   ├── MatchCard.vue       # 比赛卡片（复用世界杯设计）
│   │   │   ├── MatchList.vue       # 按日期分组的比赛列表
│   │   │   ├── MatchModal.vue      # 比赛详情弹窗
│   │   │   ├── LineupPitch.vue     # 足球场阵容可视化（复用）
│   │   │   ├── MatchEvents.vue     # 进球/红黄/换人时间线
│   │   │   └── MatchStats.vue      # 技术统计对比条
│   │   │
│   │   ├── players/
│   │   │   ├── PlayerCard.vue      # 球员卡片（头像/名/队/位置/关键数据）
│   │   │   ├── PlayerTable.vue     # 球员排行表格（可排序）
│   │   │   ├── PlayerDetail.vue    # 球员详情页主体
│   │   │   ├── PlayerStatsGrid.vue # 70+ 字段分类展示
│   │   │   ├── PlayerXgChart.vue   # xG 趋势图（Phase 4）
│   │   │   └── PlayerCareerChart.vue # 生涯进球曲线（Phase 4）
│   │   │
│   │   ├── teams/
│   │   │   ├── TeamCard.vue        # 球队卡片
│   │   │   └── TeamSquad.vue       # 球队阵容列表
│   │   │
│   │   └── common/
│   │       ├── TeamLogo.vue        # 队徽（ESPN logo URL + fallback）
│   │       ├── FlagIcon.vue        # 国旗/联赛标志
│   │       ├── SearchBar.vue       # 全局搜索（球员/球队）
│   │       ├── DataLoading.vue     # 加载骨架屏
│   │       ├── DataError.vue       # 错误/空状态
│   │       └── StatBar.vue         # 统计对比条
│   │
│   ├── views/                      # 页面级组件
│   │   ├── HomeView.vue            # 首页：联赛选择 + 焦点比赛
│   │   ├── StandingsView.vue       # 积分榜页
│   │   ├── ScheduleView.vue        # 赛程页（按月/轮次筛选）
│   │   ├── LeadersView.vue         # 排行榜页（12 项 tab）
│   │   ├── PlayersView.vue         # 球员列表/搜索页
│   │   ├── PlayerDetailView.vue    # 球员详情页
│   │   ├── TeamDetailView.vue      # 球队详情页
│   │   ├── MatchDetailView.vue     # 比赛详情页（或继续用 Modal）
│   │   └── SearchView.vue          # 搜索结果页
│   │
│   └── utils/
│       ├── format.ts               # 数字/日期格式化
│       ├── i18n.ts                 # 中英文切换
│       └── constants.ts            # 联赛 slug、颜色、配置
│
├── index.html
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── tsconfig.node.json
└── package.json
```

---

## 4. 数据管线（GitHub Actions）

### 4.1 抓取频率

| 数据类型 | 频率 | 脚本 | 原因 |
|---|---|---|---|
| 比分/赛程 | 每 30 分钟（赛季中） | `fetch-espn-scores.js` | 比分实时性 |
| 积分榜 | 每天 1 次 | `fetch-espn-core.js` | 比赛结束后更新 |
| 球员统计 | 每天 1 次 | `fetch-espn-core.js` | 每轮赛后更新 |
| 排行榜 | 每天 1 次 | `fetch-espn-core.js` | 同上 |
| xG 数据 | 每周 1 次 | `fetch-understat.js` | Understat 更新慢 |
| 球员档案 | 每周 1 次 | `fetch-espn-core.js` | 极少变化 |
| 队名映射 | 手动 | `build-team-map.js` | 赛季初更新 |

**Actions 额度估算**：
- 每次抓取 ~2 分钟（5 联赛 × 请求数）
- 30 分钟一次 × 24h × 30 天 = 1440 次/月 × 2min = 2880 min → **超 2000 min 免费额度**
- 解决方案：赛季中 30min，休赛期改为每天 1 次；或比分走浏览器直连（已有 CORS），Actions 只抓低频数据
- **推荐：比分不进 Actions**，浏览器直连 ESPN site.api（世界杯项目已验证），Actions 只负责低频的 core + Understat 数据 → 每天 ~10 min，完全够用

### 4.2 fetch-espn-core.js 逻辑

```
输入: 联赛 slug 列表 ['eng.1','esp.1','ita.1','ger.1','fra.1']

对每个 league:
  1. GET /v2/sports/soccer/leagues/{slug}
     → 写 data/{league}/meta.json

  2. GET /v2/sports/soccer/leagues/{slug}/seasons/{year}/teams
     对每队 GET .../teams/{id}  (含 color/logos/venue)
     → 写 data/{league}/teams.json

  3. GET .../types/1/teams/{id}/record  (每队)
     → 合并到 standings.json 或本地算

  4. GET .../types/1/leaders
     → 写 data/{league}/leaders.json

  5. GET /v2/sports/soccer/leagues/{slug}/athletes?limit=5&page=N
     对每个球员:
       GET .../athletes/{id}          → 档案
       GET .../athletes/{id}/statistics/0  → 统计
       合并 → 写 data/{league}/players/{id}.json
     汇总 → 写 data/{league}/players/index.json

  6. 生成球员搜索索引 (id + name + team + position)
     → 写入 index.json

输出: data/{league}/ 下全部文件
条件 commit: 只有数据变化才 git commit + push
```

**请求量估算（EPL 为例）**：
- 联赛元数据: 1
- 球队: 1 + 20 = 21
- 排行榜: 1
- 球员: 130 页 × 5 = 650 列表 + 646 × 2（档案+统计）= 1292 详情
- **合计 ~1315 请求/联赛，5 联赛 ~6500 请求**
- ESPN core 无明确限流，但加 200ms 间隔 → 5 联赛 ~22 分钟
- 每天跑 1 次完全可接受

### 4.3 fetch-understat.js（已有原型）

```
对每个联赛 (EPL/La_liga/Serie_A/Bundesliga/Ligue_1):
  1. GET /getLeagueData/{league}/{season}  → xg/standings.json
  2. POST /main/getPlayersStats/           → xg/players.json

输出: data/{league}/xg/ 下 2 个文件
```

### 4.4 deploy.yml

```yaml
# 与世界杯项目一致：
# - push 到 main 触发
# - npm ci && npm run build
# - 部署 dist/ 到 gh-pages 分支
# - 注意：data/ 目录需要复制到 dist/ 中（vite 不处理静态 JSON）
#   → vite.config.ts 中 publicDir 或 copy 插件
```

**关键**：`data/` 目录作为静态资源，需要让 Vite 复制到 `dist/`。两种方式：
- 方式 A：把 `data/` 放到 `public/data/`（Vite 自动复制 public 目录）
- 方式 B：用 `vite-plugin-static-copy`
- **推荐方式 A**：`public/data/` → 部署后 `/data/` 可直接 fetch

---

## 5. 数据文件拆分策略

### 问题
全量 ~100-150MB，浏览器不能整包加载。

### 拆分方案

| 文件 | 大小 | 加载时机 |
|---|---|---|
| `leagues.json` | ~2KB | 应用启动 |
| `{league}/meta.json` | ~3KB | 切换联赛 |
| `{league}/teams.json` | ~50KB | 切换联赛（含队徽/颜色，多处复用） |
| `{league}/standings.json` | ~10KB | 进入积分榜页 |
| `{league}/leaders.json` | ~50KB | 进入排行榜页 |
| `{league}/matches/2025-08.json` | ~80KB | 进入赛程页按月加载 |
| `{league}/players/index.json` | ~100KB | 进入球员列表/搜索 |
| `{league}/players/{id}.json` | ~20KB | **点击球员时**加载 |
| `{league}/xg/standings.json` | ~30KB | 积分榜页（叠加 xG 列） |
| `{league}/xg/players.json` | ~2MB | 排行榜页 xG tab（按需） |

**首屏加载（进入英超积分榜）**：
`leagues.json` + `eng.1/meta.json` + `eng.1/teams.json` + `eng.1/standings.json`
≈ **65KB** — 完全可接受

**最重路径（球员详情）**：
额外加载 `players/{id}.json` ≈ 20KB — 无压力

### index.json 结构（球员搜索用）

```json
[
  {
    "id": 253989,
    "name": "Erling Haaland",
    "team": "Manchester City",
    "teamId": 382,
    "position": "F",
    "goals": 27,
    "assists": 5
  }
]
```

~646 条 × 150 字节 ≈ 100KB，MiniSearch 索引后 <2MB 内存。

---

## 6. 前端数据加载策略

### 6.1 Pinia Store 分层

```
appStore        → currentLeague, lang, theme（全局状态）
teamsStore      → teams[league] 缓存（切换联赛时 fetch，缓存不过期）
standingsStore  → standings[league] 缓存（TTL 1h）
matchesStore    → 浏览器直连 ESPN site.api，按月缓存
playersStore    → index[league] 缓存 + players[id] 按需缓存
leadersStore    → leaders[league] 缓存（TTL 6h）
xgStore         → xg 数据缓存（TTL 24h）
```

### 6.2 缓存策略

```typescript
// useJsonFetch.ts 核心逻辑
async function fetchLeagueJson<T>(league: string, path: string, ttlMs: number): Promise<T> {
  const cacheKey = `${league}/${path}`
  const cached = localStorage.getItem(cacheKey)
  if (cached) {
    const { data, ts } = JSON.parse(cached)
    if (Date.now() - ts < ttlMs) return data
  }
  const res = await fetch(`/data/${league}/${path}`)
  const data = await res.json()
  localStorage.setItem(cacheKey, JSON.stringify({ data, ts: Date.now() }))
  return data
}
```

### 6.3 ESPN 浏览器直连（实时数据）

```typescript
// useEspanFetch.ts — 与世界杯项目 espn.js 同源
const ESPN_SITE_API = 'https://site.api.espn.com/apis/site/v2/sports/soccer'

// 赛程/比分（CORS 已验证）
async function fetchScores(league: string, dateRange: string) {
  return fetch(`${ESPN_SITE_API}/${league}/scoreboard?dates=${dateRange}&limit=200`)
}

// 比赛详情：阵容/事件/统计/H2H
async function fetchMatchSummary(league: string, eventId: string) {
  return fetch(`${ESPN_SITE_API}/${league}/summary?event=${eventId}`)
}
```

### 6.4 跨源数据合并

```typescript
// useTeamMapping.ts
import teamMap from '../../data/mappings/team-name-map.json'
import playerMap from '../../data/mappings/player-name-map.json'

// Understat 队名 → ESPN 队名
function normalizeTeamName(understatName: string): string {
  return teamMap[understatName] ?? understatName
}

// 球员姓名模糊匹配（处理 7.5% 差异）
function matchPlayerName(espnName: string, understatPlayers: Map<string, any>): any {
  // 1. 精确匹配（92.5%）
  const exact = understatPlayers.get(espnName.toLowerCase())
  if (exact) return exact
  // 2. 查人工映射表
  const mapped = playerMap[espnName]
  if (mapped) return understatPlayers.get(mapped.toLowerCase())
  // 3. 去重音 + 编辑距离 fallback
  return fuzzyMatch(espnName, understatPlayers)
}
```

---

## 7. 路由设计

```typescript
const routes = [
  // 首页
  { path: '/', component: HomeView },

  // 联赛级页面（:league = eng.1 | esp.1 | ita.1 | ger.1 | fra.1）
  { path: '/:league/standings', component: StandingsView },
  { path: '/:league/schedule', component: ScheduleView },
  { path: '/:league/schedule/:month', component: ScheduleView },  // 按月
  { path: '/:league/leaders', component: LeadersView },
  { path: '/:league/teams', component: TeamsView },
  { path: '/:league/players', component: PlayersView },

  // 详情页
  { path: '/:league/team/:teamId', component: TeamDetailView },
  { path: '/:league/player/:playerId', component: PlayerDetailView },
  { path: '/:league/match/:eventId', component: MatchDetailView },

  // 搜索
  { path: '/search', component: SearchView },

  // 兜底
  { path: '/:pathMatch(.*)*', redirect: '/' },
]
```

**注意**：GitHub Pages 不支持 history mode 的路由回退。两个方案：
- 方案 A：`createWebHashHistory()`（URL 带 `#`，简单可靠）
- 方案 B：`createWebHistory()` + 404.html 重定向技巧
- **推荐方案 A**（MVP 阶段），后续可迁移

---

## 8. 联赛配置

```typescript
// src/utils/constants.ts
export const LEAGUES = [
  {
    slug: 'eng.1',
    name: 'Premier League',
    nameZh: '英超',
    understatSlug: 'EPL',
    country: 'England',
    flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
    teams: 20,
    color: '#3D195B',       // 联赛主题色（ESPN core 可取）
  },
  {
    slug: 'esp.1',
    name: 'LALIGA',
    nameZh: '西甲',
    understatSlug: 'La_liga',
    country: 'Spain',
    flag: '🇪🇸',
    teams: 20,
    color: '#EE8707',
  },
  {
    slug: 'ita.1',
    name: 'Italian Serie A',
    nameZh: '意甲',
    understatSlug: 'Serie_A',
    country: 'Italy',
    flag: '🇮🇹',
    teams: 20,
    color: '#008FD7',
  },
  {
    slug: 'ger.1',
    name: 'Bundesliga',
    nameZh: '德甲',
    understatSlug: 'Bundesliga',
    country: 'Germany',
    flag: '🇩🇪',
    teams: 18,
    color: '#D20100',
  },
  {
    slug: 'fra.1',
    name: 'French Ligue 1',
    nameZh: '法甲',
    understatSlug: 'Ligue_1',
    country: 'France',
    flag: '🇫🇷',
    teams: 18,
    color: '#DAE1E6',
  },
] as const

export type LeagueSlug = typeof LEAGUES[number]['slug']
```

---

## 9. TypeScript 类型定义要点

```typescript
// types/models.ts — 前端归一化模型

/** 球队（来自 ESPN core teams 端点） */
interface Team {
  id: number                    // ESPN 全局 ID
  name: string                  // displayName
  shortName: string
  abbreviation: string          // 如 "MNC"
  color: string                 // 主色 hex "#6CABDD"
  alternateColor: string        // 副色 hex
  logo: string                  // 500x500 PNG URL
  logoDark?: string             // dark mode 版本
  venue: {
    name: string
    city: string
    country: string
  }
  record?: {                    // 本赛季战绩
    wins: number
    draws: number
    losses: number
    played: number
    points: number
    goalDiff: number
  }
}

/** 球员索引条目（index.json，轻量） */
interface PlayerIndexEntry {
  id: number                    // ESPN 全局 athlete ID
  name: string
  team: string                  // 球队 displayName
  teamId: number
  position: 'G' | 'D' | 'M' | 'F'
  age: number
  goals?: number                // 本季进球（可选，用于排序）
  assists?: number
}

/** 球员详情（players/{id}.json，完整） */
interface PlayerDetail {
  // 档案
  id: number
  firstName: string
  lastName: string
  displayName: string
  age: number
  height: number                // cm
  weight: number                // kg
  position: string
  jersey?: number

  // ESPN core 统计（4 分类 70+ 字段）
  stats: {
    offensive: {
      totalGoals: number
      totalShots: number
      shotsOnTarget: number
      accuratePasses: number
      // ... 34 字段
    }
    defensive: {
      totalTackles: number
      interceptions: number
      totalClearance: number
      // ... 8 字段
    }
    goalKeeping: {
      saves: number
      penaltyKicksSaved: number
      // ... 12 字段
    }
    general: {
      appearances: number
      subIns: number
      yellowCards: number
      redCards: number
      // ... 16 字段
    }
  }

  // Understat xG（跨源合并后，可选）
  xg?: {
    goals: number
    xG: number
    assists: number
    xA: number
    npxG: number
    xGChain: number
    xGBuildup: number
    shots: number
    keyPasses: number
    games: number
    time: number
  }
}

/** 积分榜行 */
interface StandingRow {
  rank: number
  teamId: number
  team: string
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  goalDiff: number
  points: number
  // Understat 叠加（可选）
  xG?: number
  xGA?: number
  xPts?: number
}

/** 比赛（ESPN site.api scoreboard） */
interface Match {
  eventId: string
  date: string
  time: string
  status: 'pre' | 'in' | 'post'
  minute?: number               // 进行中时的分钟数
  home: MatchTeam
  away: MatchTeam
  venue: string
  competition: string
  group?: string                // 联赛无 group，杯赛有
}

interface MatchTeam {
  id: number
  name: string
  abbreviation: string
  logo: string
  score: number | null
  winner?: boolean
}
```

---

## 10. 分步实施计划

### Phase 0：项目脚手架（0.5 天）

**目标**：空项目跑起来，能部署到 GitHub Pages。

**步骤**：
1. `npm create vite@latest football-data -- --template vue-ts`
2. 安装依赖：`pinia` `vue-router` `tailwindcss` `@tailwindcss/vite`
3. 配置 Tailwind（v4 用 CSS `@import "tailwindcss"`）
4. 配置 `public/data/` 目录（放一个测试 JSON）
5. 配置 Vue Router（hash mode）+ Pinia
6. 写 `deploy.yml`（build → 部署到 gh-pages）
7. 配置 `vite.config.ts` 的 `base: '/football-data/'`（Pages 子路径）

**验收**：
- [ ] `npm run dev` 本地跑通
- [ ] `npm run build` 产物包含 `data/` 目录
- [ ] push 后 GitHub Pages 可访问
- [ ] 能 fetch 到 `public/data/` 下的测试 JSON

---

### Phase 1：数据管线（1-2 天）

**目标**：GitHub Actions 能自动抓取 5 联赛数据，生成静态 JSON。

**步骤**：
1. 写 `scripts/lib/http.js`（通用 HTTPS，UA 伪装，gzip 解压，重试）
2. 写 `scripts/lib/espn-endpoints.js`（端点常量）
3. 写 `scripts/fetch-espn-core.js`：
   - 5 联赛 × (meta + teams + leaders + 全量球员)
   - 输出到 `public/data/{league}/`
   - 球员拆分为 `players/{id}.json` + `players/index.json`
4. 改造 `scripts/fetch-understat.js`（已有原型）：
   - 输出路径改为 `public/data/{league}/xg/`
5. 写 `scripts/fetch-espn-scores.js`：
   - 按月拆分赛程 → `public/data/{league}/matches/{YYYY-MM}.json`
6. 把 `tmp/fbref/out/understat-team-map.json` 清洗为正式版 → `public/data/mappings/team-name-map.json`
7. 写 `fetch-data.yml`：
   - cron 每天 UTC 06:00 跑一次
   - 条件 commit（数据无变化不提交）
8. 手动跑一次全量抓取，验证输出

**验收**：
- [ ] `public/data/eng.1/` 下有 meta/teams/standings/leaders/players/index.json + 646 个球员文件
- [ ] `public/data/eng.1/xg/` 下有 standings + players
- [ ] `public/data/eng.1/matches/` 下有按月拆分的赛程文件
- [ ] 5 个联赛目录结构完整
- [ ] `data/mappings/team-name-map.json` 26 条映射
- [ ] GitHub Action 手动触发成功

**请求量与耗时预估**：
- 5 联赛全量 ~6500 请求（ESPN core）+ 10 请求（Understat）
- 200ms 间隔 → ~22 分钟
- 每天 1 次 → 月耗 ~660 min（远低于 2000 min 上限）

---

### Phase 2：积分榜 + 赛程（1-2 天）

**目标**：能切换联赛，看积分榜和赛程。

**步骤**：
1. 写 `appStore`（currentLeague 状态 + 联赛切换）
2. 写 `useJsonFetch.ts`（fetch + localStorage 缓存 + TTL）
3. 写 `useLeague.ts`（联赛切换时加载 meta + teams）
4. 实现 `AppHeader.vue` + `LeagueTabs.vue`（联赛切换 UI）
5. 实现 `teamsStore` + `standingsStore`
6. 实现 `StandingsTable.vue` + `StandingsRow.vue`
   - 列：名次 / 队徽 / 队名 / 赛 / 胜 / 平 / 负 / 进 / 失 / 净 / 分
   - 欧冠/欧联/降级区色带
   - 叠加 xG 列（可选 toggle，来自 xg/standings.json）
7. 实现 `StandingsView.vue`（路由页）
8. 实现 `matchesStore`（浏览器直连 ESPN site.api）
9. 实现 `MatchCard.vue` + `MatchList.vue`
   - 按日期分组，显示比分（已完赛）或时间（未开赛）
   - 队徽 + 队名
10. 实现 `ScheduleView.vue`（按月切换）
11. 路由注册：`/:league/standings`、`/:league/schedule`

**验收**：
- [ ] 首页选联赛 → 跳转积分榜
- [ ] 积分榜 20 队正确排列，含队徽
- [ ] 切换联赛 → 积分榜切换（缓存命中 <100ms）
- [ ] 赛程页按月显示比赛卡片
- [ ] 已完赛比赛显示比分，未开赛显示时间
- [ ] 中英文切换（联赛名、队名）
- [ ] 移动端响应式布局

---

### Phase 3：比赛详情（1-2 天）

**目标**：点击比赛卡片，弹窗显示阵容、事件、统计。

**步骤**：
1. 实现 `MatchModal.vue`（弹窗容器）
2. 浏览器直连 `ESPN summary API` 获取阵容+事件+统计
3. 实现 `LineupPitch.vue`（**从世界杯项目移植**）
   - 移植 `categorizePlayers` / `getFieldXY` / `getFormationYRows`
   - 改为 Vue 组件 + TypeScript
   - 足球场 SVG/CSS 背景 + 球员按阵型分层
4. 实现 `MatchEvents.vue`（进球⚽ / 🟨 / 🟥 / 🔄换人 时间线）
5. 实现 `MatchStats.vue`（控球率、射门等对比条）
6. 实现 H2H 历史交锋区块（来自 summary API）

**验收**：
- [ ] 点击已完赛比赛 → 弹窗显示完整信息
- [ ] 阵容足球场可视化正确（阵型分层、左右分布）
- [ ] 事件时间线按时间排序
- [ ] 技术统计对比条显示
- [ ] 未开赛比赛显示 "阵容尚未公布"
- [ ] ESC / 点击遮罩关闭弹窗
- [ ] 移动端弹窗全屏

---

### Phase 4：球员数据 + 排行榜（2-3 天）

**目标**：球员列表、搜索、详情页、12 项排行榜。

**步骤**：
1. 实现 `playersStore`
   - 加载 `index.json`（100KB，含 id/名/队/位置/进球/助攻）
   - 按需加载 `players/{id}.json`（点击时 fetch）
   - MiniSearch 索引（name + team）
2. 实现 `SearchBar.vue`（全局搜索，球员+球队）
3. 实现 `PlayersView.vue`（球员列表页）
   - 按位置筛选（G/D/M/F）
   - 按进球/助攻排序
   - 虚拟滚动或分页（646 条不需要虚拟滚动，分页即可）
4. 实现 `PlayerDetailView.vue` + `PlayerDetail.vue`
   - 基本信息（姓名/年龄/身高/体重/位置/号码）
   - 赛季统计 4 分类（进攻/防守/门将/通用）
   - xG 数据区块（来自 Understat，跨源合并）
5. 实现 `PlayerStatsGrid.vue`（70+ 字段分类展示，折叠面板）
6. 实现 `leadersStore` + `LeadersView.vue`
   - 12 项排行榜 tab 切换
   - 射手榜 / 助攻榜 / 射正 / 传球 / 黄牌 / 红牌 / 扑救 ...
7. 实现 `xgStore`
   - 加载 `xg/players.json`（~2MB，按需）
   - 与 ESPN 球员数据按姓名合并
8. 路由注册：`/:league/players`、`/:league/player/:playerId`、`/:league/leaders`

**验收**：
- [ ] 球员列表显示全部 646 人（分页 50/页）
- [ ] 搜索 "Haaland" → 命中，点击进入详情
- [ ] 详情页显示完整 70+ 字段统计
- [ ] xG 数据与 ESPN 数据合并显示（92.5% 命中率）
- [ ] 排行榜 12 项切换，数据正确
- [ ] 切换联赛 → 球员列表/排行榜联动刷新

---

### Phase 5：球队详情 + 完善（1-2 天）

**目标**：球队详情页，整体打磨。

**步骤**：
1. 实现 `TeamDetailView.vue`
   - 球队信息（队徽/颜色/场馆/昵称）
   - 本赛季战绩（W-D-L）
   - 阵容列表（从 players index 按 teamId 筛选）
   - 球队赛季统计（ESPN core team statistics）
   - 球队内排行（ESPN core team leaders）
2. 实现 `TeamSquad.vue`（按位置分组的球员列表）
3. 首页 `HomeView.vue`
   - 联赛卡片（5 联赛入口，含标志色）
   - 焦点比赛（今日/近期已完赛）
4. 错误处理完善
   - API 失败 → `DataError.vue` 降级展示
   - 数据加载中 → `DataLoading.vue` 骨架屏
   - 休赛期提示
5. i18n 完善（队名中英文、联赛名、统计字段名）
6. 移动端适配检查

**验收**：
- [ ] 球队详情页完整展示
- [ ] 首页联赛卡片可点击跳转
- [ ] 所有页面有加载态和错误态
- [ ] 中英文切换全覆盖
- [ ] 移动端全流程可用

---

### Phase 6：图表 + 高阶功能（2-3 天，P2）

**目标**：xG 趋势图、生涯曲线、历史赛季。

**步骤**：
1. 引入图表库（Chart.js + vue-chartjs 或 ECharts）
2. 实现 `PlayerXgChart.vue`
   - Understat `getPlayerData/{id}` 逐场 xG 时间线
   - 滚动平均线
3. 实现 `PlayerCareerChart.vue`
   - ESPN core 多赛季统计 → 生涯进球曲线
   - 需 Actions 预拉历史赛季数据（`seasons/{year}/.../statistics`）
4. 历史赛季切换（26 个赛季可选）
5. 球员对比页（两人 stats 并排）
6. （可选）赔率模块（如体彩覆盖联赛）

**验收**：
- [ ] 球员详情页有 xG 趋势图
- [ ] 生涯曲线展示多个赛季数据
- [ ] 历史赛季可切换查看

---

## 11. 从世界杯项目复用清单

| 模块 | 源文件 | 复用方式 |
|---|---|---|
| 时区转换 | `timezone.js` → `useTimezone.ts` | 逻辑复用，改为 composable |
| 队名翻译 | `i18n.js` 的 `TEAM_ZH` | 扩展为 5 联赛队名 |
| 队名映射 | `ESPN_TEAM_MAP` 模式 | 新增 `UNDERSTAT_TEAM_MAP`（26 条） |
| 阵容可视化 | `schedule.js` 的 `renderLineupCol` 等 | 改为 Vue 组件 `LineupPitch.vue` |
| 比赛事件 | `schedule.js` 的事件渲染 | 改为 `MatchEvents.vue` |
| 技术统计 | `schedule.js` 的统计渲染 | 改为 `MatchStats.vue` |
| 积分榜计算 | `data.js` 的 `computeStandings()` | 改为 Pinia store 方法 |
| 比赛卡片 | `schedule.js` 的卡片 HTML | 改为 `MatchCard.vue` |
| 国旗/队徽 | `app.js` 的 `getFlagImg()` | 改为 `TeamLogo.vue`（用 ESPN logo URL） |
| 占位符检测 | `data.js` 的 `isPlaceholder()` | 杯赛需要，联赛不需要 |
| 停赛计算 | `espn.js` 的停赛逻辑 | 联赛规则不同，需重写 |
| 抓取脚本 | `fetch-understat.js` | 直接复用，改输出路径 |

---

## 12. 已知风险与待验证项

| 风险 | 影响 | 应对 |
|---|---|---|
| ESPN core API CORS 未实测 | 如果浏览器可直连，部分数据可不用 Actions | Phase 0 第一天验证；不通则全走 Actions（已设计） |
| ESPN core 限流（6500 请求/天） | 抓取失败 | 200ms 间隔 + 重试 + 失败告警 |
| Understat 端点未文档化 | 随时可能变动 | 降级方案：去掉 xG 列，其余功能不受影响 |
| 球员姓名 7.5% 不匹配 | xG 数据缺失 | 人工维护 `player-name-map.json`，逐步补全 |
| GitHub Pages 部署路径 | base path 配置错误导致白屏 | `vite.config.ts` 的 `base` 必须匹配仓库名 |
| 数据体积增长（历史赛季） | 仓库膨胀 | 只保留当前 + 近 3 赛季，历史按需拉 ESPN core |
| 赛季初球队变动（升降级） | teams.json 过期 | 赛季初手动触发全量刷新 |

---

## 13. Phase 0 第一天任务清单

> 拿到新项目后，第一天做这些：

```bash
# 1. 创建项目
npm create vite@latest football-data -- --template vue-ts
cd football-data

# 2. 安装依赖
npm install vue-router pinia
npm install -D tailwindcss @tailwindcss/vite

# 3. 验证 ESPN core CORS（浏览器控制台跑）
fetch('https://sports.core.api.espn.com/v2/sports/soccer/leagues/eng.1')
  .then(r => r.json()).then(d => console.log(d.name))

# 4. 验证 ESPN site.api CORS（世界杯项目已验证，再确认一次）
fetch('https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=20260501-20260531&limit=10')
  .then(r => r.json()).then(d => console.log(d.events.length))

# 5. 如果 step 3 CORS 失败 → 确认架构：ESPN core 全走 Actions
#    如果 step 3 CORS 成功 → 可简化：部分数据浏览器直连，减少 Actions 负担
```

CORS 验证结果决定后续数据加载策略，是第一天最重要的事。
