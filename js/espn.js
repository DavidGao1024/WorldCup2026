// js/espn.js
// ESPN 非官方 API — 免费、无需 Key，提供实时比分和积分榜数据
var ESPN_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';
var ESPN_STANDINGS = 'https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings';

// ESPN 和 worldcup.json 之间的队名映射
var ESPN_TEAM_MAP = {
  'Czechia': 'Czech Republic',
  'Bosnia-Herzegovina': 'Bosnia & Herzegovina'
};

function mapEspnName(name) {
  return ESPN_TEAM_MAP[name] || name;
}

function espnDateKey(dateStr) {
  return (dateStr || '').split('T')[0];
}

// 从 ESPN scoreboard 拉取比分，返回 match-key → scores 的映射
// key 格式: "date|team1|team2"
async function fetchEspnScores() {
  try {
    var url = ESPN_SCOREBOARD + '?dates=20260611-20260719&limit=200';
    var resp = await fetch(url);
    if (!resp.ok) return null;
    var data = await resp.json();
    var map = {};
    (data.events || []).forEach(function(e) {
      var c = e.competitions && e.competitions[0];
      if (!c || !c.competitors || c.competitors.length < 2) return;
      if (!c.status || !c.status.type) return;
      var state = c.status.type.state;
      // 只处理已结束或进行中的比赛
      if (state !== 'post' && state !== 'in') return;
      var s1 = c.competitors[0].score;
      var s2 = c.competitors[1].score;
      if (s1 == null || s2 == null || isNaN(s1) || isNaN(s2)) return;
      var date = espnDateKey(e.date);
      var t1 = mapEspnName(c.competitors[0].team.displayName);
      var t2 = mapEspnName(c.competitors[1].team.displayName);
      // 双向 key，方便匹配
      map[date + '|' + t1 + '|' + t2] = { score1: parseInt(s1), score2: parseInt(s2) };
      map[date + '|' + t2 + '|' + t1] = { score1: parseInt(s2), score2: parseInt(s1) };
    });
    return map;
  } catch (e) {
    console.warn('ESPN score fetch failed:', e);
    return null;
  }
}

// 从 ESPN 拉取积分榜
async function fetchEspnStandings() {
  try {
    var resp = await fetch(ESPN_STANDINGS_URL);
    if (!resp.ok) return null;
    var data = await resp.json();
    var result = {};
    (data.children || []).forEach(function(g) {
      result[g.name] = (g.standings.entries || []).map(function(e) {
        var s = {};
        (e.stats || []).forEach(function(st) { s[st.name] = st.value; });
        return {
          name: mapEspnName(e.team.displayName),
          played: s.gamesPlayed || 0,
          won: s.wins || 0,
          drawn: s.ties || 0,
          lost: s.losses || 0,
          gf: s.pointsFor || 0,
          ga: s.pointsAgainst || 0,
          gd: s.pointDifferential || 0,
          pts: s.points || 0
        };
      });
    });
    return result;
  } catch (e) {
    console.warn('ESPN standings fetch failed:', e);
    return null;
  }
}
