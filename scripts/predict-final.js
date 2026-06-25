var fs = require('fs');
var vm = require('vm');

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

// Extended predictScores with context adjustments
function predictScoresFull(result, context) {
  var ctx = context || {};
  var tScore = result.teamTotal;
  var oScore = result.oppTotal;
  var totalGoals = 2.5;

  // Context adjustments to expected goals
  var tAdj = 1.0, oAdj = 1.0;
  var drawBonus = 0;

  // Team rotation penalty (-30% effectiveness)
  if (ctx.team1Rotate) tAdj *= 0.70;
  if (ctx.team2Rotate) oAdj *= 0.70;

  // Must-win desperation (+15% attack)
  if (ctx.team1Desperate) { tAdj *= 1.15; }
  if (ctx.team2Desperate) { oAdj *= 1.15; }

  // Playing conservatively (only need draw) (-15%)
  if (ctx.team1Conservative) { tAdj *= 0.85; }
  if (ctx.team2Conservative) { oAdj *= 0.85; }

  // Draw incentive / collusion risk
  if (ctx.drawIncentive) drawBonus += 0.08;

  // Total goals adjustment
  if (ctx.totalGoals) totalGoals = ctx.totalGoals;
  if (ctx.team1Desperate && ctx.team2Desperate) totalGoals += 0.4;

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

  var tExp = tBase * tAttFactor * tAdj;
  var oExp = oBase * (2 - tDefFactor) * oAdj;

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

  tExp = Math.max(0.2, Math.min(3.5, tExp));
  oExp = Math.max(0.2, Math.min(3.5, oExp));

  function poisson(k, lam) {
    if (k < 0 || lam <= 0) return 0;
    var v = Math.exp(-lam);
    for (var i = 1; i <= k; i++) v *= lam / i;
    return v;
  }

  // 平局修正：基于xG差距
  var xgGap = Math.abs(tExp - oExp);
  var drawBoost = 1.0 + Math.max(0, 1 - xgGap / 2.5) * 2.5;
  drawBoost += drawBonus * 10;
  drawBoost = Math.max(1.0, Math.min(4.5, drawBoost));

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
  var favorite = tScore >= oScore ? 'team1' : 'team2';
  var underdogWins = favorite === 'team1' ? res.lossTotal : res.winTotal;
  var upsetProb = underdogWins + res.drawTotal;

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

// The 6 matches for June 24 with context adjustments
var matches = [
  {
    team1: 'Czech Republic', team2: 'Mexico', ground: 'Mexico City',
    context: {
      team2Rotate: true,           // Mexico heavily rotating
      team1Desperate: true,        // Czech must win
      totalGoals: 2.8              // Open game expected
    },
    note: '墨西哥锁第1大幅轮换，捷克必须赢'
  },
  {
    team1: 'South Africa', team2: 'South Korea', ground: 'Monterrey',
    context: {
      team1Desperate: false,       // SA nearly out
      totalGoals: 2.2              // Low scoring expected
    },
    note: '韩国不输即出线，南非基本出局'
  },
  {
    team1: 'Switzerland', team2: 'Canada', ground: 'Vancouver',
    context: {
      drawIncentive: true,         // Draw suits both
      totalGoals: 2.0              // Cautious match
    },
    note: '平局双双出线，加拿大主场'
  },
  {
    team1: 'Bosnia & Herzegovina', team2: 'Qatar', ground: 'Seattle',
    context: {
      team1Desperate: true,        // Both need miracle
      team2Desperate: true,
      totalGoals: 2.6
    },
    note: '双方理论上都有机会，但GD翻盘几乎不可能'
  },
  {
    team1: 'Scotland', team2: 'Brazil', ground: 'Miami',
    context: {
      team1Desperate: true,        // Must win
      totalGoals: 2.4              // Brazil likely conservative
    },
    note: '苏格兰必须赢！巴西不输即出线，但输球可能出局'
  },
  {
    team1: 'Morocco', team2: 'Haiti', ground: 'Atlanta',
    context: {
      totalGoals: 2.8              // Morocco should dominate
    },
    note: '摩洛哥赢球即出线，海地已淘汰'
  }
];

console.log('# 赛前预测 — 6月25日（小组末轮 A/B/C 组）');
console.log('');
console.log('> 模型: v3 + 小组形势修正（轮换惩罚/求生加成/默契平局加成）');
console.log('');

var upsetList = [];

for (var mi = 0; mi < matches.length; mi++) {
  var m = matches[mi];
  var result = computeMatchScore(m.team1, m.team2, m.ground);
  var pred = predictScoresFull(result, m.context);

  var tName = typeof trTeam === 'function' ? trTeam(m.team1) : m.team1;
  var oName = typeof trTeam === 'function' ? trTeam(m.team2) : m.team2;

  var absG = Math.abs(result.gap);
  var gapLabel = absG >= 70 ? '悬殊' : (absG >= 40 ? '明显差距' : (absG >= 15 ? '有一定差距' : '势均力敌'));

  var ctxTags = [];
  if (m.context.team1Rotate) ctxTags.push(tName + '轮换');
  if (m.context.team2Rotate) ctxTags.push(oName + '轮换');
  if (m.context.team1Desperate) ctxTags.push(tName + '生死战');
  if (m.context.team2Desperate) ctxTags.push(oName + '生死战');
  if (m.context.drawIncentive) ctxTags.push('平局默契风险');

  console.log('---');
  console.log('');
  console.log('## ' + (mi+1) + '. ' + tName + ' vs ' + oName + ' — ' + (m.ground || ''));
  console.log('');
  console.log('> ' + m.note + (ctxTags.length > 0 ? ' | 修正: ' + ctxTags.join(' / ') : ''));
  console.log('');
  console.log('| 项目 | ' + tName + ' | ' + oName + ' |');
  console.log('|------|------|------|');
  console.log('| 原始分析得分 | ' + result.teamTotal + ' | ' + result.oppTotal + ' |');
  console.log('| 实力差距 | ' + (result.gap > 0 ? '+' + result.gap : result.gap) + ' (' + gapLabel + ') | |');
  console.log('| 预期进球(xG) | ' + pred.tExp + ' | ' + pred.oExp + ' |');
  console.log('');
  console.log('**预测比分**: ' + pred.top1 + ' (' + pred.top1Pct + '%) · ' + pred.top2 + ' (' + pred.top2Pct + '%) · ' + pred.top3 + ' (' + pred.top3Pct + '%)');
  console.log('');
  var wP = Math.round(pred.winProb * 100);
  var dP = Math.round(pred.drawProb * 100);
  var lP = Math.round(pred.lossProb * 100);
  console.log('**胜平负**: 主胜 ' + wP + '% / 平 ' + dP + '% / 客胜 ' + lP + '%');
  console.log('');

  var up = Math.round(pred.upsetProb * 100);
  var ul = up >= 50 ? '🔴 极高' : (up >= 35 ? '🟡 较高' : (up >= 20 ? '🟢 一般' : '⚪ 很低'));
  console.log('**爆冷可能**: ' + up + '% ' + ul);
  console.log('');

  upsetList.push({ name: tName + ' vs ' + oName, upset: pred.upsetProb, note: m.note });
}

console.log('---');
console.log('');
console.log('## 爆冷风险排行');
console.log('');
upsetList.sort(function(a, b) { return b.upset - a.upset; });
for (var ui = 0; ui < upsetList.length; ui++) {
  var u = upsetList[ui];
  var up = Math.round(u.upset * 100);
  var tag = up >= 50 ? '🔴' : (up >= 35 ? '🟡' : (up >= 20 ? '🟢' : '⚪'));
  console.log((ui+1) + '. ' + tag + ' ' + u.name + ' — ' + up + '% | ' + u.note);
}
