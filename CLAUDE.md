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
3. **data.js** — `loadData()`, `getMatches()`, `getGroupMatches()`, `getKnockoutMatches()`, `getGroups()`, `getTeams()`, `getTeamsByGroup()`, `computeStandings()`, `isPlaceholder()`
4. **schedule.js** — `renderSchedule()`, `populateFilters()`, `populateTeamFilter()`
5. **standings.js** — `renderStandings()`, `onStandingsGroupChange()`
6. **knockout.js** — `renderKnockout()`
7. **app.js** — `init()`, `switchTab()`, `onFilterChange()`, `onTeamFilterChange()`, `getFlagImg()`, `getFlag()`, `roundKey()`, `updateUIText()`, `refreshCurrentTab()`, `FLAG_MAP`

All variables are global (`var`). No modules or bundler.

### Data flow

1. `init()` calls `loadData()` → fetches from jsDelivr CDN, falls back to `data/worldcup.json`, caches in `LocalStorage` (1h TTL)
2. `getMatches()` fills missing `num` fields by array index (some knockout matches lack them)
3. `computeStandings()` calculates group tables from matches with `score1`/`score2` fields (currently all null — pre-tournament)
4. Tab switch calls the corresponding render function

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
