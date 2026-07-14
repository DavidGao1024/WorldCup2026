/**
 * 半决赛投注期望值分析
 * 结合模型预测 + 体彩赔率
 */

// 模型预测概率
var model = {
  sf1: { // 法国 vs 西班牙
    win: 0.40, draw: 0.45, lose: 0.16,
    scores: {
      '1:1': 0.21, '0:0': 0.11, '2:2': 0.10,
      '2:1': 0.10, '1:0': 0.08, '1:2': 0.05,
      '0:1': 0.05, '2:0': 0.05, '3:1': 0.04,
      '0:2': 0.03, '3:0': 0.03, '3:2': 0.03,
      '2:3': 0.02, '0:3': 0.01, '1:3': 0.01,
      '4:1': 0.01
    },
    xg: [1.83, 1.05]
  },
  sf2: { // 英格兰 vs 阿根廷
    win: 0.24, draw: 0.55, lose: 0.20,
    scores: {
      '1:1': 0.26, '0:0': 0.17, '2:2': 0.10,
      '1:0': 0.06, '0:1': 0.07, '2:1': 0.06,
      '1:2': 0.06, '2:0': 0.04, '0:2': 0.04,
      '3:1': 0.02, '1:3': 0.02, '3:0': 0.02,
      '0:3': 0.02, '3:2': 0.02, '2:3': 0.02
    },
    xg: [1.31, 1.19]
  }
};

// 聚合总进球概率
function calcTotalGoals(m) {
  var tg = {};
  Object.keys(m.scores).forEach(function(s) {
    var parts = s.split(':');
    var total = parseInt(parts[0]) + parseInt(parts[1]);
    var key = total >= 7 ? '7+' : String(total);
    tg[key] = (tg[key] || 0) + m.scores[s];
  });
  return tg;
}

// 半全场概率
function calcHalfFull(m) {
  var w = m.win, d = m.draw, l = m.lose;
  return {
    hh: w * 0.55, hd: w * 0.25, ha: w * 0.05,
    dh: d * 0.20, dd: d * 0.65, da: d * 0.15,
    ah: l * 0.05, ad: l * 0.25, aa: l * 0.55
  };
}

// 让球(-1)概率
function calcHandicap(m) {
  var hWin2Plus = 0, hWin1 = 0, drawOrAway = 0;
  Object.keys(m.scores).forEach(function(s) {
    var parts = s.split(':');
    var h = parseInt(parts[0]), a = parseInt(parts[1]);
    var diff = h - a;
    if (diff >= 2) hWin2Plus += m.scores[s];
    else if (diff === 1) hWin1 += m.scores[s];
    else drawOrAway += m.scores[s];
  });
  return { h: hWin2Plus, d: hWin1, a: drawOrAway };
}

function calcEV(prob, odds) {
  return prob * odds - 1;
}

var lotteryData = require('../data/lottery-odds.json');

console.log('============================================================');
console.log('    2026 世界杯半决赛 · 体彩投注综合分析');
console.log('    模型: 8维度+泊松 | 注额: 2元/注');
console.log('============================================================');
console.log();

var allBets = [];

lotteryData.matches.forEach(function(dm, idx) {
  var mk = idx === 0 ? 'sf1' : 'sf2';
  var m = model[mk];
  var label = dm.matchNumStr + ' ' + dm.homeTeam + ' vs ' + dm.awayTeam;

  console.log('--- ' + label + ' ---');
  console.log('模型: 胜' + (m.win*100).toFixed(0) + '% / 平' + (m.draw*100).toFixed(0) + '% / 负' + (m.lose*100).toFixed(0) + '%');
  console.log();

  // HAD
  var had = dm.pools.HAD;
  var hadProbs = [m.win, m.draw, m.lose];
  var hadLabels = ['主胜', '平局', '客胜'];
  var hadOdds = [had.h, had.d, had.a];
  console.log('[胜平负 HAD]');
  for (var i = 0; i < 3; i++) {
    var ev = calcEV(hadProbs[i], hadOdds[i]);
    var marker = ev > 0 ? ' <<< VALUE' : '';
    console.log('  ' + hadLabels[i] + ': 概率' + (hadProbs[i]*100).toFixed(1) + '% x 赔率' + hadOdds[i] + ' = EV ' + (ev >= 0 ? '+' : '') + (ev*100).toFixed(1) + '%' + marker);
    allBets.push({match: mk, matchLabel: dm.homeTeam+'v'+dm.awayTeam, pool: 'HAD', option: hadLabels[i], prob: hadProbs[i], odds: hadOdds[i], ev: ev});
  }
  console.log();

  // HHAD
  var hhad = dm.pools.HHAD;
  var hp = calcHandicap(m);
  var hhadLabels = ['主胜(净胜2+)', '平(净胜1)', '客胜(平or负)'];
  var hhadOdds = [hhad.h, hhad.d, hhad.a];
  var hhadProbs = [hp.h, hp.d, hp.a];
  console.log('[让球 HHAD] 让' + hhad.goalLine + '球');
  for (var i = 0; i < 3; i++) {
    var ev = calcEV(hhadProbs[i], hhadOdds[i]);
    var marker = ev > 0 ? ' <<< VALUE' : '';
    console.log('  ' + hhadLabels[i] + ': 概率' + (hhadProbs[i]*100).toFixed(1) + '% x 赔率' + hhadOdds[i] + ' = EV ' + (ev >= 0 ? '+' : '') + (ev*100).toFixed(1) + '%' + marker);
    allBets.push({match: mk, matchLabel: dm.homeTeam+'v'+dm.awayTeam, pool: 'HHAD', option: hhadLabels[i], prob: hhadProbs[i], odds: hhadOdds[i], ev: ev});
  }
  console.log();

  // TTG
  var ttg = dm.pools.TTG;
  var tg = calcTotalGoals(m);
  console.log('[总进球 TTG]');
  for (var g = 0; g <= 7; g++) {
    var key = g < 7 ? String(g) : '7+';
    var prob = tg[key] || 0;
    var odds = ttg['s' + g];
    var ev = calcEV(prob, odds);
    var marker = ev > 0 ? ' <<< VALUE' : '';
    var lbl = (g < 7 ? g + '球' : '7+球');
    console.log('  ' + lbl + ': 概率' + (prob*100).toFixed(1) + '% x 赔率' + odds + ' = EV ' + (ev >= 0 ? '+' : '') + (ev*100).toFixed(1) + '%' + marker);
    allBets.push({match: mk, matchLabel: dm.homeTeam+'v'+dm.awayTeam, pool: 'TTG', option: lbl, prob: prob, odds: odds, ev: ev});
  }
  console.log();

  // HAFU
  var hafu = dm.pools.HAFU;
  var hf = calcHalfFull(m);
  var hfLabels = {hh:'胜胜',hd:'胜平',ha:'胜负',dh:'平胜',dd:'平平',da:'平负',ah:'负胜',ad:'负平',aa:'负负'};
  console.log('[半全场 HAFU]');
  var hfBest = [];
  Object.keys(hfLabels).forEach(function(k) {
    var prob = hf[k];
    var odds = hafu[k];
    var ev = calcEV(prob, odds);
    hfBest.push({k: k, label: hfLabels[k], prob: prob, odds: odds, ev: ev});
  });
  hfBest.sort(function(a,b) { return b.ev - a.ev; });
  hfBest.forEach(function(item) {
    var marker = item.ev > 0 ? ' <<< VALUE' : '';
    console.log('  ' + item.label + ': 概率' + (item.prob*100).toFixed(1) + '% x 赔率' + item.odds + ' = EV ' + (item.ev >= 0 ? '+' : '') + (item.ev*100).toFixed(1) + '%' + marker);
    allBets.push({match: mk, matchLabel: dm.homeTeam+'v'+dm.awayTeam, pool: 'HAFU', option: item.label, prob: item.prob, odds: item.odds, ev: item.ev});
  });
  console.log();

  // CRS
  var crs = dm.pools.CRS;
  console.log('[比分 CRS] TOP10 EV:');
  var crsBets = [];
  Object.keys(crs).forEach(function(k) {
    if (k === 's1sa' || k === 's1sd' || k === 's1sh') return;
    if (!k.match(/^s\d{2}s\d{2}$/)) return;
    var h = parseInt(k.substring(1,3));
    var a = parseInt(k.substring(4,6));
    var score = h + ':' + a;
    var prob = m.scores[score] || 0;
    if (prob < 0.005) return;
    var odds = crs[k];
    var ev = calcEV(prob, odds);
    crsBets.push({score: score, prob: prob, odds: odds, ev: ev});
  });
  crsBets.sort(function(a,b) { return b.ev - a.ev; });
  crsBets.slice(0, 10).forEach(function(item) {
    var marker = item.ev > 0 ? ' <<< VALUE' : '';
    console.log('  ' + item.score + ': 概率' + (item.prob*100).toFixed(1) + '% x 赔率' + item.odds + ' = EV ' + (item.ev >= 0 ? '+' : '') + (item.ev*100).toFixed(1) + '%' + marker);
    allBets.push({match: mk, matchLabel: dm.homeTeam+'v'+dm.awayTeam, pool: 'CRS', option: item.score, prob: item.prob, odds: item.odds, ev: item.ev});
  });
  console.log();
});

// ==============================
// 全部选项 EV 排名
// ==============================
console.log('============================================================');
console.log('    全部选项 EV 排名 TOP 20');
console.log('============================================================');
allBets.sort(function(a,b) { return b.ev - a.ev; });
allBets.slice(0, 20).forEach(function(bet, i) {
  var marker = bet.ev > 0 ? 'V' : ' ';
  console.log((i+1 < 10 ? ' ' : '') + (i+1) + '. [' + marker + '] ' + bet.matchLabel + ' ' + bet.pool + ' ' + bet.option + ': 概率' + (bet.prob*100).toFixed(1) + '% 赔率' + bet.odds + ' EV=' + (bet.ev >= 0 ? '+' : '') + (bet.ev*100).toFixed(1) + '%');
});

// ==============================
// 2串1 分析
// ==============================
console.log();
console.log('============================================================');
console.log('    2串1 推荐 (两场各选一个)');
console.log('============================================================');

// 取EV > -0.10的选项做串关
var goodBets = allBets.filter(function(b) { return b.ev > -0.10; });
var sf1Bets = goodBets.filter(function(b) { return b.match === 'sf1'; });
var sf2Bets = goodBets.filter(function(b) { return b.match === 'sf2'; });

var parlays = [];
for (var i = 0; i < sf1Bets.length; i++) {
  for (var j = 0; j < sf2Bets.length; j++) {
    var a = sf1Bets[i], b = sf2Bets[j];
    var combinedOdds = a.odds * b.odds;
    var combinedProb = a.prob * b.prob;
    var combinedEV = combinedProb * combinedOdds - 1;
    parlays.push({
      a: a, b: b,
      combinedOdds: combinedOdds,
      combinedProb: combinedProb,
      combinedEV: combinedEV,
      payout: combinedOdds * 2
    });
  }
}
parlays.sort(function(a,b) { return b.combinedEV - a.combinedEV; });

console.log('TOP 20 串关:');
parlays.slice(0, 20).forEach(function(p, i) {
  var marker = p.combinedEV > 0 ? 'V' : ' ';
  console.log((i+1 < 10 ? ' ' : '') + (i+1) + '. [' + marker + '] [' + p.a.pool + ']' + p.a.option + ' x [' + p.b.pool + ']' + p.b.option);
  console.log('    赔率: ' + p.a.odds + 'x' + p.b.odds + '=' + p.combinedOdds.toFixed(2) + ' | 概率: ' + (p.combinedProb*100).toFixed(1) + '% | EV: ' + (p.combinedEV >= 0 ? '+' : '') + (p.combinedEV*100).toFixed(1) + '% | 奖金: ' + p.payout.toFixed(0) + '元');
});

// ==============================
// 低风险高收益推荐
// ==============================
console.log();
console.log('============================================================');
console.log('    综合推荐方案');
console.log('============================================================');

// 策略1: 纯低风险 - 选最高概率且正EV的
console.log();
console.log('[策略A] 最稳方案 - 正EV单关');
var positiveEV = allBets.filter(function(b) { return b.ev > 0; });
positiveEV.sort(function(a,b) { return b.prob - a.prob; }); // 按概率排序
positiveEV.slice(0, 5).forEach(function(bet, i) {
  console.log('  ' + (i+1) + '. ' + bet.matchLabel + ' ' + bet.pool + ' ' + bet.option);
  console.log('     概率: ' + (bet.prob*100).toFixed(1) + '% | 赔率: ' + bet.odds + ' | EV: +' + (bet.ev*100).toFixed(1) + '% | 2元注奖金: ' + (bet.odds * 2).toFixed(0) + '元');
});

// 策略2: 平衡方案 - 高概率 + 合理赔率
console.log();
console.log('[策略B] 平衡方案 - 2串1 (高概率选项)');
var safeParlays = parlays.filter(function(p) {
  return p.a.prob >= 0.15 && p.b.prob >= 0.15 && p.combinedProb >= 0.05;
});
safeParlays.sort(function(a,b) { return b.combinedEV - a.combinedEV; });
safeParlays.slice(0, 5).forEach(function(p, i) {
  console.log('  ' + (i+1) + '. [' + p.a.pool + ']' + p.a.option + ' x [' + p.b.pool + ']' + p.b.option);
  console.log('     概率: ' + (p.combinedProb*100).toFixed(1) + '% | 赔率: ' + p.combinedOdds.toFixed(2) + ' | EV: ' + (p.combinedEV >= 0 ? '+' : '') + (p.combinedEV*100).toFixed(1) + '% | 2元注奖金: ' + p.payout.toFixed(0) + '元');
});

// 策略3: 高收益方案
console.log();
console.log('[策略C] 博高赔方案 - 2串1 (高赔率选项)');
var highOddsParlays = parlays.filter(function(p) {
  return p.combinedOdds >= 15 && p.combinedProb >= 0.02;
});
highOddsParlays.sort(function(a,b) { return b.combinedEV - a.combinedEV; });
highOddsParlays.slice(0, 5).forEach(function(p, i) {
  console.log('  ' + (i+1) + '. [' + p.a.pool + ']' + p.a.option + ' x [' + p.b.pool + ']' + p.b.option);
  console.log('     概率: ' + (p.combinedProb*100).toFixed(1) + '% | 赔率: ' + p.combinedOdds.toFixed(2) + ' | EV: ' + (p.combinedEV >= 0 ? '+' : '') + (p.combinedEV*100).toFixed(1) + '% | 2元注奖金: ' + p.payout.toFixed(0) + '元');
});
