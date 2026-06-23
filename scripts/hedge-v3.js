const data = require('../data/lottery-odds.json');
function imp(o) { return 1/o; }

var upcoming = data.matches.filter(function(m) { return m.matchDate >= '2026-06-24'; });

console.log('╔══════════════════════════════════════════════╗');
console.log('║  剩余10场 · 低风险对冲方案（含串关）         ║');
console.log('╚══════════════════════════════════════════════╝');
console.log('');

// ============================================================
// 方案一：纯单关 HAFU + TTG 三角对冲
// ============================================================
console.log('═'.repeat(55));
console.log('方案一：纯单关 HAFU + TTG 三角对冲');
console.log('═'.repeat(55));
console.log('特点：HAFU和TTG全部可单关，无需串关，操作最简单');
console.log('适用：所有比赛');
console.log('');

var best1 = [];
upcoming.forEach(function(m) {
  var had = m.pools.HAD, hafu = m.pools.HAFU, ttg = m.pools.TTG;
  if (!had || !hafu || !ttg) return;
  var favHome = had.h < had.a;
  var favOdds = favHome ? had.h : had.a;
  if (favOdds > 1.70) return; // 不够强弱分明
  var favName = favHome ? m.homeTeam : m.awayTeam;
  var dogName = favHome ? m.awayTeam : m.homeTeam;
  var a = favHome ? hafu.hh : hafu.aa;
  var b = favHome ? hafu.dh : hafu.da;
  var bestTTG = ttg.s0, bestK = 's0';
  if (ttg.s1 > bestTTG) { bestTTG = ttg.s1; bestK = 's1'; }

  var cov = imp(a) + imp(b) + imp(bestTTG);
  var w1 = imp(a), w2 = imp(b), w3 = imp(bestTTG);
  var total = w1 + w2 + w3;

  best1.push({
    match: m.matchNumStr + ' ' + m.homeTeam + ' vs ' + m.awayTeam,
    fav: favName, dog: dogName, favOdds: favOdds,
    bets: [
      { label: 'HAFU ' + (favHome?'hh':'aa') + ' ' + favName + '半场领先→全场胜', odds: a },
      { label: 'HAFU ' + (favHome?'dh':'da') + ' ' + favName + '半场平→全场胜', odds: b },
      { label: 'TTG ' + bestK + ' 全场' + bestK.replace('s','') + '球', odds: bestTTG }
    ],
    coverage: cov,
    weights: [Math.round(w1/total*100), Math.round(w2/total*100), Math.round(w3/total*100)]
  });
});

best1.sort(function(a,b) { return a.coverage - b.coverage; });
best1.forEach(function(c, i) {
  console.log('#' + (i+1) + '【' + c.match + '】强队：' + c.fav + '(HAD @' + c.favOdds.toFixed(2) + ')');
  console.log('  ① ' + c.bets[0].label + ' @' + c.bets[0].odds.toFixed(2));
  console.log('  ② ' + c.bets[1].label + ' @' + c.bets[1].odds.toFixed(2));
  console.log('  ③ ' + c.bets[2].label + ' @' + c.bets[2].odds.toFixed(1));
  console.log('  覆盖度: ' + (c.coverage*100).toFixed(1) + '% | 比例: ' + c.weights[0] + '/' + c.weights[1] + '/' + c.weights[2]);
  // 具体金额
  var base = 500;
  var amt1 = Math.round(base * c.weights[0] / 100);
  var amt2 = Math.round(base * c.weights[1] / 100);
  var amt3 = Math.round(base * c.weights[2] / 100);
  var ret1 = Math.round(amt1 * c.bets[0].odds);
  var ret2 = Math.round(amt2 * c.bets[1].odds);
  var ret3 = Math.round(amt3 * c.bets[2].odds);
  var totalAmt = amt1 + amt2 + amt3;
  console.log('  投' + totalAmt + '元: ' + c.fav + '半场领先胜→+' + (ret1-totalAmt) + ' | 半场平胜→+' + (ret2-totalAmt) + ' | ' + c.bets[2].label + '→' + (ret3>=totalAmt?'+'+ (ret3-totalAmt): (ret3-totalAmt)));
  console.log('');
});

// ============================================================
// 方案二：HHAD串关解锁 + HAD/HAFU对冲
// ============================================================
console.log('═'.repeat(55));
console.log('方案二：HHAD通过串关解锁 + 单关对冲');
console.log('═'.repeat(55));
console.log('特点：HHAD须串关，和另一场TTG组成2串1来解锁');
console.log('      同时在本场用HAFU单关对冲');
console.log('');

// 找HHAD须串关 + HAFU可单关的比赛
upcoming.forEach(function(m) {
  var hhad = m.pools.HHAD, hafu = m.pools.HAFU, ttg = m.pools.TTG, had = m.pools.HAD;
  if (!hhad || !hafu) return;
  var hhadParlay = m.availablePools.find(function(p) { return p.poolCode === 'HHAD'; });
  if (!hhadParlay || hhadParlay.bettingSingle === 1) return; // HHAD可以单关就不需要串关解锁

  var gl = parseInt(hhad.goalLine);
  var favHome = had ? had.h < had.a : (gl < 0);
  var favName = favHome ? m.homeTeam : m.awayTeam;
  var dogName = favHome ? m.awayTeam : m.homeTeam;

  // 找另一场TTG赔率最低的来串关（最小化串关成本）
  var bestPartner = null;
  upcoming.forEach(function(m2) {
    if (m2.matchNum === m.matchNum) return;
    var t = m2.pools.TTG;
    if (!t) return;
    // 选赔率最低的TTG结果（最容易中的）
    var minOdds = Math.min.apply(null, [t.s2,t.s3,t.s4].filter(Boolean));
    if (!bestPartner || minOdds < bestPartner.odds) {
      bestPartner = { match: m2.matchNumStr, odds: minOdds };
    }
  });

  if (!bestPartner) return;

  // 策略：HHAD关键注 × 搭档TTG = 2串1解锁
  // 同时单关买HAFU对冲
  var hhadKey = favHome ? 'h' : 'a';
  var hhadOdds = hhad[hhadKey];
  var parlayOdds = hhadOdds * bestPartner.odds;

  var hafuKey1 = favHome ? 'hh' : 'aa';
  var hafuKey2 = favHome ? 'dh' : 'da';

  var coverage = imp(parlayOdds) + imp(hafu[hafuKey1]) + imp(hafu[hafuKey2]);

  console.log('【' + m.matchNumStr + ' ' + m.homeTeam + ' vs ' + m.awayTeam + '】');
  console.log('  让球: HHAD(' + hhad.goalLine + ') ' + favName + '让' + Math.abs(gl) + '球');
  console.log('  串关: HHAD ' + (hhadKey==='h'?'主胜':'客胜') + ' @' + hhadOdds.toFixed(2) + ' × ' + bestPartner.match + ' TTG @' + bestPartner.odds.toFixed(1) + ' → 2串1 @' + parlayOdds.toFixed(2));
  console.log('  对冲: HAFU ' + hafuKey1 + ' @' + hafu[hafuKey1].toFixed(2) + ' + HAFU ' + hafuKey2 + ' @' + hafu[hafuKey2].toFixed(2) + ' (单关)');
  console.log('  覆盖度: ' + (coverage*100).toFixed(1) + '%');
  console.log('');
});

// ============================================================
// 方案三：HAD可单关比赛 三注全覆盖
// ============================================================
console.log('═'.repeat(55));
console.log('方案三：HAD可单关比赛 三注直接全覆盖');
console.log('═'.repeat(55));
console.log('特点：选HAD可单关的比赛，直接HAD两注+TTG一注');
console.log('');

upcoming.forEach(function(m) {
  var had = m.pools.HAD, ttg = m.pools.TTG;
  var hadPool = m.availablePools.find(function(p) { return p.poolCode === 'HAD'; });
  if (!had || !ttg || !hadPool || hadPool.bettingSingle !== 1) return;

  // 强弱对话：主胜+客胜+TTG s0对冲平局
  var favHome = had.h < had.a;
  var combos = [];

  if (favHome && had.h < 2.0) {
    combos.push({
      label: '主胜+客胜 双选 + TTG s0对冲平局',
      bets: [
        { label: 'HAD主胜', odds: had.h },
        { label: 'HAD客胜', odds: had.a },
        { label: 'TTG s0(0球)', odds: ttg.s0 }
      ]
    });
  }
  if (!favHome && had.a < 2.0) {
    combos.push({
      label: '主胜+客胜 双选 + TTG s0对冲平局',
      bets: [
        { label: 'HAD主胜', odds: had.h },
        { label: 'HAD客胜', odds: had.a },
        { label: 'TTG s0(0球)', odds: ttg.s0 }
      ]
    });
  }

  combos.forEach(function(c) {
    var cov = imp(c.bets[0].odds) + imp(c.bets[1].odds) + imp(c.bets[2].odds);
    if (cov > 0.85 && cov < 1.05) {
      var w = c.bets.map(function(b) { return imp(b.odds); });
      var total = w[0] + w[1] + w[2];
      console.log('【' + m.matchNumStr + ' ' + m.homeTeam + ' vs ' + m.awayTeam + '】');
      console.log('  ' + c.label);
      c.bets.forEach(function(b) { console.log('  - ' + b.label + ' @' + b.odds.toFixed(2)); });
      console.log('  覆盖度: ' + (cov*100).toFixed(1) + '% | 比例: ' + Math.round(w[0]/total*100) + '/' + Math.round(w[1]/total*100) + '/' + Math.round(w[2]/total*100));
      // 金额
      var base = 500;
      var amts = w.map(function(x) { return Math.round(base * x / total); });
      var totalAmt = amts[0] + amts[1] + amts[2];
      console.log('  投' + totalAmt + '元: ' + c.bets[0].label + '→' + Math.round(amts[0]*c.bets[0].odds) + ' | ' + c.bets[1].label + '→' + Math.round(amts[1]*c.bets[1].odds) + ' | ' + c.bets[2].label + '→' + Math.round(amts[2]*c.bets[2].odds));
      console.log('');
    }
  });
});

// ============================================================
// 方案四：两场串关组合 — HHAD互相串关
// ============================================================
console.log('═'.repeat(55));
console.log('方案四：两场HHAD串关 + 各场HAFU单独保护');
console.log('═'.repeat(55));
console.log('特点：两个HHAD须串关的比赛，互串解锁，再用HAFU对冲');
console.log('');

// 找两场HHAD都须串关的强队比赛
var hhadMatches = upcoming.filter(function(m) {
  if (!m.pools.HHAD || !m.pools.HAD) return false;
  var favOdds = m.pools.HAD.h < m.pools.HAD.a ? m.pools.HAD.h : m.pools.HAD.a;
  return favOdds < 1.7;
});

if (hhadMatches.length >= 2) {
  for (var i = 0; i < hhadMatches.length - 1; i++) {
    for (var j = i + 1; j < hhadMatches.length; j++) {
      var m1 = hhadMatches[i], m2 = hhadMatches[j];
      var fav1Home = m1.pools.HAD.h < m1.pools.HAD.a;
      var fav2Home = m2.pools.HAD.h < m2.pools.HAD.a;
      var hhad1Key = fav1Home ? 'h' : 'a';
      var hhad2Key = fav2Home ? 'h' : 'a';
      var parlay = m1.pools.HHAD[hhad1Key] * m2.pools.HHAD[hhad2Key];

      // 各场HAFU对冲
      var hafu1a = fav1Home ? m1.pools.HAFU.hh : m1.pools.HAFU.aa;
      var hafu1b = fav1Home ? m1.pools.HAFU.dh : m1.pools.HAFU.da;
      var hafu2a = fav2Home ? m2.pools.HAFU.hh : m2.pools.HAFU.aa;
      var hafu2b = fav2Home ? m2.pools.HAFU.dh : m2.pools.HAFU.da;

      // 成本: 串关1注 + 每场2注HAFU = 5注
      var wParlay = imp(parlay);
      var w1a = imp(hafu1a), w1b = imp(hafu1b);
      var w2a = imp(hafu2a), w2b = imp(hafu2b);

      console.log('组合: ' + m1.matchNumStr + ' + ' + m2.matchNumStr);
      console.log('  串关: HHAD ' + m1.homeTeam + 'vs' + m1.awayTeam + ' ' + (hhad1Key==='h'?'主胜':'客胜') + ' @' + m1.pools.HHAD[hhad1Key].toFixed(2));
      console.log('     × HHAD ' + m2.homeTeam + 'vs' + m2.awayTeam + ' ' + (hhad2Key==='h'?'主胜':'客胜') + ' @' + m2.pools.HHAD[hhad2Key].toFixed(2));
      console.log('     = 2串1 @' + parlay.toFixed(2));
      console.log('  对冲: ' + m1.matchNumStr + ' HAFU ' + (fav1Home?'hh':'aa') + ' @' + hafu1a.toFixed(2) + ' + ' + (fav1Home?'dh':'da') + ' @' + hafu1b.toFixed(2));
      console.log('        ' + m2.matchNumStr + ' HAFU ' + (fav2Home?'hh':'aa') + ' @' + hafu2a.toFixed(2) + ' + ' + (fav2Home?'dh':'da') + ' @' + hafu2b.toFixed(2));
      console.log('');
    }
  }
}
