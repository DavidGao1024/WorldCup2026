# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Rules

- **始终使用中文沟通**，所有解释、回复、说明用简体中文
- **永远不自动提交代码**，只有用户明确说"提交"或"commit"时才执行 git commit

## Project overview

Pure frontend static site for 2026 FIFA World Cup (USA/Canada/Mexico). Four tabs: Schedule (赛程), Standings (积分榜), Analysis (深度分析), Lottery (体彩世界). Hosted on GitHub Pages. Zero build tools, zero frameworks — vanilla HTML/CSS/JS.

## Development

```bash
npx serve . -p 3000        # Start local dev server
```

Open `http://localhost:3000`. No build step — edit files and refresh.

## Architecture

### JS file loading order (critical)

Scripts load in this sequence in `index.html` because later files depend on earlier ones:

1. **i18n.js** — `t(key)`, `currentLang`, `toggleLang()`, `trTeam()`, `trVenue()`, `TEAM_ZH`, `VENUE_ZH`
2. **timezone.js** — `currentTZ`, `convertTime()`, `getUTCOffsetStr()`, `setTimezone()`
3. **espn.js** — `fetchEspnScores()`, `fetchEspnStandings()`, `mapEspnName()`, `ESPN_TEAM_MAP` — 从 ESPN 非官方 API 拉取实时比分和积分榜。同时承担：红黄牌提取(`processEspnCards()`)、停赛计算(`computeWorldCupSuspensions()`)、比赛详情获取(`fetchMatchSummary()`)。
4. **data.js** — `loadData()`, `getMatches()`, `getGroupMatches()`, `getKnockoutMatches()`, `getGroups()`, `getTeams()`, `getTeamsByGroup()`, `computeStandings()`, `isPlaceholder()`, `fetchEspnAndMerge()`, `mergeScoresIntoData()` — ESPN 拉取后自动调用红黄牌处理和停赛计算。`computeStandings()` 只计入 `status === 'post'` 的比赛，进行中的比赛不参与积分计算
5. **schedule.js** — `renderSchedule()`, `populateFilters()`, `populateTeamFilter()` — 比赛卡片点击弹窗(`showMatchModal()`)、球场可视化阵容、比赛事件时间线、技术统计
6. **standings.js** — `renderStandings()`, `onStandingsGroupChange()`
7. **knockout.js** — `renderKnockout()`
8. **analysis.js** — `renderAnalysis()`, `loadAnalysisData()`, `computeMatchScore()`, `predictScores()`, `computePrediction()` — 8维度分析+泊松比分预测。`predictScores()` 返回比分+胜平负，`computePrediction()` 统一用泊松模型输出（比分和进度条同源，自洽）
9. **champions.js** — `renderChampions()`
10. **lottery.js** — `renderLottery()` — 体彩赔率展示、模拟投注、过关计算
11. **app.js** — `init()`, `switchTab()`, `onFilterChange()`, `onTeamFilterChange()`, `getFlagImg()`, `getFlag()`, `roundKey()`, `updateUIText()`, `refreshCurrentTab()`, `scrollToToday()`, `FLAG_MAP`

All variables are global (`var`). No modules or bundler.

### Data flow

1. `init()` calls `loadData()` → 先读 LocalStorage 缓存（1h TTL），无缓存则加载 `data/worldcup.json`
2. 后台并行：`fetchEspnAndMerge()` 从 ESPN API 拉取实时比分，合并到 `worldCupData.matches`；`fetchFreshData()` 从 jsDelivr CDN 拉取最新赛程
3. ESPN 拉取成功 → 比分写入 match 的 `score1`/`score2` → 更新缓存 + 刷新 UI
4. ESPN 失败 → 静默 fallback，使用缓存或 CDN 中的旧数据
5. `computeStandings()` 根据已有 `score1`/`score2` 计算小组积分，只计入 `status === 'post'` 的比赛（null 和进行中的比赛不参与计算）
6. Tab 切换时调用对应的 render 函数

### ESPN API

- **Scoreboard** (比分+红黄牌): `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260611-20260719&limit=200`
  - 免 Key，无需认证
  - 返回 `events[].competitions[0].competitors[]` → `score`, `homeAway`, `team.displayName`
  - `events[].competitions[0].details[]` → 进球（含助攻）、红黄牌（含球员）
  - 只合并 `state === 'post'` 或 `'in'` 的比赛比分（赛程卡片显示实时比分）
  - 积分榜 `computeStandings()` 只计入 `status === 'post'` 的比赛，进行中比赛不参与积分计算
  - 缓存在 `espnRawEvents`，供红黄牌提取(`processEspnCards()`)和比赛事件匹配(`findEspnEventId()`)复用
- **Summary** (阵容+技术统计): `https://site.web.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event={eventId}`
  - 返回 `rosters[].roster[]` → 首发(`starter:true`)、替补、号码、姓名、位置
  - 返回 `rosters[].formation` → 阵型字符串如 "4-1-4-1"
  - 返回 `keyEvents[]` → 进球(含助攻者)、红黄牌、换人
  - 返回 `boxscore.teams[].statistics[]` → 28项技术统计
  - 已完赛返回完整数据，未开始阵容为空
- **Standings**: `https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings`
  - 备用，当前积分榜由 `computeStandings()` 从比分本地计算
- **队名映射**（ESPN → worldcup.json）见 `espn.js` 中的 `ESPN_TEAM_MAP`（48 支球队中仅 5 个差异，已全量覆盖）：
  - `Bosnia-Herzegovina` → `Bosnia & Herzegovina`
  - `Congo DR` → `DR Congo`
  - `Czechia` → `Czech Republic`
  - `Türkiye` → `Turkey`
  - `United States` → `USA`

### Match data structure (worldcup.json)

```json
{
  "name": "World Cup 2026",
  "matches": [{
    "round": "Matchday 1", "num": 1, "date": "2026-06-11",
    "time": "13:00 UTC-6", "team1": "Mexico", "team2": "South Africa",
    "group": "Group A", "ground": "Mexico City",
    "score1": null, "score2": null
  }]
}
```

- 104 matches: 72 group (12 groups × 6) + 32 knockout
- Group matches have `group` starting with `"Group "`
- Knockout matches have no `group` field or a round name
- Knockout placeholders: `W{num}` = winner of match N, `L{num}` = loser, `1A` = Group A winner, `2A` = Group A runner-up, `3A/B/C/D/F` = best third-place from groups A/B/C/D/F
- Times use `HH:MM UTC±N` format — `convertTime()` parses and converts to selected timezone

### Key patterns

- **Language switching**: `toggleLang()` no longer reloads the page — it re-renders in place, and `populateFilters()` preserves saved dropdown values
- **Time display**: `convertTime()` parses `UTC±N` offsets and shifts to `currentTZ`. The group stage uses local venue times; timezone conversion may be slightly off since date context isn't used
- **Filter linking**: Group filter controls team filter options via `getTeamsByGroup()`. Switching to "all" resets team to "all"
- **Flag images**: Stored as PNG in `img/flags/` named by English team name (e.g., `South Africa.png`). `getFlagImg()` returns an `<img>` tag for real teams, empty string for placeholders
- **赛程排序**: `renderSchedule()` 同一天内比赛按 `_displayTime`（时区转换后的 HH:MM）升序排列
- **Placeholder team names**: `isPlaceholder()` detects `W*`, `L*`, and `\d[A-Z]` patterns. `trTeam()` translates them in Chinese mode ("2A" → "A组第2名", "W74" → "胜者74")

## 预测模型

### 架构
`computeMatchScore()` → 8维度评分 → `predictScores()` → 泊松比分+胜平负 → `computePrediction()` 统一输出

### 8维度（100分制）
FIFA排名(25) + 近期状态(30) + 球队身价(10) + 进攻火力(10) + 防守稳固(10) + 主场优势(15) + 小组形势(10) + 伤病停赛(5)

### 泊松模型关键参数
- **比率压缩**: `tRatio = 0.5 + (rawRatio - 0.5) * 0.5`，以0.5为锚点，确保xG方向与8维度总分一致
- **攻防微调**: ±20%（以5分为中性点），不能翻转xG方向
- **方向安全保障**: 最终xG方向必须与8维度总分方向一致，不一致则强制纠正
- **drawBoost**: 基于xG差距（而非8维度gap），`1 + max(0, 1 - xgGap/2.5) * 2.5`
- **一致性校准**: top-3比分类型与胜平负主导方向不一致时，自动微调xG/drawBoost重算

### 小组末轮修正（predict-final.js）
- 轮换: xG ×0.70 | 生死战: xG ×1.15 | 保守: xG ×0.85 | 默契球: drawBonus +0.08
- `getFinalRoundGroups()` 自动判断锁定第1/淘汰/生死战/默契球

### 预测脚本
- `scripts/predict.js` — 通用赛前预测，从ESPN获取未来比赛列表
- `scripts/predict-final.js` — 小组末轮专用，硬编码context修正

## 比赛详情弹窗（赛程页签）

### 触发
点击赛程页签的比赛卡片 → `showMatchModal(matchNum)` → 查找 ESPN event ID → 调用 `fetchMatchSummary()`

### 已完赛比赛
- 比分头部：国旗、队名、比分、时间、地点
- **首发阵容**：双方各一个足球场（400px高），球员按阵型分层排列
  - 解析阵型字符串(如 "4-2-3-1")自动分层：GK → 后卫 → 中场各排 → 前锋
  - 同排球员按左中右排序均匀分布
  - 显示号码、姓名缩写、位置标签
- **替补名单**：球场下方紧凑横排列表
- **比赛事件**：进球(含助攻)、🟨🟥红黄牌、🔄换人
- **技术统计**(10项)：控球率、射门/射正、传球/成功率、犯规、角球、抢断、拦截、解围
- 关闭方式：✕按钮 / 点击遮罩 / ESC键

### 未开始比赛
显示对阵信息 + "阵容尚未公布"提示

### 关键函数 (schedule.js)
- `showMatchModal(matchNum)` — 入口，先关已有弹窗
- `renderMatchModalContent(summary, match)` — 完整阵容+事件+统计
- `renderMatchBasicInfo(match, summary)` — 无阵容时的降级展示
- `renderLineupCol(lineup, match)` — 足球场可视化
- `categorizePlayers()` / `getFieldXY()` / `getFormationYRows()` — 阵型分层定位
- `closeMatchModal()` — 移除弹窗，解锁滚动

## 伤病停赛数据

### 概述
**停赛(免费实时)**：从 ESPN Scoreboard API 的 `details[]` 中提取红黄牌，按 FIFA 规则自动计算。**伤病(手动维护)**：`data/injuries.json` 存储各队伤病人数，停赛由 ESPN 数据自动叠加。

### 数据流
```
ESPN scoreboard (每次加载页面)
    ↓ fetchEspnScores() → espnRawEvents 缓存
    ↓ processEspnCards() → worldCupCards
    ↓ computeWorldCupSuspensions(cards, matches)
    ↓ worldCupSuspensions → {TeamName: {suspensions: N, note: "球员(原因)"}}
    
data/injuries.json (手动维护)
    ↓ 加载 + mergeInjuryAndSuspensionData()
    ↓ analysisData.injuries → 合并后的伤病+停赛
```

### FIFA 停赛规则
- 红牌 → 下场比赛自动停赛
- 累计2张黄牌 → 下场比赛停赛（需是最近一场比赛拿到的第2张）
- 黄牌在1/4决赛后清零

### 关键函数 (espn.js)
- `processEspnCards()` — 从缓存的 ESPN 事件中提取所有红黄牌
- `computeWorldCupSuspensions(cards, matches)` — 匹配赛程，计算各队停赛
- `mergeInjuryAndSuspensionData()` — 合并伤病+停赛 (analysis.js)
- `scripts/fetch-injuries.js` — 生成48队伤病模板（无需 API Key）
- `.github/workflows/fetch-injuries.yml` — 每天运行一次

## 体彩赔率（独立功能，WIP）

### 概述

从中国体彩官方 API (sporttery.cn) 获取世界杯竞彩实时赔率，为买体彩提供参考。**完全独立于现有赛程/积分榜功能，不影响任何已有代码。**

### 当前进度

- [x] 数据获取脚本 `scripts/fetch-odds.js`
- [x] 定时抓取 GitHub Action `.github/workflows/fetch-odds.yml`（每15分钟）
- [x] 赔率数据文件 `data/lottery-odds.json`
- [x] 前端 UI（体彩世界页签）— 模拟投注、多选串关、混合过关

### 数据获取架构

```
GitHub Action (每15分钟)
    ↓ node scripts/fetch-odds.js
sporttery.cn 官方 API (webapi.sporttery.cn)
    ↓ 写入
data/lottery-odds.json  ← 前端可直接 fetch
```

- 纯 Node.js 内置模块（https/zlib/fs），**无需 npm install**
- 模拟浏览器 UA 绕过腾讯云 EdgeOne WAF
- 仅数据变化时才 git commit（避免刷提交）
- 只取 `leagueCode === 'WCC'`（世界杯）的比赛

### API 端点

```
https://webapi.sporttery.cn/gateway/jc/football/getMatchCalculatorV1.qry
  ?poolCode=hhad,had,crsp,ttg,hafu&channel=c
```

**重要约束**：API 无 CORS 头 + 腾讯云 WAF 防护，**浏览器直接 fetch 会被拦截**。当前方案通过 GitHub Actions 服务端抓取写入静态文件来绕过。

### 赔率数据格式 (lottery-odds.json)

```json
{
  "updateTime": "2026-06-16T09:23:11.096Z",
  "source": "sporttery.cn",
  "matchCount": 12,
  "matches": [{
    "matchNum": 2017,           // 体彩场次编号
    "matchNumStr": "周二017",
    "matchDate": "2026-06-17",
    "matchTime": "03:00:00",
    "homeTeam": "法国",         // 中文队名
    "awayTeam": "塞内加尔",
    "homeTeamEn": "FRA",        // 英文缩写
    "awayTeamEn": "SEN",
    "homeRank": "[I组1]",
    "awayRank": "[I组2]",
    "venue": "比赛将在美国-新泽西州东拉瑟福德举行",
    "status": "Selling",
    "pools": {
      "HAD":  { "h": 1.33, "d": 4.15, "a": 7.30 },
      "HHAD": { "h": 2.12, "d": 3.45, "a": 2.72, "goalLine": "-1" },
      "TTG":  { "s0": 15.00, "s1": 5.45, "s2": 3.80, "s3": 3.50,
                "s4": 4.75, "s5": 8.25, "s6": 14.00, "s7": 19.00 },
      "HAFU": { "hh": 1.53, "hd": 25.00, "ha": 70.00,
                "dh": 3.80, "dd": 8.20, "da": 26.00,
                "ah": 27.00, "ad": 25.00, "aa": 22.00 }
    },
    "availablePools": [
      { "poolCode": "HAD",  "bettingSingle": 0, "bettingAllup": 1 },
      { "poolCode": "HHAD", "bettingSingle": 0, "bettingAllup": 1 },
      { "poolCode": "TTG",  "bettingSingle": 1, "bettingAllup": 1 },
      { "poolCode": "HAFU", "bettingSingle": 1, "bettingAllup": 1 }
    ]
  }]
}
```

### 玩法覆盖

| 玩法 | 代码 | 状态 |
|------|------|------|
| 胜平负 | HAD | 完整赔率 ok |
| 让球胜平负 | HHAD | 完整赔率 + 让球数 ok |
| 总进球 | TTG | 完整赔率 ok（s0~s7，来源 `m.ttg`） |
| 半全场 | HAFU | 完整赔率 ok（hh~aa 9项，来源 `m.hafu`） |
| 比分 | CRS | 接口返回空 `{}`，无法获取 |

**关键发现**：TTG/HAFU 赔率不在 `oddsList` 中，而是在 match 对象的 `m.ttg` / `m.hafu` 字段。

### 前端架构 (`js/lottery.js`)

**页签**：在"历届冠军"后面新增"体彩世界"页签，`switchTab('lottery')` 触发 `renderLottery()`。

**数据匹配**：通过 `TEAM_ZH` 反向映射（中文→英文队名），匹配 `worldcup.json` 中同日期+两队名的比赛，获取国旗和小组信息。匹配不上的也能正常显示。

**投注逻辑**：

- **多选**：同一场同玩法可选多个选项（如主胜+平），跨玩法也可多选
- **串关分组**：按 `(matchNum, pool)` 分组，不同玩法 = 不同串关。一场选 HAD+HHAD = 2个独立 2串1，不混入同一注
- **注数计算**：每场可选选项总数（跨所有玩法）的乘积
- **收益范围**：所有串关赔率的最低~最高值
- **投注金额**：注数 × ¥2/注 × 倍数
- **预计奖金**：倍数 × 2 × 赔率（范围 min~max）
- **单关/串关**：API 返回 `bettingSingle`（0=必须串关，1=可单关），玩法标签用 ●/◐ 标注

**UI 层次**：
- 顶部信息栏（更新时间 + 比赛场数）
- 比赛卡片 × N（国旗、队名、玩法标签 + 赔率按钮）
- 底部固定栏（已选X场 | Y注 | N串1 | [详情]）
- 详情弹窗（分组显示已选、倍数调节 ±、收益范围、投注金额）

## GitHub Pages

- `.nojekyll` file at root prevents Jekyll processing
- Enable Pages in repo Settings → Pages → Source: main branch, root folder
