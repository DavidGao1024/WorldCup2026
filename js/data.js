// js/data.js
var CDN_URL = 'https://cdn.jsdelivr.net/gh/openfootball/worldcup.json@master/2026/worldcup.json';
var CACHE_KEY = 'wc-data';
var CACHE_TIME_KEY = 'wc-data-time';

var worldCupData = null;

async function loadData() {
  var cached = localStorage.getItem(CACHE_KEY);
  if (cached) {
    worldCupData = JSON.parse(cached);
  }

  // 后台拉取最新数据（CDN + ESPN 并行）
  fetchFreshData();
  fetchEspnAndMerge();

  if (worldCupData) return worldCupData;

  // 无缓存 → 加载本地 fallback
  try {
    var resp = await fetch('data/worldcup.json');
    worldCupData = await resp.json();
    fetchEspnAndMerge();
    return worldCupData;
  } catch (e) {
    console.error('Failed to load data');
    return null;
  }
}

async function fetchEspnAndMerge() {
  var scoreMap = await fetchEspnScores();
  if (!scoreMap) return;

  // 从 ESPN 原始数据中提取红黄牌，计算停赛
  if (espnRawEvents && espnRawEvents.length) {
    var cards = processEspnCards();
    if (cards && worldCupData && worldCupData.matches) {
      computeWorldCupSuspensions(cards, worldCupData.matches);
    }
  }

  if (mergeScoresIntoData(scoreMap)) {
    saveToCache();
    if (typeof refreshCurrentTab === 'function') refreshCurrentTab();
  }
}

function mergeScoresIntoData(scoreMap) {
  if (!worldCupData || !worldCupData.matches) return false;
  var changed = false;
  worldCupData.matches.forEach(function(m) {
    var utcDate = toUTCDate(m.date, m.time);
    var key = utcDate + '|' + m.team1 + '|' + m.team2;
    var entry = scoreMap[key];
    if (!entry) {
      key = utcDate + '|' + m.team2 + '|' + m.team1;
      entry = scoreMap[key];
    }
    if (entry) {
      if (m.score1 !== entry.score1 || m.score2 !== entry.score2) {
        m.score1 = entry.score1;
        m.score2 = entry.score2;
        changed = true;
      }
      if (m.status !== entry.state) {
        m.status = entry.state;
        changed = true;
      }
    }
  });
  return changed;
}

// 将 worldcup.json 的本地日期+时间转为 UTC 日期，用于和 ESPN API 匹配
// 例如 date="2026-06-11" time="20:00 UTC-6" → "2026-06-12"
function toUTCDate(dateStr, timeStr) {
  var m = timeStr.match(/UTC([+-]\d+)/);
  if (!m) return dateStr;
  var offset = parseInt(m[1], 10);
  var parts = timeStr.split(' ')[0].split(':');
  var h = parseInt(parts[0], 10);
  var min = parseInt(parts[1], 10) || 0;
  // UTC = 本地时间 - 偏移量（UTC-6 → 减 -6 = 加 6）
  var totalMin = h * 60 + min - offset * 60;
  var d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCMinutes(d.getUTCMinutes() + totalMin);
  return d.toISOString().split('T')[0];
}

function saveToCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(worldCupData));
    localStorage.setItem(CACHE_TIME_KEY, String(Date.now()));
  } catch (e) {}
}

async function fetchFreshData() {
  try {
    var resp = await fetch(CDN_URL);
    if (!resp.ok) return;
    var newData = await resp.json();
    var oldMatches = worldCupData ? JSON.stringify(worldCupData.matches) : '';
    var newMatches = newData.matches ? JSON.stringify(newData.matches) : '';
    if (oldMatches !== newMatches) {
      // CDN 有更新 → 合并 ESPN 比分后替换
      worldCupData = newData;
      saveToCache();
      // 重新拉 ESPN 比分覆盖 CDN 中可能为空的比分
      fetchEspnAndMerge();
    }
  } catch (e) {
    // 静默失败
  }
}

function getMatches() {
  if (!worldCupData) return [];
  return worldCupData.matches.map(function(m, i) {
    if (!m.num) m.num = i + 1;
    return m;
  });
}

function getGroupMatches() {
  return getMatches().filter(function(m) { return m.group && m.group.indexOf('Group ') === 0; });
}

function getKnockoutMatches() {
  return getMatches().filter(function(m) { return !m.group || m.group.indexOf('Group ') !== 0; });
}

function getGroups() {
  var groups = [];
  var seen = {};
  getGroupMatches().forEach(function(m) {
    if (!seen[m.group]) { seen[m.group] = true; groups.push(m.group); }
  });
  return groups.sort();
}

function getTeams() {
  var teams = [];
  var seen = {};
  getMatches().forEach(function(m) {
    [m.team1, m.team2].forEach(function(t) {
      if (t && !isPlaceholder(t) && !seen[t]) {
        seen[t] = true; teams.push(t);
      }
    });
  });
  return teams.sort();
}

function isPlaceholder(name) {
  return name[0] === 'W' || name[0] === 'L' || /^\d[A-Z]/.test(name);
}

function getTeamsByGroup(groupName) {
  var teams = [];
  var seen = {};
  getGroupMatches().forEach(function(m) {
    if (groupName && m.group !== groupName) return;
    [m.team1, m.team2].forEach(function(t) {
      if (t && !isPlaceholder(t) && !seen[t]) {
        seen[t] = true; teams.push(t);
      }
    });
  });
  return teams.sort();
}

function computeStandings(groupName) {
  var matches = getGroupMatches().filter(function(m) { return m.group === groupName; });
  var teams = {};
  matches.forEach(function(m) {
    if (!teams[m.team1]) teams[m.team1] = newRecord();
    if (!teams[m.team2]) teams[m.team2] = newRecord();
    if (m.score1 != null && m.score2 != null) {
      var t1 = teams[m.team1], t2 = teams[m.team2];
      t1.played++; t2.played++;
      t1.gf += m.score1; t1.ga += m.score2;
      t2.gf += m.score2; t2.ga += m.score1;
      t1.gd = t1.gf - t1.ga; t2.gd = t2.gf - t2.ga;
      if (m.score1 > m.score2) { t1.won++; t2.lost++; t1.pts += 3; }
      else if (m.score1 < m.score2) { t2.won++; t1.lost++; t2.pts += 3; }
      else { t1.drawn++; t2.drawn++; t1.pts += 1; t2.pts += 1; }
    }
  });
  return Object.entries(teams)
    .map(function(e) { var r = e[1]; r.name = e[0]; return r; })
    .sort(function(a, b) { return b.pts - a.pts || b.gd - a.gd || b.gf - a.gf; });
}

function newRecord() {
  return { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, pts: 0 };
}
