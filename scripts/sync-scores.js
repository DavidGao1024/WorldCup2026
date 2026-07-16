// scripts/sync-scores.js
// 从 ESPN scoreboard 拉取最新比分，合并写入 data/worldcup.json
// 逻辑镜像 js/espn.js 的 fetchEspnScores + js/data.js 的 mergeScoresIntoData

var https = require('https');
var fs = require('fs');
var path = require('path');

var DATA_FILE = path.join(__dirname, '..', 'data', 'worldcup.json');
var SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260611-20260719&limit=200';

var NAME_MAP = {
  'Bosnia-Herzegovina': 'Bosnia & Herzegovina',
  'Congo DR': 'DR Congo',
  'Czechia': 'Czech Republic',
  'Türkiye': 'Turkey',
  'United States': 'USA'
};
function mapName(n) { return NAME_MAP[n] || n; }

function fetch(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// 将 worldcup.json 的本地日期+时间转为 UTC 日期
function toUTCDate(dateStr, timeStr) {
  var m = (timeStr || '').match(/UTC([+-]\d+)/);
  if (!m) return dateStr;
  var offset = parseInt(m[1], 10);
  var parts = timeStr.split(' ')[0].split(':');
  var h = parseInt(parts[0], 10);
  var min = parseInt(parts[1], 10) || 0;
  var totalMin = h * 60 + min - offset * 60;
  var d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCMinutes(d.getUTCMinutes() + totalMin);
  return d.toISOString().slice(0, 10);
}

// 从 ESPN events 构建 scoreMap
// key = "team1|team2"（两队按字母序规范化），双向
// 同时保留 date 索引（队名相同时的 fallback）
function buildScoreMap(events) {
  var byTeams = {};
  var byDateTeams = {};
  events.forEach(function(e) {
    var c = e.competitions && e.competitions[0];
    if (!c || !c.competitors || c.competitors.length < 2) return;
    if (!c.status || !c.status.type) return;
    var state = c.status.type.state;
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
    if (c.competitors[0].winner) winner = mapName(c.competitors[0].team.displayName);
    else if (c.competitors[1].winner) winner = mapName(c.competitors[1].team.displayName);

    var date = (e.date || '').split('T')[0];
    var t1 = mapName(c.competitors[0].team.displayName);
    var t2 = mapName(c.competitors[1].team.displayName);

    function entry(sa, sb, spa, spb) {
      var o = { score1: parseInt(sa), score2: parseInt(sb), state: state, hadET: hadET, hadPen: hadPen, winner: winner, date: date };
      if (spa != null && spb != null) { o.score1p = parseInt(spa); o.score2p = parseInt(spb); }
      return o;
    }
    byDateTeams[date + '|' + t1 + '|' + t2] = entry(s1, s2, sp1, sp2);
    byDateTeams[date + '|' + t2 + '|' + t1] = entry(s2, s1, sp2, sp1);

    // 队名双向 key（不依赖日期）— ESPN 与 worldcup.json 可能相差一天
    var key = [t1, t2].sort().join('|');
    if (!byTeams[key]) {
      byTeams[key] = entry(s1, s2, sp1, sp2);
    }
  });
  return { byDateTeams: byDateTeams, byTeams: byTeams };
}

function isPlaceholder(name) {
  return name && (name[0] === 'W' || name[0] === 'L') ||
         (name && /^\d/.test(name) && /[A-Z]$/.test(name));
}

function merge(data, scoreMap) {
  var changed = false;
  var winnerByNum = {};
  var loserByNum = {};
  data.matches.forEach(function(m) {
    if (m.score1 == null) return;
    var t1placeholder = isPlaceholder(m.team1);
    var t2placeholder = isPlaceholder(m.team2);
    // 优先用 m.winner（ESPN 给的真实队名），占位符 team1/team2 不能直接用
    if (m.winner) {
      winnerByNum[m.num] = m.winner;
      // 推断 loser：如果另一边是占位符，用 ESPN 给的另一队（若 winner=team1 则 loser=team2 反之）
      // 但 ESPN 只给 winner，loser 需要从另一队推断
      var otherTeam = (m.winner === m.team1) ? m.team2 :
                      (m.winner === m.team2) ? m.team1 : null;
      // 如果另一队也是占位符，我们无法直接知道真实队名，跳过
      if (otherTeam && !isPlaceholder(otherTeam)) {
        loserByNum[m.num] = otherTeam;
      }
    } else if (m.score1 > m.score2) {
      if (!t1placeholder) winnerByNum[m.num] = m.team1;
      if (!t2placeholder) loserByNum[m.num] = m.team2;
    } else if (m.score2 > m.score1) {
      if (!t2placeholder) winnerByNum[m.num] = m.team2;
      if (!t1placeholder) loserByNum[m.num] = m.team1;
    }
  });
  function resolveRef(name) {
    if (name && (name[0] === 'W' || name[0] === 'L')) {
      var n = parseInt(name.substring(1));
      if (n && winnerByNum[n]) return winnerByNum[n];
      if (n && loserByNum[n]) return loserByNum[n];
    }
    return name;
  }
  data.matches.forEach(function(m) {
    var utcDate = toUTCDate(m.date, m.time);
    var candidates = [];
    function tryKey(k) {
      if (scoreMap.byDateTeams[k]) candidates.push(scoreMap.byDateTeams[k]);
    }
    function tryTeamKey(k) {
      if (scoreMap.byTeams[k]) candidates.push(scoreMap.byTeams[k]);
    }

    // 1) 优先用 UTC 日期 + 队名匹配（最严格）
    tryKey(utcDate + '|' + m.team1 + '|' + m.team2);
    tryKey(utcDate + '|' + m.team2 + '|' + m.team1);
    // ESPN date 字段常为 UTC 日期，与 worldcup.json 的本地日期可能差一天
    tryKey(m.date + '|' + m.team1 + '|' + m.team2);
    tryKey(m.date + '|' + m.team2 + '|' + m.team1);

    // 2) 占位符解析后再尝试
    var t1r = resolveRef(m.team1), t2r = resolveRef(m.team2);
    if (t1r !== m.team1 || t2r !== m.team2) {
      tryKey(utcDate + '|' + t1r + '|' + t2r);
      tryKey(utcDate + '|' + t2r + '|' + t1r);
      tryKey(m.date + '|' + t1r + '|' + t2r);
      tryKey(m.date + '|' + t2r + '|' + t1r);
    }

    // 3) 队名兜底（不依赖日期）
    tryTeamKey([m.team1, m.team2].sort().join('|'));
    if (t1r !== m.team1 || t2r !== m.team2) {
      tryTeamKey([t1r, t2r].sort().join('|'));
    }

    // 多候选时，挑一个之前没填过的（避免覆盖已填比分）
    var entry = candidates[0];
    if (entry) {
      if (m.score1 !== entry.score1 || m.score2 !== entry.score2) {
        m.score1 = entry.score1; m.score2 = entry.score2; changed = true;
      }
      if (m.status !== entry.state) { m.status = entry.state; changed = true; }
      if (entry.hadET && m.hadET !== true) { m.hadET = true; changed = true; }
      if (entry.hadPen && m.hadPen !== true) { m.hadPen = true; changed = true; }
      if (entry.winner && m.winner !== entry.winner) { m.winner = entry.winner; changed = true; }
      if (entry.score1p != null && m.score1p !== entry.score1p) {
        m.score1p = entry.score1p; m.score2p = entry.score2p; changed = true;
      }
      var isGroup = m.group && m.group.indexOf('Group ') === 0;
      if (isGroup && m.hadET) {
        m.hadET = false; m.hadPen = false; m.winner = null;
        m.score1p = m.score2p = null; changed = true;
      }
    }
  });
  return changed;
}

async function main() {
  console.log('Fetching ESPN scoreboard...');
  var data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  var espn = await fetch(SCOREBOARD_URL);
  var events = espn.events || [];
  console.log('ESPN events:', events.length);

  var scoreMap = buildScoreMap(events);
  console.log('Score entries (bidirectional):', Object.keys(scoreMap).length);

  var beforePost = data.matches.filter(function(m){return m.status==='post';}).length;
  var beforeIn = data.matches.filter(function(m){return m.status==='in';}).length;

  // 多次迭代到不动点：R16/QF/SF 占位符 (W{num}) 链式引用上一轮胜者，
  // 需要前一轮比分合并完毕后才能解析下一轮的 team1/team2
  var totalChanged = false;
  for (var pass = 1; pass <= 6; pass++) {
    var c = merge(data, scoreMap);
    if (c) totalChanged = true;
    var post = data.matches.filter(function(m){return m.status==='post';}).length;
    console.log('Pass ' + pass + ': post=' + post + (c ? ' (changed)' : ' (no change)'));
    if (!c) break;
  }

  var afterPost = data.matches.filter(function(m){return m.status==='post';}).length;
  var afterIn = data.matches.filter(function(m){return m.status==='in';}).length;

  console.log('Before: post=' + beforePost + ' in=' + beforeIn);
  console.log('After:  post=' + afterPost + ' in=' + afterIn);

  if (totalChanged) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
    console.log('WROBE: ' + DATA_FILE);
  } else {
    console.log('No changes — file not rewritten.');
  }

  // 打印最近赛果
  console.log('\nRecent results (post):');
  data.matches.filter(function(m){return m.status==='post';})
    .sort(function(a,b){return (a.date<b.date?-1:a.date>b.date?1:0);})
    .slice(-8)
    .forEach(function(m){
      console.log('  ' + m.date + ' ' + (m.team1+' '.repeat(20)).slice(0,20) + m.score1 + '-' + m.score2 + ' ' + m.team2 +
        (m.hadPen ? ' ('+m.score1p+'-'+m.score2p+' pen)' : '') +
        (m.hadET && !m.hadPen ? ' (AET)' : ''));
    });
}
main().catch(function(e){console.error('FAIL:', e); process.exit(1);});
