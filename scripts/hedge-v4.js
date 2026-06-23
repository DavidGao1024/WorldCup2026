const data = require('../data/lottery-odds.json');
function imp(o) { return 1/o; }
var upcoming = data.matches.filter(function(m) { return m.matchDate >= '2026-06-24'; });

console.log('投入少回报多 · 最优对冲方案');
console.log('目标：投入<=300元，任意结果尽量保本或盈利');
console.log('');

// ============ 方案一：单场HAD双选+TTG ============
console.log('='.repeat(55));
console.log('方案一：单场 HAD双选 + TTG 小额对冲');
console.log('='.repeat(55));
console.log('');

var best = [];
upcoming.forEach(function(m) {
  var had = m.pools.HAD, ttg = m.pools.TTG;
  var hadPool = m.availablePools.find(function(p) { return p.poolCode === 'HAD'; });
  if (!had || !ttg) return;
  var hadSingle = hadPool && hadPool.bettingSingle === 1;

  var combos = [
    { label: '主胜+平局', o: [had.h, had.d], miss: '客胜' },
    { label: '平局+客胜', o: [had.d, had.a], miss: '主胜' },
    { label: '主胜+客胜', o: [had.h, had.a], miss: '平局' }
  ];

  combos.forEach(function(c) {
    var bestTTG = null, bestOdds = 0, bestKey = '';
    if (c.miss === '平局') {
      ['s0','s1'].forEach(function(k) { if (ttg[k] > bestOdds) { bestOdds = ttg[k]; bestKey = k; } });
    } else {
      ['s0','s1','s7'].forEach(function(k) { if (ttg[k] && ttg[k] > bestOdds) { bestOdds = ttg[k]; bestKey = k; } });
    }

    var totalCost = imp(c.o[0]) + imp(c.o[1]) + imp(bestOdds);
    if (totalCost >= 1.05) return;

    var w1 = imp(c.o[0]), w2 = imp(c.o[1]), w3 = imp(bestOdds);
    var wTotal = w1 + w2 + w3;
    var budget = 250;
    var a1 = Math.round(budget * w1 / wTotal);
    var a2 = Math.round(budget * w2 / wTotal);
    var a3 = Math.round(budget * w3 / wTotal);
    var actualTotal = a1 + a2 + a3;
    var ret1 = Math.round(a1 * c.o[0]);
    var ret2 = Math.round(a2 * c.o[1]);
    var ret3 = Math.round(a3 * bestOdds);
    var minRet = Math.min(ret1, ret2, ret3);

    best.push({
      match: m.matchNumStr + ' ' + m.homeTeam + ' vs ' + m.awayTeam,
      hadSingle: hadSingle,
      combo: c.label,
      bets: [
        { label: 'HAD ' + (c.label.includes('主胜')?'主胜':c.label.split('+')[0]), odds: c.o[0], amt: a1, ret: ret1 },
        { label: 'HAD ' + c.label.split('+')[1], odds: c.o[1], amt: a2, ret: ret2 },
        { label: 'TTG ' + bestKey + ' (补' + c.miss + ')', odds: bestOdds, amt: a3, ret: ret3 }
      ],
      total: actualTotal,
      minRet: minRet,
      coverage: totalCost,
      gap: c.miss
    });
  });
});

best.sort(function(a,b) { return a.coverage - b.coverage; });
var seen = {};
best.forEach(function(c) {
  if (seen[c.match]) return;
  if (c.total > 280 || c.minRet < c.total * 0.85) return;
  seen[c.match] = true;

  var tag = c.hadSingle ? '[可单关]' : '[须串关]';
  console.log(c.match + ' ' + tag + ' ' + c.combo);
  c.bets.forEach(function(b) {
    console.log('  ' + b.label + ' @' + b.odds.toFixed(2) + ' 投' + b.amt + ' -> 中' + b.ret);
  });
  console.log('  投入' + c.total + ' | 最低回报' + c.minRet + ' | 回报率' + (c.minRet/c.total*100).toFixed(0) + '% | 漏洞:' + c.gap);
  console.log('');
});

// ============ 方案二：两场串关 ============
console.log('='.repeat(55));
console.log('方案二：两场HHAD串关 + 单关HAFU对冲');
console.log('='.repeat(55));
console.log('');

var hhadNeed = upcoming.filter(function(m) {
  var pool = m.availablePools.find(function(p) { return p.poolCode === 'HHAD'; });
  return pool && pool.bettingSingle === 0 && m.pools.HAD && m.pools.HAFU;
});

var printed = 0;
for (var i = 0; i < hhadNeed.length && printed < 3; i++) {
  for (var j = i + 1; j < hhadNeed.length && printed < 3; j++) {
    var m1 = hhadNeed[i], m2 = hhadNeed[j];
    var had1 = m1.pools.HAD, had2 = m2.pools.HAD;
    var fav1Home = had1.h < had1.a, fav2Home = had2.h < had2.a;
    var fav1Odds = fav1Home ? had1.h : had1.a;
    var fav2Odds = fav2Home ? had2.h : had2.a;
    if (fav1Odds > 1.55 || fav2Odds > 1.55) continue;

    var hhad1Key = fav1Home ? 'h' : 'a';
    var hhad2Key = fav2Home ? 'h' : 'a';
    var parlay = m1.pools.HHAD[hhad1Key] * m2.pools.HHAD[hhad2Key];

    var hafu1 = fav1Home ? m1.pools.HAFU.hh : m1.pools.HAFU.aa;
    var hafu2 = fav2Home ? m2.pools.HAFU.hh : m2.pools.HAFU.aa;

    // 方案: 串关(两HHAD) 100 + HAFU对冲各80 = 260
    var pAmt = 100, h1Amt = 80, h2Amt = 80;
    var total = pAmt + h1Amt + h2Amt;
    var pRet = Math.round(pAmt * parlay);
    var h1Ret = Math.round(h1Amt * hafu1);
    var h2Ret = Math.round(h2Amt * hafu2);

    var fav1Name = fav1Home ? m1.homeTeam : m1.awayTeam;
    var fav2Name = fav2Home ? m2.homeTeam : m2.awayTeam;

    console.log('组合' + (printed+1) + ': ' + m1.matchNumStr + ' + ' + m2.matchNumStr);
    console.log('  串关: HHAD ' + fav1Name + ' @' + m1.pools.HHAD[hhad1Key].toFixed(2) + ' x ' + fav2Name + ' @' + m2.pools.HHAD[hhad2Key].toFixed(2) + ' = @' + parlay.toFixed(2));
    console.log('       投' + pAmt + ' -> ' + pRet);
    console.log('  对冲: HAFU ' + m1.matchNumStr + ' ' + (fav1Home?'hh':'aa') + ' @' + hafu1.toFixed(2) + ' 投' + h1Amt + ' -> ' + h1Ret);
    console.log('        HAFU ' + m2.matchNumStr + ' ' + (fav2Home?'hh':'aa') + ' @' + hafu2.toFixed(2) + ' 投' + h2Amt + ' -> ' + h2Ret);
    console.log('  总投入' + total + ' | 串关中: +' + (pRet-total) + ' | 单场HAFU中: ' + (Math.max(h1Ret,h2Ret)-total));
    console.log('');
    printed++;
  }
}

// ============ 方案三：小投入搏冷+保底 ============
console.log('='.repeat(55));
console.log('方案三：小投入搏冷门 + 热门保底（200元以内）');
console.log('='.repeat(55));
console.log('');

upcoming.forEach(function(m) {
  var had = m.pools.HAD, hafu = m.pools.HAFU;
  if (!had || !hafu) return;

  var hafuKeys = ['hh','hd','ha','dh','dd','da','ah','ad','aa'];
  var bestCold = null, bestColdKey = '';
  hafuKeys.forEach(function(k) {
    if (!bestCold || hafu[k] > bestCold) { bestCold = hafu[k]; bestColdKey = k; }
  });
  if (bestCold < 15) return;

  var favHome = had.h < had.a;
  var favOdds = favHome ? had.h : had.a;
  var favLabel = favHome ? m.homeTeam + '胜' : m.awayTeam + '胜';

  var coldAmt = 15;
  var favAmt = 150;
  var total = coldAmt + favAmt;
  var coldRet = Math.round(coldAmt * bestCold);
  var favRet = Math.round(favAmt * favOdds);

  console.log(m.matchNumStr + ' ' + m.homeTeam + ' vs ' + m.awayTeam);
  console.log('  HAFU ' + bestColdKey + ' @' + bestCold.toFixed(1) + ' 投' + coldAmt + ' -> ' + coldRet + ' | HAD ' + favLabel + ' @' + favOdds.toFixed(2) + ' 投' + favAmt + ' -> ' + favRet);
  console.log('  总' + total + ' | 强队胜:' + (favRet>=total?'+':'') + (favRet-total) + ' | 冷门中:+' + (coldRet-total));
  console.log('');
});

// ============ 方案四：最高ROI单场 ============
console.log('='.repeat(55));
console.log('方案四：最高回报率 — 均衡比赛HAFU双选');
console.log('='.repeat(55));
console.log('原理: 选实力最接近的比赛，双方赔率都>2.0，怎么中都赚');
console.log('');

// 瑞士vs加拿大 HAD 2.30/2.62/3.20 最均衡
var sui = upcoming.find(function(m) { return m.matchNumStr === '周三049'; });
if (sui) {
  var hafu = sui.pools.HAFU;
  console.log('瑞士 vs 加拿大 (HAD: 2.30/2.62/3.20)');
  console.log('');
  console.log('策略: HAFU押两边取胜路径，不押平局');
  console.log('  瑞士胜的两条路: hh=半场领先胜 @' + hafu.hh.toFixed(2) + '  dh=半场平胜 @' + hafu.dh.toFixed(2));
  console.log('  加拿大胜的两条路: aa=半场领先胜 @' + hafu.aa.toFixed(2) + '  da=半场平胜 @' + hafu.da.toFixed(2));
  console.log('');
  console.log('四注各60元 = 240元:');
  var total = 240;
  var hh = Math.round(60 * hafu.hh);
  var dh = Math.round(60 * hafu.dh);
  var aa = Math.round(60 * hafu.aa);
  var da = Math.round(60 * hafu.da);
  console.log('  hh @' + hafu.hh.toFixed(2) + ' -> ' + hh + ' | dh @' + hafu.dh.toFixed(2) + ' -> ' + dh);
  console.log('  aa @' + hafu.aa.toFixed(2) + ' -> ' + aa + ' | da @' + hafu.da.toFixed(2) + ' -> ' + da);
  console.log('  任一结果中: ' + Math.min(hh,dh,aa,da) + '-' + total + ' = +' + (Math.min(hh,dh,aa,da)-total));
  console.log('  漏洞: 全场平局(概率约28%)');
}
