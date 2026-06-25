var fs = require('fs');
var vm = require('vm');
var https = require('https');

global.localStorage = { _data:{}, getItem:function(k){return this._data[k]||null}, setItem:function(k,v){this._data[k]=v} };
global.window = global;
global.document = { querySelector: function(){return null}, createElement: function(){return {}} };

function loadIntoGlobal(path) { vm.runInThisContext(fs.readFileSync(path, 'utf8'), path); }
loadIntoGlobal('js/i18n.js');
loadIntoGlobal('js/espn.js');
loadIntoGlobal('js/data.js');
loadIntoGlobal('js/analysis.js');

worldCupData = JSON.parse(fs.readFileSync('data/worldcup.json','utf8'));
analysisData.rankings = JSON.parse(fs.readFileSync('data/fifa-rankings.json','utf8'));
analysisData.forms = JSON.parse(fs.readFileSync('data/team-form.json','utf8'));
analysisData.stadiums = JSON.parse(fs.readFileSync('data/stadiums.json','utf8'));
analysisData.injuries = JSON.parse(fs.readFileSync('data/injuries.json','utf8'));

var ESPN_REVERSE = {};
for (var k in ESPN_TEAM_MAP) { ESPN_REVERSE[ESPN_TEAM_MAP[k]] = k; }

function predictScoresFull(result) {
  var tScore = result.teamTotal;
  var oScore = result.oppTotal;
  var totalGoals = 2.5;

  // 压缩比率：以0.5为锚点，确保方向与8维度总分一致
  var rawRatio = tScore / (tScore + oScore);
  var tRatio = 0.5 + (rawRatio - 0.5) * 0.5;
  tRatio = Math.max(0.25, Math.min(0.75, tRatio));

  var tBase = totalGoals * tRatio;
  var oBase = totalGoals * (1 - tRatio);

  // attack/defense 微调（以5分为中性点，±20%）
  var tAttFactor = 1.0 + (result.scores.attack - 5) / 5 * 0.20;
  var tDefFactor = 1.0 + (result.scores.defense - 5) / 5 * 0.20;
  tAttFactor = Math.max(0.80, Math.min(1.20, tAttFactor));
  tDefFactor = Math.max(0.80, Math.min(1.20, tDefFactor));

  var tExp = tBase * tAttFactor;
  var oExp = oBase * (2 - tDefFactor);

  // 排名修正（限幅 ±0.15 xG）
  var rankDiff = (result.oppRank.rank || 60) - (result.teamRank.rank || 60);
  var rankCorrection = Math.max(-0.15, Math.min(0.15, rankDiff * 0.005));
  tExp += rankCorrection;
  oExp -= rankCorrection;

  // 方向安全保障：xG方向必须与8维度总分一致
  if (tScore > oScore && tExp <= oExp) {
    var avg = (tExp + oExp) / 2;
    var minSpread = Math.abs(avg * 0.05);
    tExp = avg + minSpread;
    oExp = avg - minSpread;
  } else if (tScore < oScore && tExp >= oExp) {
    var avg = (tExp + oExp) / 2;
    var minSpread = Math.abs(avg * 0.05);
    tExp = avg - minSpread;
    oExp = avg + minSpread;
  }

  tExp = Math.max(0.3, Math.min(3.0, tExp));
  oExp = Math.max(0.3, Math.min(3.0, oExp));

  function poisson(k, lam) {
    if (k < 0 || lam <= 0) return 0;
    var v = Math.exp(-lam);
    for (var i = 1; i <= k; i++) v *= lam / i;
    return v;
  }

  // 平局修正：基于xG差距
  var xgGap = Math.abs(tExp - oExp);
  var drawBoost = 1.0 + Math.max(0, 1 - xgGap / 2.5) * 2.5;
  drawBoost = Math.max(1.0, Math.min(3.5, drawBoost));

  function runPoisson(tE, oE, dB) {
    var sc = [];
    var wT = 0, dT = 0, lT = 0;
    for (var i = 0; i <= 6; i++) {
      for (var j = 0; j <= 6; j++) {
        if (i === j && i > 4) continue;
        var prob = poisson(i, tE) * poisson(j, oE);
        if (i === j) prob *= dB;
        sc.push({ home: i, away: j, prob: prob });
        if (i > j) wT += prob;
        else if (i < j) lT += prob;
        else dT += prob;
      }
    }
    var tp = wT + dT + lT;
    wT /= tp; dT /= tp; lT /= tp;
    var st = 0;
    for (var si = 0; si < sc.length; si++) st += sc[si].prob;
    for (var si = 0; si < sc.length; si++) sc[si].prob /= st;
    sc.sort(function(a, b) { return b.prob - a.prob; });
    return { scores: sc, winTotal: wT, drawTotal: dT, lossTotal: lT };
  }

  var poissonResult = runPoisson(tExp, oExp, drawBoost);

  // 一致性自动校准：top-3比分类型应与胜平负主导方向一致
  var dominantOutcome = '';
  if (poissonResult.winTotal >= poissonResult.drawTotal && poissonResult.winTotal >= poissonResult.lossTotal) {
    dominantOutcome = 'win';
  } else if (poissonResult.drawTotal >= poissonResult.winTotal && poissonResult.drawTotal >= poissonResult.lossTotal) {
    dominantOutcome = 'draw';
  } else {
    dominantOutcome = 'loss';
  }

  var topWinCount = 0, topDrawCount = 0, topLossCount = 0;
  for (var si = 0; si < Math.min(3, poissonResult.scores.length); si++) {
    var s = poissonResult.scores[si];
    if (s.home > s.away) topWinCount++;
    else if (s.home < s.away) topLossCount++;
    else topDrawCount++;
  }

  var recalibrated = false;
  if ((dominantOutcome === 'win' && topWinCount === 0) ||
      (dominantOutcome === 'loss' && topLossCount === 0) ||
      (dominantOutcome === 'draw' && topDrawCount === 0)) {
    if (dominantOutcome === 'win') {
      tExp = Math.min(3.5, tExp * 1.08);
      oExp = Math.max(0.2, oExp * 0.92);
    } else if (dominantOutcome === 'loss') {
      tExp = Math.max(0.2, tExp * 0.92);
      oExp = Math.min(3.5, oExp * 1.08);
    } else {
      drawBoost = Math.min(4.5, drawBoost * 1.3);
    }
    poissonResult = runPoisson(tExp, oExp, drawBoost);
    recalibrated = true;
  }

  var res = poissonResult;
  var upsetProb = (tScore < oScore) ? (res.winTotal + res.drawTotal) : (res.lossTotal + res.drawTotal);

  return {
    top1: res.scores[0] ? (res.scores[0].home + '-' + res.scores[0].away) : '1-0',
    top1Pct: res.scores[0] ? Math.round(res.scores[0].prob * 100) : 0,
    top2: res.scores[1] ? (res.scores[1].home + '-' + res.scores[1].away) : '2-0',
    top2Pct: res.scores[1] ? Math.round(res.scores[1].prob * 100) : 0,
    top3: res.scores[2] ? (res.scores[2].home + '-' + res.scores[2].away) : '3-0',
    top3Pct: res.scores[2] ? Math.round(res.scores[2].prob * 100) : 0,
    winProb: res.winTotal,
    drawProb: res.drawTotal,
    lossProb: res.lossTotal,
    upsetProb: upsetProb,
    tExp: tExp.toFixed(2),
    oExp: oExp.toFixed(2),
    recalibrated: recalibrated
  };
}

https.get('https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260624-20260628&limit=80', function(res) {
  var body = '';
  res.on('data', function(c) { body += c; });
  res.on('end', function() {
    var espn = JSON.parse(body);
    var matches = [];

    espn.events.forEach(function(e) {
      if (e.status.type.completed || e.status.type.state === 'post') return;
      var c = e.competitions[0];
      var h = c.competitors.find(function(x) { return x.homeAway === 'home'; });
      var a = c.competitors.find(function(x) { return x.homeAway === 'away'; });

      var team1 = ESPN_TEAM_MAP[h.team.displayName] || h.team.displayName;
      var team2 = ESPN_TEAM_MAP[a.team.displayName] || a.team.displayName;
      var date = e.date;
      var d = new Date(date);
      var month = d.getMonth() + 1;
      var day = d.getDate();
      var dateStr = month + '月' + day + '日';
      var ground = '';

      if (worldCupData && worldCupData.matches) {
        for (var mi = 0; mi < worldCupData.matches.length; mi++) {
          var wm = worldCupData.matches[mi];
          if ((wm.team1 === team1 && wm.team2 === team2) ||
              (wm.team1 === team2 && wm.team2 === team1)) {
            if (wm.ground) ground = wm.ground;
            break;
          }
        }
      }

      // Skip placeholder teams
      if (typeof isPlaceholder === 'function' && (isPlaceholder(team1) || isPlaceholder(team2))) return;
      if (team1.indexOf('Group') >= 0 || team2.indexOf('Group') >= 0) return;
      if (team1.indexOf('Place') >= 0 || team2.indexOf('Place') >= 0) return;

      matches.push({ team1: team1, team2: team2, ground: ground, date: date, dateStr: dateStr });
    });

    // Sort by date
    matches.sort(function(a, b) { return a.date.localeCompare(b.date); });

    var lines = [];
    lines.push('# 世界杯赛前预测 — ' + new Date().toISOString().slice(0, 10));
    lines.push('');
    lines.push('> 模型: v3 — 8维度分析 + 泊松比分 | 对手归一化 + 比率压缩(0.25-0.75) + 平局加成(Dixon-Coles) + xG上限3.0');
    lines.push('> 预测场次: ' + matches.length + ' 场');
    lines.push('');

    var upsetList = [];

    for (var mi = 0; mi < matches.length; mi++) {
      var m = matches[mi];
      var result = computeMatchScore(m.team1, m.team2, m.ground);
      var pred = predictScoresFull(result);

      var tName = typeof trTeam === 'function' ? trTeam(m.team1) : m.team1;
      var oName = typeof trTeam === 'function' ? trTeam(m.team2) : m.team2;
      var gndName = typeof trVenue === 'function' ? trVenue(m.ground) : (m.ground || '待定');
      var dateStr = m.dateStr;
      var gapLabel = '';
      var absG = Math.abs(result.gap);
      if (absG >= 70) gapLabel = '悬殊';
      else if (absG >= 40) gapLabel = '明显差距';
      else if (absG >= 15) gapLabel = '有一定差距';
      else gapLabel = '势均力敌';

      lines.push('---');
      lines.push('');
      lines.push('## ' + (mi + 1) + '. ' + tName + ' vs ' + oName + ' — ' + dateStr + ' · ' + gndName);
      lines.push('');
      lines.push('| 项目 | ' + tName + ' | ' + oName + ' |');
      lines.push('|------|------|------|');
      lines.push('| 分析得分 | ' + result.teamTotal + ' | ' + result.oppTotal + ' |');
      lines.push('| 实力差距 | ' + (result.gap > 0 ? '+' + result.gap : result.gap) + ' (' + gapLabel + ') | |');
      lines.push('');
      lines.push('**预测比分**: ' + pred.top1 + ' (' + pred.top1Pct + '%) · ' + pred.top2 + ' (' + pred.top2Pct + '%) · ' + pred.top3 + ' (' + pred.top3Pct + '%)');
      lines.push('');
      var wProb = Math.round(pred.winProb * 100);
      var dProb = Math.round(pred.drawProb * 100);
      var lProb = Math.round(pred.lossProb * 100);
      lines.push('**胜平负**: 主胜 ' + wProb + '% / 平 ' + dProb + '% / 客胜 ' + lProb + '%');
      lines.push('');

      var upsetPct = Math.round(pred.upsetProb * 100);
      var upsetLabel = '';
      if (upsetPct >= 40) upsetLabel = '🔴 高风险';
      else if (upsetPct >= 25) upsetLabel = '🟡 中等风险';
      else upsetLabel = '🟢 低风险';
      lines.push('**爆冷可能**: ' + upsetPct + '% ' + upsetLabel);
      lines.push('');

      upsetList.push({ name: tName + ' vs ' + oName, upset: pred.upsetProb });
    }

    lines.push('---');
    lines.push('');
    lines.push('## 爆冷风险排行');
    lines.push('');

    upsetList.sort(function(a, b) { return b.upset - a.upset; });
    for (var ui = 0; ui < upsetList.length; ui++) {
      var u = upsetList[ui];
      var up = Math.round(u.upset * 100);
      var tag = up >= 40 ? '🔴' : (up >= 25 ? '🟡' : '🟢');
      lines.push((ui + 1) + '. ' + tag + ' ' + u.name + ' — ' + up + '%');
    }

    var out = lines.join('\n');
    var outPath = 'predictions/' + new Date().toISOString().slice(0, 10) + '-赛前预测.md';
    fs.writeFileSync(outPath, out, 'utf8');
    console.log(out);
    console.log('');
    console.log('已保存到: ' + outPath);
  });
});
