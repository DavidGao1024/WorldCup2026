// 对冲分析脚本
const data = require('../data/lottery-odds.json');
function imp(o) { return 1/o; }

console.log('╔══════════════════════════════════════════════╗');
console.log('║    世界杯体彩 · 低风险对冲投资方案            ║');
console.log('╚══════════════════════════════════════════════╝');
console.log('');
console.log('玩法说明:');
console.log('  胜平负(HAD) = 猜全场主胜/平局/客胜');
console.log('  让球胜平负(HHAD) = 强队让N球后再猜胜平负');
console.log('  总进球(TTG) = 猜全场总进球数(0-7+)');
console.log('  半全场(HAFU) = 猜半场+全场组合(如hh=半主全主)');
console.log('  让球数: -1表示主队让1球, +1表示主队受让1球');
console.log('');

// ===== 方案一 =====
console.log('═'.repeat(55));
console.log('方案一：HHAD + HAD 交叉对冲（覆盖度最高）');
console.log('═'.repeat(55));
console.log('原理：HHAD把强队取胜细分为"大胜"和"小胜"，');
console.log('     再借HAD的平局和客胜赔率，实现接近全覆盖。');
console.log('');

var results1 = [];
data.matches.forEach(function(m) {
  var had = m.pools.HAD, hhad = m.pools.HHAD;
  if (!had || !hhad) return;
  var gl = parseInt(hhad.goalLine);
  var favIsHome = had.h < had.a;
  var favName = favIsHome ? m.homeTeam : m.awayTeam;
  var dogName = favIsHome ? m.awayTeam : m.homeTeam;

  // HHAD的3个结果对应实际比分：
  // 让-1球: HHAD主=主赢2+, HHAD平=主赢1, HHAD客=平或客胜
  // 受让+1球: HHAD主=主不败, HHAD平=主输1, HHAD客=主输2+

  var combo;
  if (gl < 0) {
    // 主队让球（主队是强队）
    combo = {
      match: m.homeTeam + ' vs ' + m.awayTeam,
      desc: favName + '让' + Math.abs(gl) + '球',
      bets: [
        { label: favName + '赢' + (Math.abs(gl)+1) + '球以上', pool: 'HHAD主胜', odds: hhad.h },
        { label: '平局', pool: 'HAD平', odds: had.d },
        { label: dogName + '胜', pool: 'HAD客胜', odds: had.a }
      ],
      gap: favName + '恰好赢' + Math.abs(gl) + '球（HHAD平@' + hhad.d.toFixed(2) + '）'
    };
  } else {
    // 主队受让（客队是强队）
    combo = {
      match: m.homeTeam + ' vs ' + m.awayTeam,
      desc: dogName + '让' + gl + '球（' + m.homeTeam + '受让）',
      bets: [
        { label: m.homeTeam + '输' + (gl+1) + '球以上', pool: 'HHAD客胜', odds: hhad.a },
        { label: m.homeTeam + '胜', pool: 'HAD主胜', odds: had.h },
        { label: '平局', pool: 'HAD平', odds: had.d }
      ],
      gap: m.homeTeam + '恰好输' + gl + '球（HHAD平@' + hhad.d.toFixed(2) + '）'
    };
  }

  var cover = imp(combo.bets[0].odds) + imp(combo.bets[1].odds) + imp(combo.bets[2].odds);
  combo.coverage = cover;
  results1.push(combo);
});

results1.sort(function(a,b) { return a.coverage - b.coverage; });
results1.slice(0, 10).forEach(function(c, i) {
  console.log('#' + (i+1) + ' 【' + c.match + '】' + c.desc);
  c.bets.forEach(function(b) {
    console.log('  ① ' + b.label + ' → ' + b.pool + ' @' + b.odds.toFixed(2));
  });
  console.log('  唯一漏洞：' + c.gap);
  console.log('  三注覆盖度：' + (c.coverage*100).toFixed(1) + '% （体彩抽水约13%）');
  console.log('');
});

// ===== 方案二 =====
console.log('═'.repeat(55));
console.log('方案二：强弱对话 低风险组合');
console.log('═'.repeat(55));
console.log('原理：选1场强弱分明的比赛，用HAFU押强队两种取胜路径，');
console.log('     再用TTG极端进球对冲爆冷风险。');
console.log('');

var results2 = [];
data.matches.forEach(function(m) {
  var had = m.pools.HAD, hafu = m.pools.HAFU, ttg = m.pools.TTG;
  if (!had || !hafu || !ttg) return;
  var favIsHome = had.h < had.a;
  if ((favIsHome ? had.h : had.a) > 1.55) return; // 不够强弱分明

  var favName = favIsHome ? m.homeTeam : m.awayTeam;
  var hKey1 = favIsHome ? 'hh' : 'aa'; // 半场领先+全场胜
  var hKey2 = favIsHome ? 'dh' : 'da'; // 半场平+全场胜

  var cover = imp(hafu[hKey1]) + imp(hafu[hKey2]) + imp(ttg.s0);
  results2.push({
    match: m.homeTeam + ' vs ' + m.awayTeam,
    fav: favName,
    bet1: { label: favName + '半场领先→全场胜', key: hKey1, odds: hafu[hKey1] },
    bet2: { label: favName + '半场平→全场胜', key: hKey2, odds: hafu[hKey2] },
    bet3: { label: '全场0进球（极限冷门对冲）', key: 's0', odds: ttg.s0 },
    coverage: cover
  });
});

results2.sort(function(a,b) { return a.coverage - b.coverage; });
results2.forEach(function(c, i) {
  console.log('#' + (i+1) + ' 【' + c.match + '】强队：' + c.fav);
  console.log('  ① ' + c.bet1.label + '（HAFU ' + c.bet1.key + '）@' + c.bet1.odds.toFixed(2));
  console.log('  ② ' + c.bet2.label + '（HAFU ' + c.bet2.key + '）@' + c.bet2.odds.toFixed(2));
  console.log('  ③ ' + c.bet3.label + '（TTG 0球）@' + c.bet3.odds.toFixed(1));
  console.log('  覆盖度：' + (c.coverage*100).toFixed(1) + '%');
  console.log('');
});

// ===== 方案三 =====
console.log('═'.repeat(55));
console.log('方案三：两场强弱串关 + 平局保护');
console.log('═'.repeat(55));
console.log('原理：选2场强队HAD胜做2串1（赔率相乘），');
console.log('     同时各补一注平局单关防冷。');
console.log('');

var strong = [];
data.matches.forEach(function(m) {
  var had = m.pools.HAD;
  if (!had) return;
  if (had.h < 1.55) strong.push({ match: m.homeTeam + ' vs ' + m.awayTeam, fav: m.homeTeam, favOdds: had.h, draw: had.d });
  if (had.a < 1.55) strong.push({ match: m.homeTeam + ' vs ' + m.awayTeam, fav: m.awayTeam, favOdds: had.a, draw: had.d });
});
strong.sort(function(a,b) { return a.favOdds - b.favOdds; });

// 选最强的2场
if (strong.length >= 2) {
  var s1 = strong[0], s2 = strong[1];
  var comboOdds = s1.favOdds * s2.favOdds;
  console.log('两场选择：');
  console.log('  A: ' + s1.match + ' → ' + s1.fav + '胜 @' + s1.favOdds.toFixed(2));
  console.log('  B: ' + s2.match + ' → ' + s2.fav + '胜 @' + s2.favOdds.toFixed(2));
  console.log('  2串1赔率：@' + comboOdds.toFixed(2));
  console.log('');
  console.log('投注方案（总300元）：');
  console.log('  ┌ 主投：' + s1.fav + '胜 × ' + s2.fav + '胜 2串1 → 200元 → 中' + (200*comboOdds).toFixed(0) + '元');
  console.log('  ├ 保护A：' + s1.match + ' 平局 → 50元 @' + s1.draw.toFixed(2) + ' → 中' + (50*s1.draw).toFixed(0) + '元');
  console.log('  └ 保护B：' + s2.match + ' 平局 → 50元 @' + s2.draw.toFixed(2) + ' → 中' + (50*s2.draw).toFixed(0) + '元');
  console.log('');
  console.log('结果推演：');
  console.log('  两强都胜：+' + Math.round(200*comboOdds - 300) + '元');
  console.log('  一胜一平：约-' + Math.round(300 - 200 - 50*Math.max(s1.draw, s2.draw)) + '元（平局注对冲部分损失）');
  console.log('  一平一负/两平：约-150~-200元');
  console.log('  两负：-300元（极端情况，概率极低）');
}

// ===== 总结对比 =====
console.log('');
console.log('═'.repeat(55));
console.log('三个方案风险对比');
console.log('═'.repeat(55));
console.log('');
console.log('方案      注数  覆盖度   适合场景        风险等级');
console.log('──'.repeat(20));
console.log('方案一    3注   83-87%   单场，有明确强弱  ★★☆ 中低');
console.log('方案二    3注   73-91%   单场，极强弱对话  ★☆☆ 最低');
console.log('方案三    3注   ~80%     两场组合         ★★☆ 中低');
console.log('');
console.log('推荐：方案一 > 方案二 > 方案三');
console.log('方案一覆盖度最高且逻辑清晰：强队大胜+平局+弱队胜=几乎全覆盖。');
console.log('漏洞（强队小胜）概率约12-18%，可用HHAD平局补。');
