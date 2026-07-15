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

      var statusName = (c.status.type || {}).name || '';
      var period = c.status.period || 0;
      var hadPen = statusName === 'STATUS_FINAL_PEN';
      var hadET = hadPen || period >= 3;
      var sp1 = c.competitors[0].shootoutScore;
      var sp2 = c.competitors[1].shootoutScore;
      var winner = null;
      if (c.competitors[0].winner) winner = mapEspnName(c.competitors[0].team.displayName);
      else if (c.competitors[1].winner) winner = mapEspnName(c.competitors[1].team.displayName);

      var date = espnDateKey(e.date);
      var t1 = mapEspnName(c.competitors[0].team.displayName);
      var t2 = mapEspnName(c.competitors[1].team.displayName);

      function _entry(sa, sb, spa, spb) {
        var e = { score1: parseInt(sa), score2: parseInt(sb), state: state, hadET: hadET, hadPen: hadPen, winner: winner };
        if (spa != null && spb != null) { e.score1p = parseInt(spa); e.score2p = parseInt(spb); }
        return e;
      }

      // 双向 key，方便匹配
      map[date + '|' + t1 + '|' + t2] = _entry(s1, s2, sp1, sp2);
      map[date + '|' + t2 + '|' + t1] = _entry(s2, s1, sp2, sp1);
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
    var resp = await fetch(ESPN_STANDINGS);
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
// 返回 {teamName: {playerName: {yellows, reds, lastMatchDate, cardEvents: [{type, date}]}}}
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
        cards[cardTeam][playerKey] = { yellows: 0, reds: 0, lastMatchDate: matchDate, cardEvents: [] };
      }

      var type = d.redCard ? 'red' : 'yellow';
      if (d.redCard) {
        cards[cardTeam][playerKey].reds++;
      } else {
        cards[cardTeam][playerKey].yellows++;
      }
      cards[cardTeam][playerKey].cardEvents.push({ type: type, date: matchDate });
      cards[cardTeam][playerKey].lastMatchDate = matchDate;
    }
  }

  worldCupCards = cards;
  return cards;
}

// FIFA 2026 黄牌阶段划分（小组赛 / R32+R16+QF / SF+决赛），每阶段结束清零
// 返回 'gs' | 'ko_early' | 'ko_late' | 'unknown'
function getCardPhase(round) {
  if (!round) return 'unknown';
  if (/^Matchday/.test(round)) return 'gs';
  if (round === 'Round of 32' || round === 'Round of 16' || round === 'Quarter-final') return 'ko_early';
  if (round === 'Semi-final' || round === 'Match for third place' || round === 'Final') return 'ko_late';
  return 'unknown';
}

// 根据红黄牌数据 + 赛程计算停赛（FIFA 2026 阶段清零规则）
// - 小组赛（gs）阶段黄牌进 R32 时清零
// - R32+R16+QF（ko_early）阶段黄牌进 SF 时清零
// - SF+决赛（ko_late）阶段不再清零
// - 同阶段累计 2 黄 → 下一场停赛
// - 直接红牌 → 下一场停赛（只停1场，已被消化则不停）
// cards: processEspnCards() 的输出
// matches: worldCupData.matches（用于判断阶段和下一场）
// 返回 {teamName: {suspensions: N, suspendedPlayers: [...], note: "..."}}
function computeWorldCupSuspensions(cards, matches) {
  if (!cards) { worldCupSuspensions = {}; return {}; }
  if (!matches || !matches.length) { worldCupSuspensions = {}; return {}; }

  var now = new Date();

  // 构建 espnWinnerIndex：key = date|teamA|teamB → winnerTeam（双向）
  var espnWinnerIndex = {};
  if (espnRawEvents && espnRawEvents.length) {
    espnRawEvents.forEach(function(e) {
      var c = e.competitions && e.competitions[0];
      if (!c || !c.competitors || c.competitors.length < 2) return;
      var state = c.status && c.status.type && c.status.type.state;
      if (state !== 'post') return;
      var t1 = mapEspnName(c.competitors[0].team.displayName);
      var t2 = mapEspnName(c.competitors[1].team.displayName);
      var date = espnDateKey(e.date);
      var winner = null;
      if (c.competitors[0].winner) winner = t1;
      else if (c.competitors[1].winner) winner = t2;
      if (!winner) return;
      espnWinnerIndex[date + '|' + t1 + '|' + t2] = winner;
      espnWinnerIndex[date + '|' + t2 + '|' + t1] = winner;
    });
  }

  // 占位符解析映射 (W{num} → winner, L{num} → loser)
  var placeholderMap = {};

  // 多遍循环，处理嵌套占位符（如 SF W97 = QF match 99 胜者，而 match 99 本身是占位符）
  function resolveTeam(name) {
    if (!isPlaceholder(name)) return name;
    if (/^W\d+$/.test(name) || /^L\d+$/.test(name)) {
      return placeholderMap[name] || null;
    }
    return null;
  }

  function getWinnerForMatch(pm) {
    var rt1 = resolveTeam(pm.team1);
    var rt2 = resolveTeam(pm.team2);
    if (!rt1 || !rt2) return null;
    var pmKickoff = new Date(pm.date + 'T' + (pm.time || '00:00').split(' ')[0]);
    if (pmKickoff > now) return null;
    // 优先用比分
    if (pm.score1 != null && pm.score2 != null) {
      var s1 = parseInt(pm.score1), s2 = parseInt(pm.score2);
      if (!isNaN(s1) && !isNaN(s2)) {
        if (pm.score1p != null && pm.score2p != null) {
          s1 = parseInt(pm.score1p); s2 = parseInt(pm.score2p);
        }
        if (s1 > s2) return { winner: rt1, loser: rt2 };
        if (s2 > s1) return { winner: rt2, loser: rt1 };
      }
    }
    // 回退到 ESPN winner
    var utcD = typeof toUTCDate === 'function' ? toUTCDate(pm.date, pm.time) : pm.date;
    var w = espnWinnerIndex[pm.date + '|' + rt1 + '|' + rt2]
         || espnWinnerIndex[pm.date + '|' + rt2 + '|' + rt1]
         || espnWinnerIndex[utcD + '|' + rt1 + '|' + rt2]
         || espnWinnerIndex[utcD + '|' + rt2 + '|' + rt1];
    if (!w) return null;
    return { winner: w, loser: w === rt1 ? rt2 : rt1 };
  }

  // 循环直到无新变化（最多 5 遍，覆盖 SF+QF+R16+R32 占位符嵌套）
  for (var pass = 0; pass < 5; pass++) {
    var changed = false;
    for (var pi = 0; pi < matches.length; pi++) {
      var pm = matches[pi];
      var result = getWinnerForMatch(pm);
      if (!result) continue;
      var wKey = 'W' + pm.num, lKey = 'L' + pm.num;
      if (placeholderMap[wKey] !== result.winner) { placeholderMap[wKey] = result.winner; changed = true; }
      if (placeholderMap[lKey] !== result.loser) { placeholderMap[lKey] = result.loser; changed = true; }
    }
    if (!changed) break;
  }

  // 构建 (date|teamA|teamB) → {matchNum, round, phase} 索引，双向
  var matchIndex = {};
  for (var i = 0; i < matches.length; i++) {
    var m = matches[i];
    var phase = getCardPhase(m.round);
    var entry = { matchNum: m.num, round: m.round, phase: phase };
    matchIndex[m.date + '|' + m.team1 + '|' + m.team2] = entry;
    matchIndex[m.date + '|' + m.team2 + '|' + m.team1] = entry;
  }

  // 构建每支球队的赛程（解析占位符后）
  var teamSchedule = {};
  for (var k = 0; k < matches.length; k++) {
    var mm = matches[k];
    var rt1 = resolveTeam(mm.team1);
    var rt2 = resolveTeam(mm.team2);
    if (!rt1 || !rt2) continue;
    var kickoff = new Date(mm.date + 'T' + (mm.time || '00:00').split(' ')[0]);
    var isFuture = kickoff > now;
    [rt1, rt2].forEach(function(t, idx) {
      if (!teamSchedule[t]) teamSchedule[t] = [];
      teamSchedule[t].push({
        matchNum: mm.num,
        date: mm.date,
        round: mm.round,
        phase: getCardPhase(mm.round),
        opponent: idx === 0 ? rt2 : rt1,
        isFuture: isFuture
      });
    });
  }
  Object.keys(teamSchedule).forEach(function(t) {
    teamSchedule[t].sort(function(a, b) {
      return a.date.localeCompare(b.date) || (a.matchNum - b.matchNum);
    });
  });

  var suspensions = {};
  var teamNames = Object.keys(cards);

  for (var t = 0; t < teamNames.length; t++) {
    var teamName = teamNames[t];
    var players = cards[teamName];
    var schedule = teamSchedule[teamName] || [];
    var suspendedPlayers = [];

    // 球队下一场未赛比赛
    var nextMatch = null;
    for (var ns = 0; ns < schedule.length; ns++) {
      if (schedule[ns].isFuture) { nextMatch = schedule[ns]; break; }
    }
    if (!nextMatch) {
      suspensions[teamName] = { suspensions: 0, suspendedPlayers: [], note: '' };
      continue;
    }

    var playerNames = Object.keys(players);
    for (var p = 0; p < playerNames.length; p++) {
      var playerName = playerNames[p];
      var data = players[playerName];
      var events = data.cardEvents || [];

      // 给每张牌关联 matchNum/round/phase（通过日期+队名反查）
      // 注意：cardEvents.date 来自 ESPN（UTC 日期），schedule.date 是 worldcup.json 当地日期，需双向匹配
      var enriched = events.map(function(ev) {
        var teamSched = schedule.filter(function(s) {
          if (s.date === ev.date) return true;
          // 跨日兼容：UTC 转换后可能差1天
          var utcD = typeof toUTCDate === 'function' ? toUTCDate(s.date, sTimeByNum(s.matchNum)) : null;
          return utcD === ev.date;
        });
        function sTimeByNum(num) {
          for (var i = 0; i < matches.length; i++) {
            if (matches[i].num === num) return matches[i].time;
          }
          return '00:00';
        }
        var round = teamSched.length >= 1 ? teamSched[0].round : null;
        var phase = teamSched.length >= 1 ? teamSched[0].phase : getCardPhase(round);
        var matchNum = teamSched.length >= 1 ? teamSched[0].matchNum : 0;
        return { type: ev.type, date: ev.date, matchNum: matchNum, round: round, phase: phase };
      }).sort(function(a, b) { return a.date.localeCompare(b.date); });

      // 找球员最近一场已赛比赛（按 cardEvents 的日期 + 球队赛程）
      var lastPlayedMatchNum = 0;
      var lastPlayedPhase = 'unknown';
      for (var s = schedule.length - 1; s >= 0; s--) {
        if (!schedule[s].isFuture) {
          lastPlayedMatchNum = schedule[s].matchNum;
          lastPlayedPhase = schedule[s].phase;
          break;
        }
      }

      // 规则1：最近一场已赛比赛拿了红牌 → 下一场停赛
      var redInLastMatch = false;
      if (lastPlayedMatchNum > 0) {
        for (var e1 = 0; e1 < enriched.length; e1++) {
          if (enriched[e1].type === 'red' && enriched[e1].matchNum === lastPlayedMatchNum) {
            redInLastMatch = true;
            break;
          }
        }
      }

      // 规则2：当前阶段（最近一场的 phase）累计 ≥2 黄 → 下一场停赛
      var yellowsInPhase = 0;
      if (lastPlayedPhase !== 'unknown') {
        for (var e2 = 0; e2 < enriched.length; e2++) {
          if (enriched[e2].type === 'yellow' && enriched[e2].phase === lastPlayedPhase) {
            yellowsInPhase++;
          }
        }
      }

      var isSuspended = false;
      var reason = '';
      if (redInLastMatch) {
        isSuspended = true;
        reason = '红牌';
      } else if (yellowsInPhase >= 2) {
        isSuspended = true;
        reason = '本阶段累计' + yellowsInPhase + '黄';
      }

      if (isSuspended) {
        suspendedPlayers.push({
          name: playerName,
          reason: reason,
          yellows: data.yellows,
          reds: data.reds,
          yellowsInPhase: yellowsInPhase
        });
      }
    }

    var note = '';
    if (suspendedPlayers.length > 0) {
      note = suspendedPlayers.map(function(sp) {
        return trPlayer(sp.name) + '(' + sp.reason + ')';
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
    // 同步缓存 H2H 数据到 analysisData，供 computeMatchScore 使用
    if (summary.h2h && typeof analysisData !== 'undefined') {
      analysisData.h2h = analysisData.h2h || {};
      var key = h2hCacheKey(summary.h2h.teamA, summary.h2h.teamB);
      if (key) analysisData.h2h[key] = summary.h2h;
    }
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
    gameInfo: data.gameInfo || {},
    h2h: extractH2H(data.headToHeadGames)
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
          shortName: (p.athlete || {}).displayName || (p.athlete || {}).shortName || '',
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

// 提取两队历史交锋数据 (H2H) — 来自 ESPN summary 的 headToHeadGames 字段
// 返回 { teams: [name1, name2], games: [{date, competition, score, result}] }
// result 是从 teams[0] 视角的 W/D/L
function extractH2H(h2hRaw) {
  if (!h2hRaw || !h2hRaw.length) return null;

  var teamA = (h2hRaw[0].team || {}).displayName || '';
  var teamAName = mapEspnName(teamA);

  // teamB 优先从 h2hRaw[1] 取;ESPN 对未开赛比赛常只返回 1 个 entry,此时从首个 event 的 opponent 字段补
  var teamBName = '';
  if (h2hRaw[1] && h2hRaw[1].team && h2hRaw[1].team.displayName) {
    teamBName = mapEspnName(h2hRaw[1].team.displayName);
  } else if (h2hRaw[0].events && h2hRaw[0].events[0] && h2hRaw[0].events[0].opponent) {
    teamBName = mapEspnName(h2hRaw[0].events[0].opponent.displayName || '');
  }

  var games = [];
  // 用第一支队伍的 events 列表（两队 events 是同一场比赛的两个视角）
  var evList = h2hRaw[0].events || [];
  for (var i = 0; i < evList.length; i++) {
    var ev = evList[i];
    games.push({
      date: ev.gameDate ? ev.gameDate.slice(0, 10) : '',
      competition: ev.competitionName || ev.leagueName || '',
      round: ev.roundName || '',
      score: ev.score || '',
      result: ev.gameResult || '',  // W/D/L from teamA perspective
      note: ev.matchNote || ''
    });
  }

  return {
    teams: [teamAName, teamBName],
    teamA: teamAName,
    teamB: teamBName,
    games: games
  };
}

// 生成 H2H 缓存的规范键名（按字母排序，让 A vs B 和 B vs A 命中同一键）
function h2hCacheKey(teamA, teamB) {
  if (!teamA || !teamB) return '';
  return [teamA, teamB].sort().join('|');
}
