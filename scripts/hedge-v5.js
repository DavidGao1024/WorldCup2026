const data = require('../data/lottery-odds.json');
var upcoming = data.matches.filter(function(m) { return m.matchDate >= '2026-06-24'; });

console.log('每注2元 总投入<=30元 对冲方案');
console.log('');

// === 方案：搏冷对冲（2注，最精简） ===
console.log('='.repeat(50));
console.log('方案A：搏冷对冲 — 2注搞定');
console.log('='.repeat(50));
console.log('');

var coldBets = [];
upcoming.forEach(function(m) {
  var had = m.pools.HAD, hafu = m.pools.HAFU;
  if (!had || !hafu) return;
  var favHome = had.h < had.a;
  var favOdds = favHome ? had.h : had.a;
  var favName = favHome ? m.homeTeam : m.awayTeam;
  var dogName = favHome ? m.awayTeam : m.homeTeam;

  // 找HAFU中对家半场领先+全场胜的最高赔冷门
  var coldKey = favHome ? 'ha' : 'hh'; // 对家半场领先+全场胜
  var coldOdds = hafu[coldKey];

  if (coldOdds < 15) return;

  // 分配注数：选最优比例
  // 目标：强队胜至少回本
  // 设强队注数x，冷门注数y，x+y=15(30元)
  // 强队胜回报: 2*x*favOdds >= 30 → x >= 15/favOdds
  var minX = Math.ceil(15 / favOdds);
  if (minX >= 15) minX = 14;

  for (var x = minX; x <= 14; x++) {
    var y = 15 - x;
    var favRet = Math.round(2 * x * favOdds * 100) / 100;
    var coldRet = Math.round(2 * y * coldOdds * 100) / 100;
    var favProfit = Math.round((favRet - 30) * 100) / 100;
    var coldProfit = Math.round((coldRet - 30) * 100) / 100;

    if (favProfit >= -2) { // 至少接近保本
      coldBets.push({
        match: m.matchNumStr + ' ' + m.homeTeam + ' vs ' + m.awayTeam,
        fav: favName, dog: dogName, favOdds: favOdds,
        coldKey: coldKey, coldOdds: coldOdds,
        favUnits: x, coldUnits: y,
        favRet: favRet, coldRet: coldRet,
        favProfit: favProfit, coldProfit: coldProfit
      });
    }
  }
});

coldBets.sort(function(a,b) { return b.favProfit - a.favProfit; });
var seen1 = {};
coldBets.forEach(function(c) {
  if (seen1[c.match]) return;
  seen1[c.match] = true;

  console.log(c.match);
  console.log('  HAD ' + c.fav + '胜 @' + c.favOdds.toFixed(2) + ' x' + c.favUnits + '注=' + (c.favUnits*2) + '元 -> ' + c.favRet + '元');
  console.log('  HAFU ' + c.coldKey + ' @' + c.coldOdds.toFixed(1) + ' x' + c.coldUnits + '注=' + (c.coldUnits*2) + '元 -> ' + c.coldRet + '元');
  console.log('  总30元 | ' + c.fav + '胜: ' + (c.favProfit>=0?'+':'') + c.favProfit + ' | 冷门: +' + c.coldProfit);
  console.log('');
});

// === 方案：三注全覆盖（HAD双选+TTG） ===
console.log('='.repeat(50));
console.log('方案B：三注全覆盖 — HAD双选+TTG');
console.log('='.repeat(50));
console.log('');

upcoming.forEach(function(m) {
  var had = m.pools.HAD, ttg = m.pools.TTG;
  var hadPool = m.availablePools.find(function(p) { return p.poolCode === 'HAD'; });
  if (!had || !ttg) return;
  var hadSingle = hadPool && hadPool.bettingSingle === 1;
  if (!hadSingle) return; // 只做HAD可单关的

  var favHome = had.h < had.a;
  var favOdds = favHome ? had.h : had.a;
  var dogOdds = favHome ? had.a : had.h;
  var drawOdds = had.d;

  // 主胜+客胜 + TTG s0对冲平局
  // 分配注数：使两注HAD回报尽量均衡
  var bestTTG = ttg.s0, bestKey = 's0';
  if (ttg.s1 > bestTTG) { bestTTG = ttg.s1; bestKey = 's1'; }

  // 尝试不同注数分配 (总共15注)
  var bestCombo = null;
  for (var f = 1; f <= 14; f++) {      // 热门注数
    for (var d = 1; d <= 14 - f; d++) { // 冷门注数
      var t = 15 - f - d;               // TTG注数
      if (t < 1) continue;
      var fRet = 2 * f * favOdds;
      var dRet = 2 * d * dogOdds;
      var tRet = 2 * t * bestTTG;
      var minRet = Math.min(fRet, dRet, tRet);
      if (minRet >= 28 && fRet >= 28) { // 任一结果至少接近保本
        if (!bestCombo || minRet > bestCombo.minRet) {
          bestCombo = {
            favUnits: f, dogUnits: d, ttgUnits: t,
            favRet: Math.round(fRet*100)/100, dogRet: Math.round(dRet*100)/100, ttgRet: Math.round(tRet*100)/100,
            minRet: Math.round(minRet*100)/100
          };
        }
      }
    }
  }

  if (bestCombo && bestCombo.minRet >= 29) {
    var favName = favHome ? m.homeTeam : m.awayTeam;
    var dogName = favHome ? m.awayTeam : m.homeTeam;
    console.log(m.matchNumStr + ' ' + m.homeTeam + ' vs ' + m.awayTeam);
    console.log('  HAD ' + favName + '胜 @' + favOdds.toFixed(2) + ' x' + bestCombo.favUnits + '注=' + (bestCombo.favUnits*2) + '元 -> ' + bestCombo.favRet + '元');
    console.log('  HAD ' + dogName + '胜 @' + dogOdds.toFixed(2) + ' x' + bestCombo.dogUnits + '注=' + (bestCombo.dogUnits*2) + '元 -> ' + bestCombo.dogRet + '元');
    console.log('  TTG ' + bestKey + ' @' + bestTTG.toFixed(1) + ' x' + bestCombo.ttgUnits + '注=' + (bestCombo.ttgUnits*2) + '元 -> ' + bestCombo.ttgRet + '元');
    console.log('  总30元 | 最低回报: ' + bestCombo.minRet + '元 | 漏洞: 有进球平局');
    console.log('');
  }
});

// === 方案：HAFU四注平衡 ===
console.log('='.repeat(50));
console.log('方案C：瑞士vs加拿大 — 均衡比赛4注HAFU');
console.log('='.repeat(50));
console.log('');

var sui = upcoming.find(function(m) { return m.matchNumStr === '周三049'; });
if (sui) {
  var h = sui.pools.HAFU;
  // 4注各分配
  var bets = [
    { label: 'hh 瑞士半场领先胜', odds: h.hh },
    { label: 'dh 半场平瑞士胜', odds: h.dh },
    { label: 'aa 加拿大半场领先胜', odds: h.aa },
    { label: 'da 半场平加拿大胜', odds: h.da }
  ];

  // 15注分配: 使各注回报尽量接近
  var totalUnits = 14; // 留1注补平局
  var w = bets.map(function(b) { return 1/b.odds; });
  var wSum = w.reduce(function(a,b) { return a+b; }, 0);

  console.log('瑞士 vs 加拿大 (HAD: 2.30/2.62/3.20 最均衡)');
  console.log('');

  bets.forEach(function(b, i) {
    var units = Math.round(totalUnits * w[i] / wSum);
    var ret = Math.round(2 * units * b.odds * 100) / 100;
    console.log('  HAFU ' + b.label + ' @' + b.odds.toFixed(2) + ' x' + units + '注=' + (units*2) + '元 -> ' + ret + '元');
  });

  // 补1注TTG s0对冲平局
  var ttg0 = sui.pools.TTG.s0;
  console.log('  TTG s0(0球) @' + ttg0.toFixed(1) + ' x1注=2元 -> ' + (2*ttg0).toFixed(1) + '元 (对冲平局)');
  console.log('  总~30元 | 漏洞: 有进球平局');

  // 实际计算
  var units = [3, 3, 2, 2]; // hh, dh, aa, da 均匀分配
  var total = 0;
  bets.forEach(function(b, i) {
    var ret = Math.round(2 * units[i] * b.odds * 100) / 100;
    total += units[i] * 2;
    console.log('  实际: ' + b.label + ' x' + units[i] + '注 -> ' + ret);
  });
  console.log('  14注=28元 + TTG s0 1注=2元 = 30元');
}

// === 方案：串关小投入 ===
console.log('');
console.log('='.repeat(50));
console.log('方案D：2串1过关 — 4元搏大回报');
console.log('='.repeat(50));
console.log('');

// 选两场强队的HHAD串关
var hhadMatches = upcoming.filter(function(m) {
  var pool = m.availablePools.find(function(p) { return p.poolCode === 'HHAD'; });
  return pool && pool.bettingSingle === 0 && m.pools.HAD && m.pools.HAFU;
});

var bestParlay = null;
for (var i = 0; i < hhadMatches.length; i++) {
  for (var j = i + 1; j < hhadMatches.length; j++) {
    var m1 = hhadMatches[i], m2 = hhadMatches[j];
    var had1 = m1.pools.HAD, had2 = m2.pools.HAD;
    var f1Home = had1.h < had1.a, f2Home = had2.h < had2.a;
    var f1Odds = f1Home ? had1.h : had1.a;
    var f2Odds = f2Home ? had2.h : had2.a;
    if (f1Odds > 1.55 || f2Odds > 1.55) continue;

    var pOdds = m1.pools.HHAD[f1Home?'h':'a'] * m2.pools.HHAD[f2Home?'h':'a'];
    if (!bestParlay || pOdds > bestParlay.odds) {
      bestParlay = {
        m1: m1, m2: m2,
        f1Name: f1Home ? m1.homeTeam : m1.awayTeam,
        f2Name: f2Home ? m2.homeTeam : m2.awayTeam,
        odds: Math.round(pOdds * 100) / 100
      };
    }
  }
}

if (bestParlay) {
  console.log(bestParlay.m1.matchNumStr + ' HHAD ' + bestParlay.f1Name + ' @' + bestParlay.m1.pools.HHAD[bestParlay.m1.pools.HAD.h<bestParlay.m1.pools.HAD.a?'h':'a'].toFixed(2));
  console.log('  x ' + bestParlay.m2.matchNumStr + ' HHAD ' + bestParlay.f2Name + ' @' + bestParlay.m2.pools.HHAD[bestParlay.m2.pools.HAD.h<bestParlay.m2.pools.HAD.a?'h':'a'].toFixed(2));
  console.log('  = 2串1 @' + bestParlay.odds.toFixed(2));
  console.log('  1注2元 -> 中' + (2*bestParlay.odds).toFixed(1) + '元');
  console.log('  建议买3注(6元)分散风险，再用24元买单关对冲');
}
