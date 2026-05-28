// js/data.js
var CDN_URL = 'https://cdn.jsdelivr.net/gh/openfootball/worldcup.json@master/2026/worldcup.json';
var CACHE_KEY = 'wc-data';
var CACHE_TIME_KEY = 'wc-data-time';
var CACHE_TTL = 3600000;

var worldCupData = null;

async function loadData() {
  var cached = localStorage.getItem(CACHE_KEY);
  var cacheTime = localStorage.getItem(CACHE_TIME_KEY);
  if (cached && cacheTime && (Date.now() - parseInt(cacheTime) < CACHE_TTL)) {
    worldCupData = JSON.parse(cached);
    return worldCupData;
  }

  try {
    var resp = await fetch(CDN_URL);
    if (resp.ok) {
      worldCupData = await resp.json();
      localStorage.setItem(CACHE_KEY, JSON.stringify(worldCupData));
      localStorage.setItem(CACHE_TIME_KEY, String(Date.now()));
      return worldCupData;
    }
  } catch (e) {
    console.warn('CDN load failed, trying fallback...');
  }

  try {
    var resp2 = await fetch('data/worldcup.json');
    worldCupData = await resp2.json();
    return worldCupData;
  } catch (e) {
    console.error('Failed to load data');
    return null;
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
