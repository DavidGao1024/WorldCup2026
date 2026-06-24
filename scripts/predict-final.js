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
  var gap = result.gap;
  var totalGoals = 2.5;

  // Context adjustments to expected goals
  var tAdj = 1.0, oAdj = 1.0;
  var drawBonus = 0; // Extra draw probability boost

  // Team rotation penalty (-30% effectiveness)
  if (ctx.team1Rotate) tAdj *= 0.70;
  if (ctx.team2Rotate) oAdj *= 0.70;

  // Must-win desperation (+15% attack, -10% defense)
  if (ctx.team1Desperate) { tAdj *= 1.15; }
  if (ctx.team2Desperate) { oAdj *= 1.15; }

  // Playing conservatively (only need draw) (-15% attack, +10% defense)
  if (ctx.team1Conservative) { tAdj *= 0.85; }
  if (ctx.team2Conservative) { oAdj *= 0.85; }

  // Draw incentive / collusion risk
  if (ctx.drawIncentive) drawBonus += 0.08;

  // Total goals adjustment
  if (ctx.totalGoals) totalGoals = ctx.totalGoals;
  if (ctx.team1Desperate && ctx.team2Desperate) totalGoals += 0.4; // Both desperate = more open

  var rawRatio = tScore / (tScore + oScore);
  var tRatio = 0.25 + (rawRatio - 0.25) * 0.6;
  tRatio = Math.max(0.25, Math.min(0.75, tRatio));

  var tAtt = result.scores.attack / 10;
  var tDef = result.scores.defense / 10;

  var tExp = totalGoals * tRatio * (0.7 + tAtt * 0.6) * tAdj;
  var oExp = totalGoals * (1 - tRatio) * (0.7 + (1 - tDef) * 0.6) * oAdj;

  var rankDiff = (result.oppRank.rank || 60) - (result.teamRank.rank || 60);
  tExp += rankDiff * 0.005;
  oExp -= rankDiff * 0.005;

  tExp = Math.max(0.2, Math.min(3.5, tExp));
  oExp = Math.max(0.2, Math.min(3.5, oExp));

  function poisson(k, lam) {
    if (k < 0 || lam <= 0) return 0;
    var v = Math.exp(-lam);
    for (var i = 1; i <= k; i++) v *= lam / i;
    return v;
  }

  var absGap = Math.abs(gap);
  var drawBoost = 1 + Math.max(0, (1 - absGap / 60)) * 2.5;
  drawBoost += drawBonus * 10; // Convert draw incentive to boost factor

  var scores = [];
  var winTotal = 0, drawTotal = 0, lossTotal = 0;

  for (var i = 0; i <= 6; i++) {
    for (var j = 0; j <= 6; j++) {
      if (i === j && i > 4) continue;
      var prob = poisson(i, tExp) * poisson(j, oExp);
      if (i === j) prob *= drawBoost;
      scores.push({ home: i, away: j, prob: prob });

      if (i > j) winTotal += prob;
      else if (i < j) lossTotal += prob;
      else drawTotal += prob;
    }
  }

  var totalProb = winTotal + drawTotal + lossTotal;
  winTotal /= totalProb;
  drawTotal /= totalProb;
  lossTotal /= totalProb;

  var scoreTotal = 0;
  for (var si = 0; si < scores.length; si++) scoreTotal += scores[si].prob;
  for (var si = 0; si < scores.length; si++) scores[si].prob /= scoreTotal;

  scores.sort(function(a, b) { return b.prob - a.prob; });

  var favorite = tScore >= oScore ? 'team1' : 'team2';
  var underdogWins = favorite === 'team1' ? lossTotal : winTotal;
  var upsetProb = underdogWins + drawTotal;

  return {
    top1: scores[0] ? (scores[0].home + '-' + scores[0].away) : '1-0',
    top1Pct: scores[0] ? Math.round(scores[0].prob * 100) : 0,
    top2: scores[1] ? (scores[1].home + '-' + scores[1].away) : '2-0',
    top2Pct: scores[1] ? Math.round(scores[1].prob * 100) : 0,
    top3: scores[2] ? (scores[2].home + '-' + scores[2].away) : '3-0',
    top3Pct: scores[2] ? Math.round(scores[2].prob * 100) : 0,
    winProb: winTotal,
    drawProb: drawTotal,
    lossProb: lossTotal,
    upsetProb: upsetProb,
    tExp: tExp.toFixed(2),
    oExp: oExp.toFixed(2)
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
