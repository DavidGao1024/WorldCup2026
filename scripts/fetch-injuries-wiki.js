// scripts/fetch-injuries-wiki.js
// 从 Wikipedia "2026 FIFA World Cup squads" 页面自动提取"因伤退出最终名单"的球员
// 用法: node scripts/fetch-injuries-wiki.js
// 在 GitHub Action 中每天运行；本地运行受网络限制可能失败

var fs = require('fs');
var https = require('https');
var path = require('path');

var worldCupPath = path.join(__dirname, '..', 'data', 'worldcup.json');
var injuriesPath = path.join(__dirname, '..', 'data', 'injuries.json');
var playerImportancePath = path.join(__dirname, '..', 'data', 'player-importance.json');

var worldCup = JSON.parse(fs.readFileSync(worldCupPath, 'utf-8'));
var playerImportance = {};
try { playerImportance = JSON.parse(fs.readFileSync(playerImportancePath, 'utf-8')); } catch(e) {}

// 提取所有唯一队伍名
var teams = {};
(worldCup.matches || []).forEach(function(m) {
  [m.team1, m.team2].forEach(function(t) {
    if (t && !/^[WL\d]/.test(t)) teams[t] = true;
  });
});

// 中文→英文队名映射（用于 Wikipedia 解析后映射回 worldcup.json 命名）
// Wikipedia 用的是英文标准名，基本与 worldcup.json 一致
var TEAM_WIKI_MAP = {
  'Bosnia and Herzegovina': 'Bosnia & Herzegovina',
  'DR Congo': 'DR Congo',
  'Czech Republic': 'Czech Republic',
  'Turkey': 'Turkey',
  'United States': 'USA'
  // 默认 1:1 映射
};

function normalizeTeam(name) {
  return TEAM_WIKI_MAP[name] || name;
}

// Wikipedia API: 获取页面 wikitext
function fetchWikitext(title) {
  return new Promise(function(resolve, reject) {
    var url = 'https://en.wikipedia.org/w/api.php?action=parse&page=' + encodeURIComponent(title) +
              '&prop=wikitext&format=json&formatversion=2';
    https.get(url, { headers: { 'User-Agent': 'WorldCup2026Bot/1.0 (https://github.com/DavidGao/WorldCup2026)' } }, function(res) {
      var body = '';
      res.on('data', function(c) { body += c; });
      res.on('end', function() {
        try {
          var data = JSON.parse(body);
          if (data.error) return reject(new Error(data.error.info));
          var wikitext = data.parse && data.parse.wikitext;
          resolve(wikitext || '');
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// 解析 wikitext，提取每队的"因伤退出"球员
// Wikipedia squads 页面通常有以下结构：
// ===Group A=== or ==Algeria==
// 球员通常以表格行或列表形式：* [[Player Name]] (reason) — 因伤退出
// 关键词："injur", "withdrew", "withdrawn", "replaced"
function parseInjuries(wikitext) {
  var injuries = {}; // team -> [{ name, detail }]
  var currentTeam = null;

  var lines = wikitext.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    // 检测球队章节标题：==TeamName== 或 ===TeamName===
    var teamMatch = line.match(/^={2,3}\s*([^=]+?)\s*={2,3}$/);
    if (teamMatch) {
      var candidate = teamMatch[1].trim();
      // 排除"Group A"、"Final squad"等通用标题
      if (!/^Group\s+[A-L]$/i.test(candidate) && !/squad/i.test(candidate) && !/standings/i.test(candidate)) {
        currentTeam = normalizeTeam(candidate);
        if (teams[currentTeam] && !injuries[currentTeam]) injuries[currentTeam] = [];
      }
      continue;
    }

    if (!currentTeam || !injuries[currentTeam]) continue;

    // 检测伤病相关行
    // 模式 1: "* [[Player Name]] (injury)" 或 "{{flagicon image player}}"
    // 模式 2: 表格行 "| Player Name || injury || ..."
    var injuryKeywords = /injur|withdr|replac|miss|knock|hamstr|ankle|knee|muscle|calf|groin|back|shoulder|rib|fractur|tear|strain|sprain/i;

    // 提取 [[Player Name]] 或 **Bold** 或表格中的名字
    var nameMatch = line.match(/\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/);
    if (nameMatch && injuryKeywords.test(line)) {
      var name = nameMatch[1].trim();
      // 排除条目链接（如 [[#Section|anchor]]）
      if (!/^#/.test(name) && !/^(Group|Squad|Standings)/i.test(name)) {
        injuries[currentTeam].push({ name: name, detail: 'injury (Wikipedia)' });
      }
    }
  }

  // 去重
  Object.keys(injuries).forEach(function(t) {
    var seen = {};
    injuries[t] = injuries[t].filter(function(p) {
      if (seen[p.name]) return false;
      seen[p.name] = true;
      return true;
    });
  });

  return injuries;
}

function getImportance(playerName, team) {
  // 从 player-importance.json 查找
  var teamImportance = playerImportance[team] || {};
  for (var key in teamImportance) {
    if (key.toLowerCase() === playerName.toLowerCase()) return teamImportance[key];
  }
  // 默认值
  return 3;
}

async function main() {
  console.log('拉取 Wikipedia: 2026 FIFA World Cup squads...');
  var wikitext = await fetchWikitext('2026 FIFA World Cup squads');
  if (!wikitext) {
    console.error('错误：未能获取 Wikipedia wikitext');
    process.exit(1);
  }
  console.log('wikitext 长度:', wikitext.length);

  var wikiInjuries = parseInjuries(wikitext);
  console.log('解析到伤病的球队数:', Object.keys(wikiInjuries).length);
  Object.keys(wikiInjuries).forEach(function(t) {
    console.log('  ' + t + ': ' + wikiInjuries[t].length + ' 名伤病球员');
  });

  // 读取现有 injuries.json
  var existing = {};
  try { existing = JSON.parse(fs.readFileSync(injuriesPath, 'utf-8')); } catch(e) {}

  // 合并：Wikipedia 拉取的因伤退出 + 现有手动维护的 doubtful 球员
  // 策略：
  // - status=out 的球员：如果 Wikipedia 也提到，保留；Wikipedia 新增的，加入
  // - status=doubtful 的球员：保留（Wikipedia 通常不包含这种）
  // - 不删除现有数据，只追加 Wikipedia 新发现的 out 球员

  var merged = {
    updateTime: new Date().toISOString(),
    source: 'wikipedia+manual',
    _format: 'v2 — players[] 含 name/importance/status/detail。status: out=缺阵(来自Wikipedia) doubtful=伤疑(手动维护)。'
  };

  Object.keys(teams).sort().forEach(function(team) {
    var prev = (existing[team] && typeof existing[team] === 'object') ? existing[team] : {};
    var prevPlayers = prev.players || [];
    var wikiPlayers = wikiInjuries[team] || [];

    // 现有 out 球员的名单
    var prevOutNames = prevPlayers.filter(function(p) { return p.status === 'out'; }).map(function(p) { return p.name.toLowerCase(); });

    // 合并：现有所有球员 + Wikipedia 新发现的 out 球员
    var mergedPlayers = prevPlayers.slice();
    wikiPlayers.forEach(function(wp) {
      var exists = prevOutNames.indexOf(wp.name.toLowerCase()) >= 0;
      if (!exists) {
        mergedPlayers.push({
          name: wp.name,
          importance: getImportance(wp.name, team),
          status: 'out',
          detail: wp.detail
        });
      }
    });

    merged[team] = {
      injuries: mergedPlayers.filter(function(p) { return p.status === 'out'; }).length,
      suspensions: prev.suspensions || 0,
      players: mergedPlayers,
      note: prev.note || ''
    };
  });

  // 检测内容是否真有变化（不比较 updateTime）
  var existingWithoutTime = JSON.parse(JSON.stringify(existing));
  delete existingWithoutTime.updateTime;
  delete existingWithoutTime.source;
  delete existingWithoutTime._format;

  var mergedForCompare = JSON.parse(JSON.stringify(merged));
  delete mergedForCompare.updateTime;

  var hasContentChange = JSON.stringify(mergedForCompare) !== JSON.stringify(existingWithoutTime);

  if (hasContentChange) {
    fs.writeFileSync(injuriesPath, JSON.stringify(merged, null, 2), 'utf-8');
    console.log('已更新 data/injuries.json (内容有变化)');
  } else {
    console.log('伤病数据无变化，跳过写入');
  }
}

main().catch(function(e) {
  console.error('错误:', e.message);
  process.exit(1);
});
