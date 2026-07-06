// scripts/find-missing-players.js
// 扫描所有已完赛比赛的阵容，找出 PLAYER_ZH 数据库中缺失的球员名
// 输出 JSON 模板，方便手动补充中文译名后合并到 data/players-zh.json
//
// 用法: node scripts/find-missing-players.js > data/missing-players.json

const https = require('https');
const fs = require('fs');
const path = require('path');

const SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260611-20260719&limit=200';
const PLAYERS_ZH_PATH = path.join(__dirname, '..', 'data', 'players-zh.json');

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// 模拟 trPlayer 的匹配逻辑
function normalize(name) {
  return (name || '')
    .replace(/[áàâãäå]/g,'a').replace(/[ÁÀÂÃÄÅ]/g,'A')
    .replace(/[éèêë]/g,'e').replace(/[ÉÈÊË]/g,'E')
    .replace(/[íìîï]/g,'i').replace(/[ÍÌÎÏ]/g,'I')
    .replace(/[óòôõöø]/g,'o').replace(/[ÓÒÔÕÖØ]/g,'O')
    .replace(/[úùûü]/g,'u').replace(/[ÚÙÛÜ]/g,'U')
    .replace(/[ýÿ]/g,'y').replace(/[ÝŸ]/g,'Y')
    .replace(/ç/g,'c').replace(/Ç/g,'C')
    .replace(/ñ/g,'n').replace(/Ñ/g,'N')
    .replace(/š/g,'s').replace(/Š/g,'S')
    .replace(/ž/g,'z').replace(/Ž/g,'Z')
    .replace(/ø/g,'o').replace(/Ø/g,'O')
    .replace(/æ/g,'ae').replace(/Æ/g,'AE')
    .replace(/å/g,'a').replace(/Å/g,'A')
    .replace(/œ/g,'oe').replace(/Œ/g,'OE')
    .replace(/ß/g,'ss')
    .replace(/đ/g,'d').replace(/Đ/g,'D')
    .replace(/ł/g,'l').replace(/Ł/g,'L')
    .replace(/ð/g,'d').replace(/Ð/g,'D');
}

function trPlayer(name, db) {
  if (!name) return name;
  // Exact match
  if (db[name]) return db[name];
  // Case-insensitive
  var lower = name.toLowerCase();
  for (var k in db) {
    if (k.toLowerCase() === lower) return db[k];
  }
  // Accent normalized
  var norm = normalize(name);
  if (norm !== name && db[norm]) return db[norm];
  // Word-by-word
  var parts = name.split(/\s+/);
  if (parts.length > 1) {
    for (var i = 0; i < parts.length; i++) {
      if (db[parts[i]]) return db[parts[i]];
    }
  }
  return null; // not found
}

(async () => {
  console.error('Fetching scoreboard...');
  const scoreData = await fetch(SCOREBOARD_URL);
  const events = scoreData.events || [];

  // Collect completed event IDs
  const completedIds = [];
  events.forEach(e => {
    const c = e.competitions && e.competitions[0];
    if (c && c.status && c.status.type && c.status.type.state === 'post') {
      completedIds.push(e.id);
    }
  });

  console.error(`Found ${completedIds.length} completed matches`);

  // Load existing DB (key is under .players)
  const raw = JSON.parse(fs.readFileSync(PLAYERS_ZH_PATH, 'utf8'));
  const db = raw.players || raw;
  const allNames = new Set();

  // Fetch each match summary
  for (let i = 0; i < completedIds.length; i++) {
    const id = completedIds[i];
    try {
      const data = await fetch(`https://site.web.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${id}`);
      if (data.rosters) {
        data.rosters.forEach(r => {
          (r.roster || []).forEach(p => {
            const name = (p.athlete || {}).displayName || (p.athlete || {}).shortName || '';
            if (name) allNames.add(name);
          });
        });
      }
    } catch(e) {
      console.error(`  Failed: event ${id}`);
    }
  }

  console.error(`Total unique players: ${allNames.size}`);

  // Find missing
  const missing = {};
  allNames.forEach(name => {
    if (!trPlayer(name, db)) {
      missing[name] = '';
    }
  });

  console.error(`Missing Chinese names: ${Object.keys(missing).length}`);

  // Output as clean JSON template
  const output = {};
  Object.keys(missing).sort().forEach(k => { output[k] = ''; });

  // Write directly to file to keep output clean
  const outPath = path.join(__dirname, '..', 'data', 'missing-players.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
  console.error(`Written to ${outPath}`);
})().catch(e => { console.error(e); process.exit(1); });
