/**
 * Understat EPL 数据抓取脚本
 *
 * 数据源：Understat 的非官方 JSON 端点（免费、无需 API Key）
 *   - GET  https://understat.com/getLeagueData/{league}/{season}
 *   - POST https://understat.com/main/getPlayersStats/
 *
 * 数据覆盖：
 *   - 联赛积分榜（含 xG/xGA/xpts/npxG/npxGA/ppda/deep）
 *   - 每场比赛历史（每队的 history[] 数组，按日期排列）
 *   - 球员统计（含 xG/xA/xGChain/xGBuildup/npxG/npg/shots/key_passes/黄红牌）
 *
 * 用法：
 *   node scripts/fetch-understat.js                       # 默认 EPL 2025
 *   node scripts/fetch-understat.js EPL 2025              # 指定联赛+赛季
 *   node scripts/fetch-understat.js EPL 2025 data/        # 指定输出目录
 *
 * 输出：
 *   data/understat-epl-standings.json  — 积分榜 + 每队历史
 *   data/understat-epl-players.json    — 全部球员统计（按位置分组）
 *
 * 支持联赛（league 参数）：
 *   EPL(英超)、La_liga(西甲)、Serie_A(意甲)、Bundesliga(德甲)、Ligue_1(法甲)
 *   其它：RFPL(俄超)、Ligue_1(法甲)、Serie_A(意甲) 等见 Understat 网站 URL slug
 *
 * 零依赖：纯 Node.js 内置模块
 *
 * 已知限制：
 *   - Understat 未提供官方文档，端点可能随时变动
 *   - POST 端点返回 gzip 压缩 JSON，已用 zlib 处理
 *   - 无 fixtures 端点，upcoming matches 需从 ESPN 或其它源补充
 */

const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const LEAGUE = argv[0] || 'EPL';
const SEASON = argv[1] || '2025';
const OUTPUT_DIR = argv[2] || path.join(__dirname, '..', 'data');

const BASE = 'https://understat.com';
const REQUEST_TIMEOUT = 20000;
const REQUEST_DELAY_MS = 1200;
const PLAYER_POSITIONS = ['']; // 空字符串 = 全部球员；实测 position 过滤参数无效，单次调用即可

// ========== 通用 HTTP ==========

function httpRequest(method, urlPath, formData) {
  return new Promise((resolve, reject) => {
    const body = formData
      ? Object.entries(formData)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v == null ? '' : v)}`)
          .join('&')
      : null;

    const options = {
      hostname: 'understat.com',
      path: urlPath,
      method,
      timeout: REQUEST_TIMEOUT,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate',
        'Referer': `${BASE}/league/${LEAGUE}/${SEASON}`,
        'X-Requested-With': 'XMLHttpRequest'
      }
    };
    if (body) {
      options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      options.headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = https.request(options, (res) => {
      if (res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode} for ${method} ${urlPath}`));
        res.resume();
        return;
      }
      const chunks = [];
      let stream = res;
      const enc = res.headers['content-encoding'];
      if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString('utf8');
        resolve(text);
      });
      stream.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function fetchJson(method, urlPath, formData) {
  const text = await httpRequest(method, urlPath, formData);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`JSON 解析失败 (${method} ${urlPath}): ${text.slice(0, 200)}`);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`✓ 写入 ${filePath} (${JSON.stringify(data).length} 字节)`);
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ========== 1. 联赛数据（积分榜 + 每队历史） ==========

async function fetchLeagueData() {
  console.log(`[Understat] GET /getLeagueData/${LEAGUE}/${SEASON}`);
  const data = await fetchJson('GET', `/getLeagueData/${LEAGUE}/${SEASON}`);

  const teams = data.teams || {};
  const standings = [];

  for (const [teamId, team] of Object.entries(teams)) {
    const history = (team.history || []).map((h) => ({
      date: h.date,
      homeAway: h.h_a,                // 'h' = 主场, 'a' = 客场
      result: h.result,                // 'w'/'d'/'l'
      scored: toNum(h.scored),
      missed: toNum(h.missed),
      xG: toNum(h.xG),
      xGA: toNum(h.xGA),
      npxG: toNum(h.npxG),
      npxGA: toNum(h.npxGA),
      xpts: toNum(h.xpts),
      npxGD: toNum(h.npxGD),
      ppda: h.ppda,                    // 防守压力强度 {att, def}
      ppdaAllowed: h.ppda_allowed,
      deep: h.deep,                    // 禁区触球次数
      deepAllowed: h.deep_allowed,
      pts: toNum(h.pts),
      wins: toNum(h.wins),
      draws: toNum(h.draws),
      loses: toNum(h.loses)
    }));

    // 累计统计：每条 history 的 wins/draws/loses/pts 是单场值（1 或 0），需 sum
    const sum = (f) => history.reduce((s, m) => s + (Number(m[f]) || 0), 0);
    standings.push({
      teamId,
      team: team.title,
      history,
      summary: {
        matches: history.length,
        wins: sum('wins'),
        draws: sum('draws'),
        loses: sum('loses'),
        pts: sum('pts'),
        scored: sum('scored'),
        missed: sum('missed'),
        xG: sum('xG'),
        xGA: sum('xGA'),
        npxG: sum('npxG'),
        npxGA: sum('npxGA'),
        deep: sum('deep'),
        deepAllowed: sum('deepAllowed')
      }
    });
  }

  // 按 PTS → xpts → xG 排序
  standings.sort((a, b) => {
    if (b.summary.pts !== a.summary.pts) return b.summary.pts - a.summary.pts;
    return (b.summary.xG - b.summary.xGA) - (a.summary.xG - a.summary.xGA);
  });

  return {
    source: 'understat.com',
    league: LEAGUE,
    season: SEASON,
    updateTime: new Date().toISOString(),
    standings: standings.map((s, i) => ({
      rank: i + 1,
      teamId: s.teamId,
      team: s.team,
      ...s.summary,
      xGD: Number((s.summary.xG - s.summary.xGA).toFixed(2)),
      npxGD: Number((s.summary.npxG - s.summary.npxGA).toFixed(2))
    })),
    teamHistory: standings.map(s => ({
      teamId: s.teamId,
      team: s.team,
      history: s.history
    }))
  };
}

// ========== 2. 球员统计（按位置分组） ==========

async function fetchPlayersByPosition(position) {
  const params = {
    league: LEAGUE,
    season: SEASON,
    position,
    team: '',
    mins_min: '',
    mins_max: ''
  };
  console.log(`[Understat] POST /main/getPlayersStats/ position=${position || 'ALL'}`);
  const data = await fetchJson('POST', '/main/getPlayersStats/', params);
  if (!data.success) {
    throw new Error(`API 返回 success=false: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data.players || [];
}

function mapPlayer(p) {
  return {
    id: p.id,
    name: p.player_name,
    team: p.team_title,
    position: p.position,           // 'GK' / 'D' / 'M S' / 'F S'
    games: toNum(p.games),
    minutes: toNum(p.time),
    goals: toNum(p.goals),
    npg: toNum(p.npg),             // 非点球进球
    assists: toNum(p.assists),
    xG: toNum(p.xG),
    xA: toNum(p.xA),
    npxG: toNum(p.npxG),
    xGChain: toNum(p.xGChain),     // xG Chain — 球员参与的所有射门 xG 总和
    xGBuildup: toNum(p.xGBuildup), // xG Buildup — 不含最后两传的 Chain
    shots: toNum(p.shots),
    keyPasses: toNum(p.key_passes),
    yellowCards: toNum(p.yellow_cards),
    redCards: toNum(p.red_cards)
  };
}

async function fetchAllPlayers() {
  const allPlayers = [];
  const seenIds = new Set();
  for (const pos of PLAYER_POSITIONS) {
    const label = pos || 'ALL';
    try {
      const list = await fetchPlayersByPosition(pos);
      for (const p of list) {
        if (seenIds.has(p.id)) continue; // ALL 与分位置查询会有重复
        seenIds.add(p.id);
        allPlayers.push(mapPlayer(p));
      }
      console.log(`  - position=${label}: ${list.length} 条（去重后新增 ${list.length}）`);
    } catch (e) {
      console.warn(`  ! position=${label} 失败: ${e.message}`);
    }
    await sleep(REQUEST_DELAY_MS);
  }
  return allPlayers;
}

// ========== 主流程 ==========

async function main() {
  console.log(`[Understat] 联赛=${LEAGUE}  赛季=${SEASON}  输出=${OUTPUT_DIR}`);
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // 1. 联赛数据
  const league = await fetchLeagueData();
  const leaguePath = path.join(OUTPUT_DIR, `understat-${LEAGUE.toLowerCase()}-${SEASON}-standings.json`);
  writeJson(leaguePath, league);

  // 2. 球员统计
  const players = await fetchAllPlayers();
  const playersOut = {
    source: 'understat.com',
    league: LEAGUE,
    season: SEASON,
    updateTime: new Date().toISOString(),
    count: players.length,
    players
  };
  const playersPath = path.join(OUTPUT_DIR, `understat-${LEAGUE.toLowerCase()}-${SEASON}-players.json`);
  writeJson(playersPath, playersOut);

  console.log(`\n[Understat] 积分榜 ${league.standings.length} 行`);
  console.log(`[Understat] 球员 ${players.length} 名`);
  console.log('[Understat] 完成');
}

main().catch(e => {
  console.error(`[Understat] 致命错误: ${e.stack || e.message}`);
  process.exit(1);
});
