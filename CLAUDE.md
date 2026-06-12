# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Rules

- **始终使用中文沟通**，所有解释、回复、说明用简体中文
- **永远不自动提交代码**，只有用户明确说"提交"或"commit"时才执行 git commit

## Project overview

Pure frontend static site for 2026 FIFA World Cup (USA/Canada/Mexico). Three tabs: Schedule (赛程), Standings (积分榜), Knockout (淘汰赛). Hosted on GitHub Pages. Zero build tools, zero frameworks — vanilla HTML/CSS/JS.

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
3. **espn.js** — `fetchEspnScores()`, `fetchEspnStandings()`, `mapEspnName()`, `ESPN_TEAM_MAP` — 从 ESPN 非官方 API 拉取实时比分和积分榜
4. **data.js** — `loadData()`, `getMatches()`, `getGroupMatches()`, `getKnockoutMatches()`, `getGroups()`, `getTeams()`, `getTeamsByGroup()`, `computeStandings()`, `isPlaceholder()`, `fetchEspnAndMerge()`, `mergeScoresIntoData()`
5. **schedule.js** — `renderSchedule()`, `populateFilters()`, `populateTeamFilter()`
6. **standings.js** — `renderStandings()`, `onStandingsGroupChange()`
7. **knockout.js** — `renderKnockout()`
8. **app.js** — `init()`, `switchTab()`, `onFilterChange()`, `onTeamFilterChange()`, `getFlagImg()`, `getFlag()`, `roundKey()`, `updateUIText()`, `refreshCurrentTab()`, `FLAG_MAP`

All variables are global (`var`). No modules or bundler.

### Data flow

1. `init()` calls `loadData()` → 先读 LocalStorage 缓存（1h TTL），无缓存则加载 `data/worldcup.json`
2. 后台并行：`fetchEspnAndMerge()` 从 ESPN API 拉取实时比分，合并到 `worldCupData.matches`；`fetchFreshData()` 从 jsDelivr CDN 拉取最新赛程
3. ESPN 拉取成功 → 比分写入 match 的 `score1`/`score2` → 更新缓存 + 刷新 UI
4. ESPN 失败 → 静默 fallback，使用缓存或 CDN 中的旧数据
5. `computeStandings()` 根据已有 `score1`/`score2` 计算小组积分（null 的比赛不参与计算）
6. Tab 切换时调用对应的 render 函数

### ESPN API

- **Scoreboard**: `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260611-20260719&limit=200`
  - 免 Key，无需认证
  - 返回 `events[].competitions[0].competitors[]` → `score`, `homeAway`, `team.displayName`
  - 只合并 `state === 'post'` 或 `'in'` 的比赛比分
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
- **Placeholder team names**: `isPlaceholder()` detects `W*`, `L*`, and `\d[A-Z]` patterns. `trTeam()` translates them in Chinese mode ("2A" → "A组第2名", "W74" → "胜者74")

## GitHub Pages

- `.nojekyll` file at root prevents Jekyll processing
- Enable Pages in repo Settings → Pages → Source: main branch, root folder
