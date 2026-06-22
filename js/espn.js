// js/espn.js
// ESPN 非官方 API — 免费、无需 Key，提供实时比分和积分榜数据
var ESPN_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';
var ESPN_STANDINGS = 'https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings';

// 缓存的 ESPN 原始数据，供红黄牌提取复用
var espnRawEvents = null;
// 红黄牌和停赛数据
var worldCupCards = null;
var worldCupSuspensions = null;

// ESPN 和 worldcup.json 之间的队名映射（2026-06-12 全量对比，48支球队差异尽在于此）
var ESPN_TEAM_MAP = {
  'Bosnia-Herzegovina': 'Bosnia & Herzegovina',
  'Congo DR': 'DR Congo',
  'Czechia': 'Czech Republic',
  'Türkiye': 'Turkey',
  'United States': 'USA'
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
    espnRawEvents = data.events || [];
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

// 从缓存的 ESPN 事件中提取红黄牌数据
// 返回 {teamName: {playerName: {yellows, reds, lastMatchNum}}}
function processEspnCards() {
  if (!espnRawEvents || !espnRawEvents.length) return null;

  var cards = {};

  for (var i = 0; i < espnRawEvents.length; i++) {
    var e = espnRawEvents[i];
    var c = e.competitions && e.competitions[0];
    if (!c || !c.competitors || c.competitors.length < 2) continue;

    // 只处理已完赛的比赛
    var state = c.status && c.status.type && c.status.type.state;
    if (state !== 'post') continue;

    var team1Id = c.competitors[0].team.id;
    var team2Id = c.competitors[1].team.id;
    var team1Name = mapEspnName(c.competitors[0].team.displayName);
    var team2Name = mapEspnName(c.competitors[1].team.displayName);
    var matchDate = espnDateKey(e.date);

    if (!cards[team1Name]) cards[team1Name] = {};
    if (!cards[team2Name]) cards[team2Name] = {};

    var details = c.details || [];
    for (var j = 0; j < details.length; j++) {
      var d = details[j];
      if (!d.yellowCard && !d.redCard) continue;
      if (!d.athletesInvolved || !d.athletesInvolved.length) continue;

      var cardTeam = d.team.id === team1Id ? team1Name : team2Name;
      var player = d.athletesInvolved[0];
      var playerKey = player.displayName;

      if (!cards[cardTeam][playerKey]) {
        cards[cardTeam][playerKey] = { yellows: 0, reds: 0, lastMatchDate: matchDate };
      }

      if (d.redCard) {
        cards[cardTeam][playerKey].reds++;
      } else {
        cards[cardTeam][playerKey].yellows++;
      }
      cards[cardTeam][playerKey].lastMatchDate = matchDate;
    }
  }

  worldCupCards = cards;
  return cards;
}

// 根据红黄牌数据 + 赛程计算停赛
// cards: processEspnCards() 的输出
// matches: worldCupData.matches（用于判断哪些是未来比赛）
// 返回 {teamName: {suspensions: N, suspendedPlayers: [...], note: "..."}}
function computeWorldCupSuspensions(cards, matches) {
  if (!cards) { worldCupSuspensions = {}; return {}; }
  if (!matches || !matches.length) { worldCupSuspensions = {}; return {}; }

  // 构建每支球队的赛程（按日期和比赛编号排序）
  var now = new Date();
  var teamSchedule = {}; // {teamName: [{matchNum, date, time, opponent, isFuture}]}

  for (var i = 0; i < matches.length; i++) {
    var m = matches[i];
    if (isPlaceholder(m.team1) || isPlaceholder(m.team2)) continue;

    var kickoff = new Date(m.date + 'T' + (m.time || '00:00').split(' ')[0]);
    var isFuture = kickoff > now;

    [m.team1, m.team2].forEach(function(t, idx) {
      if (!teamSchedule[t]) teamSchedule[t] = [];
      teamSchedule[t].push({
        matchNum: m.num,
        date: m.date,
        time: m.time,
        opponent: idx === 0 ? m.team2 : m.team1,
        round: m.round,
        group: m.group,
        isFuture: isFuture
      });
    });
  }

  // 按日期排序每个球队的赛程
  Object.keys(teamSchedule).forEach(function(t) {
    teamSchedule[t].sort(function(a, b) {
      return a.date.localeCompare(b.date) || (a.matchNum - b.matchNum);
    });
  });

  // 计算停赛
  var suspensions = {};
  var teamNames = Object.keys(cards);

  for (var t = 0; t < teamNames.length; t++) {
    var teamName = teamNames[t];
    var players = cards[teamName];
    var playerNames = Object.keys(players);
    var schedule = teamSchedule[teamName] || [];
    var suspendedPlayers = [];

    // 找到球队最近一场已赛的比赛编号
    var lastPlayedMatchNum = 0;
    for (var s = schedule.length - 1; s >= 0; s--) {
      if (!schedule[s].isFuture) {
        lastPlayedMatchNum = schedule[s].matchNum;
        break;
      }
    }

    // 找到球队下一场未赛的比赛
    var nextMatch = null;
    for (var ns = 0; ns < schedule.length; ns++) {
      if (schedule[ns].isFuture) {
        nextMatch = schedule[ns];
        break;
      }
    }

    for (var p = 0; p < playerNames.length; p++) {
      var playerName = playerNames[p];
      var data = players[playerName];
      var isSuspended = false;
      var reason = '';

      // 红牌 → 下一场停赛
      if (data.reds > 0) {
        // 如果红牌在最近一场比赛 → 下一场仍停赛
        isSuspended = true;
        reason = '红牌';
      }
      // 累计2黄且第2张在最近一场比赛 → 下一场停赛
      else if (data.yellows >= 2) {
        isSuspended = true;
        reason = '累计' + data.yellows + '黄';
      }

      // 如果有未赛比赛且球员停赛，则记录
      if (isSuspended && nextMatch) {
        suspendedPlayers.push({
          name: playerName,
          reason: reason,
          yellows: data.yellows,
          reds: data.reds
        });
      }
    }

    var note = '';
    if (suspendedPlayers.length > 0) {
      note = suspendedPlayers.map(function(sp) {
        return sp.name + '(' + sp.reason + ')';
      }).join('; ');
    }

    suspensions[teamName] = {
      suspensions: suspendedPlayers.length,
      suspendedPlayers: suspendedPlayers,
      note: note
    };
  }

  worldCupSuspensions = suspensions;
  return suspensions;
}

// ---- 比赛详情（阵容 + 事件） ----

var matchSummaryCache = {};

// 根据 worldcup.json 的 match 对象查找对应的 ESPN event ID
function findEspnEventId(match) {
  if (!espnRawEvents || !espnRawEvents.length) return null;
  if (!match || !match.team1 || !match.team2) return null;

  var matchUtcDate = typeof toUTCDate === 'function' ? toUTCDate(match.date, match.time) : match.date.split('T')[0];

  for (var i = 0; i < espnRawEvents.length; i++) {
    var e = espnRawEvents[i];
    var c = e.competitions && e.competitions[0];
    if (!c || !c.competitors || c.competitors.length < 2) continue;

    var espnDate = espnDateKey(e.date);
    var t1 = mapEspnName(c.competitors[0].team.displayName);
    var t2 = mapEspnName(c.competitors[1].team.displayName);

    if (espnDate === matchUtcDate) {
      if ((t1 === match.team1 && t2 === match.team2) ||
          (t1 === match.team2 && t2 === match.team1)) {
        return e.id;
      }
    }
  }
  return null;
}

// 从 ESPN Web API 获取比赛详情（阵容、进球、红黄牌、技术统计）
function fetchMatchSummary(eventId) {
  if (!eventId) return Promise.resolve(null);

  if (matchSummaryCache[eventId]) {
    return Promise.resolve(matchSummaryCache[eventId]);
  }

  var url = 'https://site.web.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=' + eventId;

  return fetch(url).then(function(resp) {
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return resp.json();
  }).then(function(data) {
    var summary = formatMatchSummary(data, eventId);
    matchSummaryCache[eventId] = summary;
    return summary;
  }).catch(function(e) {
    console.warn('Failed to fetch match summary for event ' + eventId + ':', e.message);
    return null;
  });
}

// 将 ESPN Web API 原始数据格式化为前端易用的结构
function formatMatchSummary(data, eventId) {
  if (!data) return null;

  var summary = {
    eventId: eventId,
    lineups: [],
    events: [],
    stats: null,
    header: data.header || {},
    gameInfo: data.gameInfo || {}
  };

  // 阵容数据
  if (data.rosters) {
    for (var i = 0; i < data.rosters.length; i++) {
      var r = data.rosters[i];
      var lineup = {
        team: (r.team || {}).displayName || '',
        formation: r.formation || '',
        homeAway: r.homeAway || '',
        starters: [],
        bench: []
      };

      (r.roster || []).forEach(function(p) {
        var player = {
          name: (p.athlete || {}).displayName || ((p.athlete || {}).fullName) || '',
          shortName: (p.athlete || {}).shortName || '',
          jersey: p.jersey || '',
          position: (p.position || {}).displayName || (p.position || {}).name || '',
          positionAbbr: (p.position || {}).abbreviation || '',
          starter: !!p.starter
        };
        if (player.starter) {
          lineup.starters.push(player);
        } else {
          lineup.bench.push(player);
        }
      });

      summary.lineups.push(lineup);
    }
  }

  // 比赛事件（进球、红黄牌、点球等）
  if (data.keyEvents) {
    for (var k = 0; k < data.keyEvents.length; k++) {
      var ke = data.keyEvents[k];
      var type = (ke.type || {}).type || (ke.type || {}).text || '';
      var isGoal = type.indexOf('goal') >= 0 && type.indexOf('own-goal') === -1;
      var isOwnGoal = type.indexOf('own-goal') >= 0;
      var isCard = type === 'yellow-card' || type === 'red-card';
      var isSub = type === 'substitution';

      if (!isGoal && !isCard && !isSub && !isOwnGoal) continue;

      var evt = {
        type: type,
        typeText: (ke.type || {}).text || '',
        time: (ke.clock || {}).displayValue || '',
        timeValue: (ke.clock || {}).value || 0,
        period: (ke.period || {}).number || 1,
        team: (ke.team || {}).displayName || '',
        text: ke.text || '',
        shortText: ke.shortText || ''
      };

      // 参与者
      if (ke.participants) {
        evt.participants = ke.participants.map(function(p) {
          return {
            name: (p.athlete || {}).displayName || '',
            type: p.type || ''
          };
        });
      }

      summary.events.push(evt);
    }
  }

  // 技术统计
  if (data.boxscore && data.boxscore.teams) {
    summary.stats = data.boxscore.teams.map(function(t) {
      return {
        team: (t.team || {}).displayName || '',
        stats: (t.statistics || []).map(function(s) {
          return {
            name: s.name || s.label || '',
            value: s.displayValue || s.value || ''
          };
        })
      };
    });
  }

  return summary;
}
