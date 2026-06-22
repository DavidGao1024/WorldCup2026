// scripts/fetch-injuries.js
// 生成/维护伤病数据模板
// 无需 API Key — 停赛数据由 ESPN 公开 API 实时计算（见 js/espn.js）
// 伤病数据需手动填写或在 data/injuries.json 中维护
// 用法: node scripts/fetch-injuries.js

var fs = require('fs');
var path = require('path');

var worldCupPath = path.join(__dirname, '..', 'data', 'worldcup.json');
var injuriesPath = path.join(__dirname, '..', 'data', 'injuries.json');

try {
  var worldCup = JSON.parse(fs.readFileSync(worldCupPath, 'utf-8'));
} catch (e) {
  console.error('无法读取 worldcup.json:', e.message);
  process.exit(1);
}

// 提取所有唯一队伍名（排除占位符如 W1, L1, 1A 等）
var teams = {};
(worldCup.matches || []).forEach(function(m) {
  [m.team1, m.team2].forEach(function(t) {
    if (t && !/^[WL\d]/.test(t)) teams[t] = true;
  });
});

// 读取现有伤病数据
var existing = {};
try {
  existing = JSON.parse(fs.readFileSync(injuriesPath, 'utf-8'));
  // 旧格式可能有 updateTime/source 等顶层字段，跳过非对象的值
} catch (e) {
  // 文件不存在或损坏，将创建新文件
}

// 合并：保留已有伤病数据，为新队伍添加空记录
var merged = {
  updateTime: new Date().toISOString(),
  source: 'manual',
  note: '伤病数据手动维护。停赛数据由 ESPN API 实时计算，无需在此填写。'
};

Object.keys(teams).sort().forEach(function(team) {
  var prev = (existing[team] && typeof existing[team] === 'object') ? existing[team] : {};
  merged[team] = {
    injuries: prev.injuries || 0,
    suspensions: 0,
    note: prev.note || prev.injuryNote || ''
  };
});

fs.writeFileSync(injuriesPath, JSON.stringify(merged, null, 2), 'utf-8');

var teamCount = Object.keys(teams).length;
var hasData = Object.keys(existing).filter(function(k) {
  return existing[k] && typeof existing[k] === 'object' && existing[k].injuries;
}).length;

console.log('已更新 data/injuries.json');
console.log('  共 ' + teamCount + ' 支球队');
console.log('  ' + hasData + ' 支球队有伤病记录');
if (process.env.CI || process.env.GITHUB_ACTIONS) {
  if (hasData > 0) {
    console.log('有伤病数据更新，将提交到仓库');
  } else {
    console.log('伤病数据无变化');
  }
}
