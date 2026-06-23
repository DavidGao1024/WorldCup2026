const data = require('../data/lottery-odds.json');
function imp(o) { return 1/o; }

console.log('╔══════════════════════════════════════════════╗');
console.log('║  世界杯体彩 · 低风险对冲方案（考虑单关限制）║');
console.log('╚══════════════════════════════════════════════╝');
console.log('');
console.log('规则提醒：');
console.log('  ● 可单关 = 可以单独买这一注');
console.log('  ◐ 须串关 = 必须和另一注组合成过关投注');
console.log('');

// === 列出所有比赛的单关/串关状态 ===
console.log('【各场比赛限制速查】');
console.log('');
data.matches.forEach(function(m) {
  var s = m.availablePools.filter(function(p) { return p.bettingSingle === 1; }).map(function(p) { return p.poolCode; });
  var p = m.availablePools.filter(function(p) { return p.bettingSingle === 0; }).map(function(p) { return p.poolCode; });
  console.log(m.matchNumStr + ' ' + m.homeTeam + ' vs ' + m.awayTeam);
  console.log('  可单关: ' + (s.length ? s.join(', ') : '无'));
  if (p.length) console.log('  须串关: ' + p.join(', '));
});

// === 方案一：葡萄牙vs乌兹别克 — 唯一全自由比赛 ===
console.log('');
console.log('═'.repeat(55));
console.log('方案一：葡萄牙 vs 乌兹别克斯坦（唯一所有玩法可单关）');
console.log('═'.repeat(55));

var por = null;
data.matches.forEach(function(m) { if (m.matchNumStr === '周二045') por = m; });
var hhad = por.pools.HHAD;
var hafu = por.pools.HAFU;
var ttg = por.pools.TTG;

console.log('');
console.log('让球胜平负(HHAD -2)：葡萄牙让2球');
console.log('  HHAD主胜 @' + hhad.h.toFixed(2) + ' = 葡萄牙赢3球以上');
console.log('  HHAD平   @' + hhad.d.toFixed(2) + ' = 葡萄牙恰好赢2球');
console.log('  HHAD客胜 @' + hhad.a.toFixed(2) + ' = 葡萄牙赢1/平/乌兹别克胜');
console.log('');
console.log('三注HHAD本身就覆盖全部结果，覆盖度：' + ((imp(hhad.h)+imp(hhad.d)+imp(hhad.a))*100).toFixed(1) + '%');
console.log('但葡萄牙让2球很深，存在"赢球输盘"风险。');
console.log('');
console.log('优化：HHAD客胜 + HAFU重注葡萄牙大胜');

var hedgeA = {
  bets: [
    { label: 'HHAD客胜（葡赢1/平/乌胜）', odds: hhad.a },
    { label: 'HAFU hh（葡半场领先+全场胜）', odds: hafu.hh }
  ],
  coverage: imp(hhad.a) + imp(hafu.hh)
};

console.log('两注对冲：');
console.log('  ① HHAD客胜 @' + hhad.a.toFixed(2) + ' — 覆盖葡萄牙不胜或小胜');
console.log('  ② HAFU hh @' + hafu.hh.toFixed(2) + ' — 覆盖葡萄牙半场就领先的全场胜利');
console.log('  覆盖度: ' + (hedgeA.coverage*100).toFixed(1) + '%');
console.log('  漏洞: 葡萄牙半场落后/平但最终赢2+球（小概率）');

// === 方案二：HAFU + TTG 对冲 ===
console.log('');
console.log('═'.repeat(55));
console.log('方案二：HAFU两注 + TTG一注 三角对冲（通用，可单关）');
console.log('═'.repeat(55));
console.log('');
console.log('HAFU和TTG在所有比赛中都可单关，不受限制。');
console.log('选一场强弱对话，押强队两种取胜路径+极端冷门。');
console.log('');

var best2 = [];
data.matches.forEach(function(m) {
  var had = m.pools.HAD, hafu = m.pools.HAFU, ttg = m.pools.TTG;
  if (!had || !hafu || !ttg) return;
  var favHome = had.h < had.a;
  if ((favHome ? had.h : had.a) > 1.55) return;

  var favName = favHome ? m.homeTeam : m.awayTeam;
  var a = favHome ? hafu.hh : hafu.aa;
  var b = favHome ? hafu.dh : hafu.da;
  var bestTTG = ttg.s0;
  ['s0','s1'].forEach(function(k) { if (ttg[k] > bestTTG) bestTTG = ttg[k]; });

  var cov = imp(a) + imp(b) + imp(bestTTG);
  best2.push({
    match: m.matchNumStr + ' ' + m.homeTeam + ' vs ' + m.awayTeam,
    fav: favName,
    favOdds: favHome ? had.h : had.a,
    bet1: { label: favName + '半场领先→全场胜', odds: a },
    bet2: { label: favName + '半场平→全场胜', odds: b },
    bet3: { label: '0-1球闷平', odds: bestTTG },
    coverage: cov
  });
});

best2.sort(function(a,b) { return a.coverage - b.coverage; });
best2.forEach(function(c, i) {
  var w1 = imp(c.bet1.odds), w2 = imp(c.bet2.odds), w3 = imp(c.bet3.odds);
  var total = w1 + w2 + w3;
  console.log('#' + (i+1) + ' 【' + c.match + '】强队：' + c.fav + '(@' + c.favOdds.toFixed(2) + ')');
  console.log('  ① HAFU ' + c.bet1.label + ' @' + c.bet1.odds.toFixed(2));
  console.log('  ② HAFU ' + c.bet2.label + ' @' + c.bet2.odds.toFixed(2));
  console.log('  ③ TTG ' + c.bet3.label + ' @' + c.bet3.odds.toFixed(1));
  console.log('  覆盖度: ' + (c.coverage*100).toFixed(1) + '% | 投注比例: ' + Math.round(w1/total*100) + '/' + Math.round(w2/total*100) + '/' + Math.round(w3/total*100));
  console.log('');
});

// === 方案三：可单关HAD比赛双选 ===
console.log('═'.repeat(55));
console.log('方案三：HAD双选 + TTG补洞（仅限HAD可单关的比赛）');
console.log('═'.repeat(55));
console.log('');

data.matches.forEach(function(m) {
  var had = m.pools.HAD, ttg = m.pools.TTG;
  var hadPool = m.availablePools.find(function(p) { return p.poolCode === 'HAD'; });
  if (!had || !ttg || !hadPool || hadPool.bettingSingle !== 1) return;

  // 找最便宜的双选
  var combos = [
    { label: '主胜+平局', o: [had.h, had.d], miss: '客胜' },
    { label: '平局+客胜', o: [had.d, had.a], miss: '主胜' },
    { label: '主胜+客胜', o: [had.h, had.a], miss: '平局' }
  ];

  combos.forEach(function(c) {
    // 选最佳TTG对冲
    var bestT = ttg.s0, bestK = 's0(0球)';
    if (ttg.s1 > bestT) { bestT = ttg.s1; bestK = 's1(1球)'; }
    if (c.miss === '平局' && ttg.s0 > bestT) { bestT = ttg.s0; bestK = 's0(0球)'; }
    if (c.miss !== '平局' && ttg.s7 && ttg.s7 > bestT) { bestT = ttg.s7; bestK = 's7(7+球)'; }

    var cov = imp(c.o[0]) + imp(c.o[1]) + imp(bestT);
    if (cov > 0.85 && cov < 1.05) {
      console.log('【' + m.matchNumStr + ' ' + m.homeTeam + ' vs ' + m.awayTeam + '】');
      console.log('  HAD ' + c.label + ' @' + c.o[0].toFixed(2) + ' + @' + c.o[1].toFixed(2));
      console.log('  TTG ' + bestK + ' @' + bestT.toFixed(1) + ' → 对冲' + c.miss);
      console.log('  覆盖度: ' + (cov*100).toFixed(1) + '%');
      console.log('');
    }
  });
});
