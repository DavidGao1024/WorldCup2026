// scripts/predict-v6.js — v6 预测模型
// 10维评分: 8核心 + 裁判(相对) + 旅途
var fs = require('fs');

var rankings = JSON.parse(fs.readFileSync('data/fifa-rankings.json','utf8'));
var forms = JSON.parse(fs.readFileSync('data/team-form.json','utf8'));
var stadiums = JSON.parse(fs.readFileSync('data/stadiums.json','utf8'));
var refereeDB = JSON.parse(fs.readFileSync('data/referee-db.json','utf8'));
var rotationData = JSON.parse(fs.readFileSync('data/rotation-analysis.json','utf8'));
var refereeAssign = JSON.parse(fs.readFileSync('data/referee-assignments.json','utf8'));
var wc = JSON.parse(fs.readFileSync('data/worldcup.json','utf8'));

function enrichForm(tf, team) {
  if (!tf) return { formScore:40, recent:[] };
  var e = JSON.parse(JSON.stringify(tf));
  if (!e.recent) e.recent = [];
  wc.matches.filter(function(m) { return m.status==='post' && m.score1!=null && (m.team1===team||m.team2===team); })
    .forEach(function(m) {
      var isT1 = m.team1===team;
      e.recent.unshift({
        opponent: isT1?m.team2:m.team1,
        result: m.score1>m.score2 ? (isT1?'W':'L') : m.score1<m.score2 ? (isT1?'L':'W') : 'D',
        gf: isT1?m.score1:m.score2, ga: isT1?m.score2:m.score1, date:m.date
      });
    });
  e.recent = e.recent.slice(0,10);
  var sc=40;
  e.recent.slice(0,3).forEach(function(r) {
    if(r.result==='W') sc+=15; else if(r.result==='D') sc+=5; else sc-=10;
  });
  e.formScore = Math.max(0,Math.min(100,sc));
  return e;
}

function computeScoreV6(team, opp, ground) {
  var r = rankings;
  var t = r[team]||{rank:60,elo:1100,squadValue:'€0.2亿',avgAge:27,conf:'UEFA'};
  var o = r[opp]||{rank:60,elo:1100,squadValue:'€0.2亿',avgAge:27,conf:'UEFA'};
  var tf = enrichForm(forms[team], team);
  var of = enrichForm(forms[opp], opp);
  var stadium = stadiums[ground]||{alt:50,country:''};
  var rot1 = rotationData[team] || {restDays:5,fatigueLevel:2,injuries:[]};
  var rot2 = rotationData[opp] || {restDays:5,fatigueLevel:2,injuries:[]};

  var refInfo = refereeAssign.find(function(a) {
    return (a.t1===team && a.t2===opp) || (a.t1===opp && a.t2===team);
  });
  var ref = (refInfo && refInfo.ref !== '未公布') ? refereeDB[refInfo.ref] : null;

  var scores = {};

  // 攻防数据
  var gf1 = tf.recent.slice(0,3).reduce(function(s,r){return s+(r.gf||0);},0)/Math.max(1,tf.recent.slice(0,3).length);
  var gf2 = of.recent.slice(0,3).reduce(function(s,r){return s+(r.gf||0);},0)/Math.max(1,of.recent.slice(0,3).length);
  var ga1 = tf.recent.slice(0,3).reduce(function(s,r){return s+(r.ga||0);},0)/Math.max(1,tf.recent.slice(0,3).length);
  var ga2 = of.recent.slice(0,3).reduce(function(s,r){return s+(r.ga||0);},0)/Math.max(1,of.recent.slice(0,3).length);

  // 1. FIFA排名 (25分)
  scores.ranking = Math.round(Math.min(25, (o.rank-t.rank)*0.35+12));
  if (t.rank<=5) scores.ranking = Math.min(25, scores.ranking+5);
  if (o.rank<=5) scores.ranking = Math.max(0, scores.ranking-5);

  // 2. 近期状态 (30分)
  scores.form = Math.round(Math.min(30, (tf.formScore-of.formScore)*0.6+15));

  // 3. 身价 (10分)
  var v1=parseFloat(t.squadValue.replace('€','').replace('亿',''));
  var v2=parseFloat(o.squadValue.replace('€','').replace('亿',''));
  scores.value = Math.round(Math.min(10,Math.max(0,(v1/Math.max(0.01,v2)-1)*3+5)));

  // 4. 进攻 (10分)
  scores.attack = Math.round(Math.min(10,Math.max(0,(gf1-gf2)*2+5)));

  // 5. 防守 (10分)
  scores.defense = Math.round(Math.min(10,Math.max(0,(ga2-ga1)*2+5)));

  // 6. 主场 (15分)
  var isHost = stadium.country===t.conf || (t.conf==='CONCACAF'&&['USA','Canada','Mexico'].indexOf(stadium.country||'')>=0);
  scores.home = isHost ? 10 : 5;

  // 7. 小组形势+休息 (10分)
  var fatigueDiff = rot2.fatigueLevel - rot1.fatigueLevel;
  scores.situation = Math.round(Math.min(10,Math.max(0,5+fatigueDiff*1.5)));

  // 8. 伤病 (5分)
  var pen1 = (rot1.injuries&&rot1.injuries.length||0)*1.5;
  var pen2 = (rot2.injuries&&rot2.injuries.length||0)*1.5;
  scores.injury = Math.round(Math.min(5,Math.max(0,2.5+(pen2-pen1))));

  // 9. 裁判 (2分) — 相对影响
  if (ref) {
    var refImpact = 0;
    var defenseDiff = ga2 - ga1;  // >0 主队更防守
    var attackDiff = gf1 - gf2;   // >0 主队更进攻

    if (ref.strictness >= 7) {
      // 严格: 利好防守方
      if (defenseDiff > 0.5) refImpact += 0.6;
      else if (defenseDiff < -0.5) refImpact -= 0.6;
    }
    if (ref.strictness <= 3) {
      // 宽松: 利好进攻方
      if (attackDiff > 0.5) refImpact += 0.3;
      else if (attackDiff < -0.5) refImpact -= 0.3;
    }
    if (ref.penaltyRate >= 0.2) {
      // 高点球率: 利好进攻方
      if (attackDiff > 0.5) refImpact += 0.3;
      else if (attackDiff < -0.5) refImpact -= 0.3;
    }
    scores.referee = Math.round(Math.min(2, Math.max(0, 1 + refImpact)));
  } else {
    scores.referee = 1;
  }

  // 10. 旅途/海拔 (1分) — 极端情况触发
  var altPenalty = stadium.alt > 500 ? 1 : 0;
  var travelBonus = (rot1.restDays - rot2.restDays) >= 3 ? 0.5 : 0;
  scores.travel = Math.round(Math.min(1, Math.max(0, 0.5 + travelBonus - altPenalty*0.5)));

  var total = Object.values(scores).reduce(function(a,b){return a+b;},0);
  var gap = total - (100-total);
  return { scores: scores, teamTotal: Math.round(total), oppTotal: Math.round(100-total), gap: Math.round(gap), ref: ref, refName: (refInfo?refInfo.ref:'未公布') };
}

function predictScore(team, opp, gap) {
  var rawRatio = (50+gap/2)/(50-gap/2);
  var tRatio = 0.5+(rawRatio-0.5)*0.5;
  var xgHome = Math.max(0.3,Math.min(3.0,1.3*tRatio/(1+tRatio)));
  var xgAway = Math.max(0.2,Math.min(2.5,1.3/(1+tRatio)));

  function poisson(l,k) { return Math.exp(-l)*Math.pow(l,k)/fact(k); }
  function fact(n) { var r=1; for(var i=2;i<=n;i++) r*=i; return r; }

  var probs=[];
  for(var i=0;i<=6;i++) for(var j=0;j<=6;j++) {
    var p=poisson(xgHome,i)*poisson(xgAway,j)*100;
    if(p>0.3) probs.push({score:i+'-'+j, prob:p});
  }
  probs.sort(function(a,b){return b.prob-a.prob;});

  var hWin=0,draw=0,aWin=0;
  probs.forEach(function(s) {
    var parts=s.score.split('-');
    if(+parts[0]>+parts[1]) hWin+=s.prob; else if(+parts[0]<+parts[1]) aWin+=s.prob; else draw+=s.prob;
  });

  return { scores:probs.slice(0,4), hWin:hWin, draw:draw, aWin:aWin, xgHome:xgHome, xgAway:xgAway };
}

// === 主程序 ===
var matches = wc.matches.filter(function(m) { return m.num>=74 && m.num<=88 && m.round==='Round of 32'; });

console.log('v6 1/16决赛预测 | 裁判影响: 相对防守方/进攻方');
console.log('='.repeat(65));

for (var idx=0; idx<matches.length; idx++) {
  var m = matches[idx];
  var result = computeScoreV6(m.team1, m.team2, m.ground);
  var pred = predictScore(m.team1, m.team2, result.gap);
  var gap = result.gap;
  var gapLabel = gap>=50?'碾压':gap>=25?'明显':'接近';

  console.log('');
  console.log((idx+1) + '. ' + m.team1 + ' ' + result.teamTotal + '-' + result.oppTotal + ' ' + m.team2 + ' (gap' + gap + ' ' + gapLabel + ')');
  console.log('   ' + m.date + ' | ' + m.ground);

  if (result.ref) {
    var who = '';
    if (result.scores.referee > 1.2) who = ' → 略利主队';
    else if (result.scores.referee < 0.8) who = ' → 略利客队';
    console.log('   裁判: ' + result.refName + ' (' + result.ref.style + ', ' + result.ref.cardsPerGame + '牌/场)' + who);
  }

  var r1 = rotationData[m.team1] || {restDays:'?',fatigueLevel:'?'};
  var r2 = rotationData[m.team2] || {restDays:'?',fatigueLevel:'?'};
  var restNote = '  休息: ' + r1.restDays + '天 vs ' + r2.restDays + '天';
  if (r1.fatigueLevel !== r2.fatigueLevel) restNote += ' | ' + (r1.fatigueLevel>r2.fatigueLevel?m.team1:m.team2) + '更疲劳';
  console.log(restNote);

  var h=pred.hWin.toFixed(0), d=pred.draw.toFixed(0), a=pred.aWin.toFixed(0);
  console.log('   ' + h + '% / ' + d + '% / ' + a + '%  |  ' + pred.scores.map(function(s){return s.score+'('+s.prob.toFixed(0)+'%)';}).join('  '));
}
