/**
 * FBref EPL 数据抓取原型
 *
 * 目的：验证 FBref HTML 解析可行性，输出结构化 JSON。
 *
 * 用法：
 *   1) 本地 HTML 模式（推荐，绕过 Cloudflare JS 挑战）
 *      - 浏览器打开 https://fbref.com/comps/9/Premier-League-Stats
 *      - 右键 → 另存为 → tmp/fbref/overview.html
 *      - 对每队 squad 页重复：保存为 tmp/fbref/squads/{TeamAbbrev}.html
 *      - node scripts/fetch-fbref.js tmp/fbref/overview.html data tmp/fbref/squads
 *
 *   2) URL 模式（大概率被 Cloudflare 403）
 *      - node scripts/fetch-fbref.js https://fbref.com/comps/9/Premier-League-Stats
 *
 * 输出：
 *   data/fbref-epl-standings.json  — 积分榜 + 球队索引
 *   data/fbref-epl-players.json    — 全部球员标准统计
 *
 * 已知限制（生产化前必须解决）：
 *   - Cloudflare 对 FBref 启用 JS 挑战页（"Just a moment..."），curl/Node https 无法直连
 *   - 原型阶段用本地 HTML 文件验证解析逻辑，不验证抓取链路
 *   - 生产方案候选：
 *     a) headless 浏览器（puppeteer/playwright）—— 破坏零依赖约定
 *     b) 第三方 CF 绕过服务（ScrapingBee/ScraperAPI/Zyte）—— 收费但稳定
 *     c) CF Worker 反代 —— 同样过不了 JS 挑战（Worker 是服务端 fetch，无 JS 执行环境）
 *     结论：b 是当前最现实方案
 *
 * 零依赖：纯 Node.js 内置模块
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

const argv = process.argv.slice(2);
const INPUT = argv[0] || 'tmp/fbref/overview.html';
const OUTPUT_DIR = argv[1] || path.join(__dirname, '..', 'data');
const SQUAD_DIR = argv[2] || 'tmp/fbref/squads';

const SEASON = '2025-2026'; // FBref 路径中的赛季段，HTML 内部 table id 也用
const REQUEST_TIMEOUT = 20000;
const REQUEST_DELAY_MS = 1500;

// ============ 读取输入 ============

function readInput(source) {
  if (/^https?:\/\//i.test(source)) {
    return fetchHtml(source);
  }
  return Promise.resolve(fs.readFileSync(source, 'utf8'));
}

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: REQUEST_TIMEOUT,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="131"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1'
      }
    }, (res) => {
      if (res.statusCode === 403) {
        reject(new Error('HTTP 403 — Cloudflare JS 挑战拦截，请用本地 HTML 模式（见脚本顶部注释）'));
        return;
      }
      if (res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      let stream = res;
      const enc = res.headers['content-encoding'];
      if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      stream.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    req.on('error', reject);
  });
}

// ============ 通用 HTML 表格解析器 ============
// 思路：FBref 表格稳定用 data-stat 属性标识列，比位置稳定。
// 1. <table id="...">...</table> 切片
// 2. <thead> 最后一行（叶子列）抽 data-stat → 列名映射
// 3. <tbody> 每个 <tr> 按 data-stat 收集 <th>/<td> 值

function extractTable(html, tableId) {
  const tableRe = new RegExp(
    `<table[^>]*id=["']${tableId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>([\\s\\S]*?)</table>`,
    'i'
  );
  const m = html.match(tableRe);
  if (!m) return null;
  return m[1];
}

function parseColumns(tableContent) {
  const theadM = tableContent.match(/<thead>([\s\S]*?)<\/thead>/i);
  if (!theadM) return [];
  const thead = theadM[1];
  // 过滤 over_header 行（class="over_header"），取叶子行
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let lastRow = '';
  let m;
  while ((m = trRe.exec(thead)) !== null) {
    if (!/class=["'][^"']*over_header/i.test(m[0])) lastRow = m[1];
  }
  if (!lastRow) return [];
  // 抽 data-stat + 文本
  const colRe = /<t[hd][^>]*data-stat=["']([^"']+)[""][^>]*>([\s\S]*?)<\/t[hd]>/gi;
  const cols = [];
  while ((m = colRe.exec(lastRow)) !== null) {
    cols.push({ stat: m[1], label: stripTags(m[2]).trim() });
  }
  return cols;
}

function parseRows(tableContent) {
  const tbodyM = tableContent.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  if (!tbodyM) return [];
  const tbody = tbodyM[1];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const rows = [];
  let m;
  while ((m = trRe.exec(tbody)) !== null) {
    // 跳过分组分隔行（class 含 "partial_table" 等）和合计行（class 含 "sum" 或 "thead"）
    if (/class=["'][^"']*\b(partial_table|sum|thead|spacer)\b/i.test(m[0])) continue;
    // 每个 <th>/<td> 用 data-stat 收集
    const cellRe = /<t[hd][^>]*data-stat=["']([^"']+)["'][^>]*>([\s\S]*?)<\/t[hd]>/gi;
    const cells = {};
    let cm;
    let firstThHref = null;
    while ((cm = cellRe.exec(m[1])) !== null) {
      const stat = cm[1];
      const inner = cm[2];
      const text = stripTags(inner).trim();
      cells[stat] = text;
      // 抓首个链接（通常在 player/-team 列）
      if (firstThHref === null) {
        const hrefM = inner.match(/href=["']([^"']+)["']/i);
        if (hrefM) firstThHref = hrefM[1];
      }
    }
    if (Object.keys(cells).length > 0) {
      rows.push({ cells, link: firstThHref });
    }
  }
  return rows;
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
}

// ============ 联赛总览页解析 ============
// 表格 ID（FBref EPL 2025-2026 赛季）：
//   results2025-2026status1     — 总积分榜（含 MP/W/D/L/PTS，可能含 xG）
//   results2025-2026stats       — xG/xGA 专用榜（若分表）
//   stats_squads_standard_for   — 球队进攻统计
//   stats_squads_standard_against — 球队防守统计

function parseOverview(html) {
  const result = {
    source: 'fbref.com',
    season: SEASON,
    updateTime: new Date().toISOString(),
    standings: [],
    squads: [],
    squadStatsFor: [],
    squadStatsAgainst: []
  };

  // 积分榜表（FBref 用 dynamic id：results{season}status1）
  const standingsId = `results${SEASON.replace('-', '')}status1`;
  // 实际 id 格式：results2025-2026status1
  const standingsIdFull = `results${SEASON}status1`;
  let table = extractTable(html, standingsIdFull) || extractTable(html, standingsId);
  if (table) {
    const cols = parseColumns(table);
    const rows = parseRows(table);
    result.standings = rows.map((r) => mapStandingsRow(r, cols));
    result._standingsCols = cols.map(c => c.stat);
  }

  // 球队列表 + squad 链接：从 standings rows 的 squad 列提取
  if (result.standings.length > 0) {
    result.squads = result.standings
      .filter((s) => s.squad && s.squadLink)
      .map((s) => ({
        name: s.squad,
        link: s.squadLink,
        squadId: extractSquadId(s.squadLink)
      }));
  }

  // 球队进攻/防守聚合统计
  const forTable = extractTable(html, 'stats_squads_standard_for');
  if (forTable) {
    const cols = parseColumns(forTable);
    const rows = parseRows(forTable);
    result.squadStatsFor = rows.map((r) => mapSquadRow(r, cols));
  }
  const againstTable = extractTable(html, 'stats_squads_standard_against');
  if (againstTable) {
    const cols = parseColumns(againstTable);
    const rows = parseRows(againstTable);
    result.squadStatsAgainst = rows.map((r) => mapSquadRow(r, cols));
  }

  return result;
}

function mapStandingsRow(row, cols) {
  const c = row.cells;
  return {
    rank: toNum(c.rk),
    squad: c.squad,
    squadLink: row.link,
    country: c.country,
    mp: toNum(c.mp),
    w: toNum(c.wins) || toNum(c.w),
    d: toNum(c.draws) || toNum(c.d),
    l: toNum(c.losses) || toNum(c.l),
    gf: toNum(c.gf) || toNum(c.goals_for),
    ga: toNum(c.ga) || toNum(c.goals_against),
    gd: toNum(c.gd) || toNum(c.goal_diff),
    pts: toNum(c.pts) || toNum(c.points),
    xg: toNum(c.xg),
    xga: toNum(c.xga),
    xgd: toNum(c.xgd),
    ptsMP: toNum(c.pts_per_mp),
    xgPer90: toNum(c.xg_per90),
    xgaPer90: toNum(c.xga_per90),
    last5: c.last5
  };
}

function mapSquadRow(row, cols) {
  const c = row.cells;
  return {
    squad: c.squad,
    squadLink: row.link,
    mp: toNum(c.mp),
    starts: toNum(c.starts),
    min: toNum(c.minutes) || toNum(c.min),
    '90s': toNum(c['90s']) || toNum(c.min_90s) || toNum(c._90s),
    goals: toNum(c.goals) || toNum(c.gls),
    assists: toNum(c.assists) || toNum(c.ast),
    gPlusA: toNum(c.g_a) || toNum(c.g_plus_a),
    pk: toNum(c.pk),
    pkAtt: toNum(c.pkatt),
    xg: toNum(c.xg),
    xag: toNum(c.xag),
    npxg: toNum(c.npxg),
    npxgPlusXag: toNum(c.npxg_xag)
  };
}

function extractSquadId(link) {
  if (!link) return null;
  const m = link.match(/\/squads\/([^/]+)/);
  return m ? m[1] : null;
}

// ============ 球员统计页解析 ============
// 每队 squad 页表格 ID：
//   stats_standard_9 — 球员标准统计（含 xG/xAG）
//   stats_keeper_9 — 守门员（原型不抓）
//   stats_shooting_9 — 射门（原型不抓，但可加）

function parseSquad(html, squadMeta) {
  const result = {
    source: 'fbref.com',
    season: SEASON,
    squad: squadMeta ? squadMeta.name : null,
    squadId: squadMeta ? squadMeta.squadId : null,
    updateTime: new Date().toISOString(),
    players: []
  };

  const table = extractTable(html, 'stats_standard_9');
  if (!table) return result;
  const cols = parseColumns(table);
  const rows = parseRows(table);
  result.players = rows.map((r) => mapPlayerRow(r, cols));
  result._playerCols = cols.map(c => c.stat);
  return result;
}

function mapPlayerRow(row, cols) {
  const c = row.cells;
  return {
    player: c.player,
    playerLink: row.link,
    nation: c.nation,
    pos: c.pos,
    squad: c.squad,
    age: toNum(c.age),
    born: toNum(c.born),
    mp: toNum(c.mp) || toNum(c.matches),
    starts: toNum(c.starts),
    min: toNum(c.minutes) || toNum(c.min),
    '90s': toNum(c['90s']),
    goals: toNum(c.goals) || toNum(c.gls),
    assists: toNum(c.assists) || toNum(c.ast),
    gPlusA: toNum(c.g_a) || toNum(c.g_plus_a),
    pk: toNum(c.pk),
    pkAtt: toNum(c.pkatt),
    crdY: toNum(c.cards_yellow),
    crdR: toNum(c.cards_red),
    xg: toNum(c.xg),
    xag: toNum(c.xag) || toNum(c.xa),
    npxg: toNum(c.npxg),
    npxgPlusXag: toNum(c.npxg_xag),
    ppg: toNum(c.ppg),
    prog: toNum(c.prgc)
  };
}

// ============ 工具 ============

function toNum(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`✓ 写入 ${filePath} (${JSON.stringify(data).length} 字节)`);
}

// ============ 主流程 ============

async function main() {
  console.log(`[FBref] 输入: ${INPUT}`);
  console.log(`[FBref] 输出目录: ${OUTPUT_DIR}`);

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // --- 1. 解析总览页 ---
  let overviewHtml;
  try {
    overviewHtml = await readInput(INPUT);
  } catch (e) {
    console.error(`[FBref] 读取输入失败: ${e.message}`);
    process.exit(1);
  }

  const overview = parseOverview(overviewHtml);
  const standingsPath = path.join(OUTPUT_DIR, 'fbref-epl-standings.json');
  writeJson(standingsPath, overview);

  console.log(`[FBref] 积分榜: ${overview.standings.length} 行`);
  console.log(`[FBref] 球队: ${overview.squads.length} 支`);
  console.log(`[FBref] 球队进攻统计: ${overview.squadStatsFor.length} 行`);
  console.log(`[FBref] 球队防守统计: ${overview.squadStatsAgainst.length} 行`);

  // --- 2. 解析每队球员页 ---
  if (!fs.existsSync(SQUAD_DIR)) {
    console.log(`[FBref] squad 目录不存在 (${SQUAD_DIR})，跳过球员解析`);
    console.log('[FBref] 提示：用浏览器保存每队 squad 页 HTML 到该目录，重跑本脚本即可解析球员统计');
    return;
  }

  const squadFiles = fs.readdirSync(SQUAD_DIR).filter(f => /\.html?$/i.test(f));
  if (squadFiles.length === 0) {
    console.log(`[FBref] squad 目录为空 (${SQUAD_DIR})，跳过球员解析`);
    return;
  }

  console.log(`\n[FBref] 解析 ${squadFiles.length} 个球队 HTML...`);
  const allPlayers = {
    source: 'fbref.com',
    season: SEASON,
    updateTime: new Date().toISOString(),
    squads: []
  };

  for (const file of squadFiles) {
    const filePath = path.join(SQUAD_DIR, file);
    const html = fs.readFileSync(filePath, 'utf8');
    // 尝试从文件名推队名（去掉 .html）
    const squadName = file.replace(/\.html?$/i, '');
    const squadMeta = { name: squadName, squadId: null };
    const parsed = parseSquad(html, squadMeta);
    console.log(`  - ${squadName}: ${parsed.players.length} 名球员`);
    allPlayers.squads.push({
      name: squadName,
      file: file,
      players: parsed.players,
      columns: parsed._playerCols
    });
    await sleep(REQUEST_DELAY_MS); // 即使读本地文件也保留节奏，便于后续切到远程
  }

  const playersPath = path.join(OUTPUT_DIR, 'fbref-epl-players.json');
  writeJson(playersPath, allPlayers);

  const total = allPlayers.squads.reduce((s, q) => s + q.players.length, 0);
  console.log(`\n[FBref] 共 ${allPlayers.squads.length} 队、${total} 名球员`);
  console.log('[FBref] 完成');
}

main().catch(e => {
  console.error(`[FBref] 致命错误: ${e.stack || e.message}`);
  process.exit(1);
});
