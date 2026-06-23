// js/analysis.js
var analysisData = {};

function loadAnalysisData() {
  return Promise.all([
    fetch('data/fifa-rankings.json').then(function(r) { return r.json(); }),
    fetch('data/team-form.json').then(function(r) { return r.json(); }),
    fetch('data/stadiums.json').then(function(r) { return r.json(); }),
    fetch('data/injuries.json').then(function(r) { return r.json(); }).catch(function() { return {}; })
  ]).then(function(results) {
    analysisData.rankings = results[0];
    analysisData.forms = results[1];
    analysisData.stadiums = results[2];
    // 合并静态伤病数据 + ESPN 实时停赛数据
    analysisData.injuries = mergeInjuryAndSuspensionData(
      results[3],
      (typeof worldCupSuspensions !== 'undefined' && worldCupSuspensions) ? worldCupSuspensions : {}
    );
    return analysisData;
  });
}

// 合并伤病数据（来自 injuries.json）和停赛数据（来自 ESPN 红黄牌计算）
function mergeInjuryAndSuspensionData(injuryData, suspensionData) {
  var merged = {};
  var allTeams = {};
  Object.keys(injuryData || {}).forEach(function(t) { allTeams[t] = true; });
  Object.keys(suspensionData || {}).forEach(function(t) { allTeams[t] = true; });

  Object.keys(allTeams).forEach(function(team) {
    var inj = injuryData[team] || { injuries: 0, suspensions: 0, note: '' };
    var sus = suspensionData[team] || { suspensions: 0, suspendedPlayers: [], note: '' };

    // 伤病和停赛数量分别记录
    var totalSuspensions = (inj.suspensions || 0) + (sus.suspensions || 0);
    var notes = [];
    if (inj.note) notes.push(inj.note);
    if (sus.note) notes.push(sus.note);

    merged[team] = {
      injuries: inj.injuries || 0,
      suspensions: totalSuspensions,
      // 保留详细的停赛球员列表供 insights 使用
      suspendedPlayers: sus.suspendedPlayers || [],
      injuryNote: inj.note || '',
      suspensionNote: sus.note || '',
      note: notes.filter(Boolean).join('; ')
    };
  });

  return merged;
}

// ---- Scoring engine ----

function computeMatchScore(team, opponent, ground, matchDate) {
  var rank = analysisData.rankings || {};
  var form = analysisData.forms || {};
  var stadiums = analysisData.stadiums || {};
  var injuries = analysisData.injuries || {};

  var t = rank[team] || { rank: 60, elo: 1100, squadValue: '€0.2亿', avgAge: 27, conf: 'UEFA' };
  var o = rank[opponent] || { rank: 60, elo: 1100, squadValue: '€0.2亿', avgAge: 27, conf: 'UEFA' };
  var tf = form[team] || { formScore: 40, recent: [] };
  var of = form[opponent] || { formScore: 40, recent: [] };
  // 注入世界杯比赛结果（team-form.json 只含赛前数据）
  tf = enrichFormWithWCResults(tf, team);
  of = enrichFormWithWCResults(of, opponent);
  var stadium = stadiums[ground] || { alt: 50, country: '' };

  var scores = {};

  // 1. FIFA/ELO (25 pts)
  scores.ranking = Math.round(Math.min(25, (o.rank - t.rank) * 0.35 + 12));
  if (t.rank <= 5) scores.ranking = Math.min(25, scores.ranking + 5);
  if (o.rank <= 5) scores.ranking = Math.max(0, scores.ranking - 5);

  // 2. Recent form, opponent-weighted (30 pts)
  var formScore = computeFormScore(tf, true);
  var oppFormScore = computeFormScore(of, false);
  scores.form = Math.round(formScore - oppFormScore + 15);
  scores.form = Math.max(0, Math.min(30, scores.form));

  // 3. Squad value (10 pts)
  var tv = parseSquadValue(t.squadValue);
  var ov = parseSquadValue(o.squadValue);
  scores.squad = Math.round(Math.min(10, Math.max(0, (tv - ov) / 0.8 + 5)));

  // 5. Attacking power (10 pts)
  var tGoals = computeAvgGoals(tf);
  var oGoals = computeAvgGoals(of);
  scores.attack = Math.round(Math.max(0, Math.min(10, (tGoals - oGoals) * 4 + 5)));

  // 6. Defensive solidity (10 pts)
  var tConc = computeAvgConc(tf);
  var oConc = computeAvgConc(of);
  scores.defense = Math.round(Math.max(0, Math.min(10, (oConc - tConc) * 4 + 5)));

  // 7. Home/host advantage (15 pts)
  scores.host = computeHostScore(team, opponent, stadium);

  // 8. Group standing situation (10 pts)
  scores.situation = computeSituationScore(team, opponent, matchDate);

  // 9. Injuries & suspensions (5 pts)
  var tInj = injuries[team] || { injuries: 0, suspensions: 0 };
  var oInj = injuries[opponent] || { injuries: 0, suspensions: 0 };
  var tPenalty = tInj.injuries * 1.5 + tInj.suspensions * 3;
  var oPenalty = oInj.injuries * 1.5 + oInj.suspensions * 3;
  scores.injury = Math.round(Math.max(0, Math.min(5, 2.5 + (oPenalty - tPenalty) * 0.8)));

  var total = scores.ranking + scores.form + scores.squad +
              scores.attack + scores.defense + scores.host +
              scores.situation + scores.injury;
  total = Math.round(total);
  total = Math.max(5, Math.min(95, total));
  var maxTotal = 100;

  return {
    teamTotal: total,
    oppTotal: maxTotal - total,
    gap: total - (maxTotal - total),
    scores: scores,
    team: team,
    opponent: opponent,
    teamRank: t,
    oppRank: o,
    teamForm: tf,
    oppForm: of
  };
}

// 泊松分布比分预测 — 基于分析得分推导预期进球
function predictScores(result) {
  // 从分析得分反推两队实力比
  var tScore = result.teamTotal;
  var oScore = result.oppTotal;

  // 世界杯场均进球约2.6，按得分比分配
  var totalGoals = 2.6;
  var tRatio = tScore / (tScore + oScore);

  // 进攻得分高 → 进球多于平均值；防守得分高 → 失球少于平均值
  var tAtt = result.scores.attack / 10;   // 0~1 进攻评分归一化
  var tDef = result.scores.defense / 10;  // 0~1 防守评分归一化

  var tExp = totalGoals * tRatio * (0.7 + tAtt * 0.6);
  var oExp = totalGoals * (1 - tRatio) * (0.7 + (1 - tDef) * 0.6);

  // 排名差修正
  var rankDiff = (result.oppRank.rank || 60) - (result.teamRank.rank || 60);
  tExp += rankDiff * 0.008;
  oExp -= rankDiff * 0.008;

  tExp = Math.max(0.2, Math.min(5, tExp));
  oExp = Math.max(0.2, Math.min(5, oExp));

  function poisson(k, lam) {
    if (k < 0 || lam <= 0) return 0;
    var v = Math.exp(-lam);
    for (var i = 1; i <= k; i++) v *= lam / i;
    return v;
  }

  var scores = [];
  for (var i = 0; i <= 6; i++) {
    for (var j = 0; j <= 6; j++) {
      if (i === j && i > 4) continue;
      scores.push({ home: i, away: j, prob: poisson(i, tExp) * poisson(j, oExp) });
    }
  }
  scores.sort(function(a, b) { return b.prob - a.prob; });

  return {
    top1: scores[0] ? (scores[0].home + '-' + scores[0].away) : '1-0',
    top1Pct: scores[0] ? Math.round(scores[0].prob * 100) : 0,
    top2: scores[1] ? (scores[1].home + '-' + scores[1].away) : '2-0',
    top2Pct: scores[1] ? Math.round(scores[1].prob * 100) : 0
  };
}

// ---- 赛前预测引擎（Elo + 状态 + 市场赔率） ----

function computePrediction(result, m) {
  var rankings = analysisData.rankings || {};
  var forms = analysisData.forms || {};
  var injuries = analysisData.injuries || {};

  var t = rankings[result.team] || { elo: 1100, rank: 60 };
  var o = rankings[result.opponent] || { elo: 1100, rank: 60 };
  var tf = forms[result.team] || { formScore: 40 };
  var of = forms[result.opponent] || { formScore: 40 };
  var tInj = injuries[result.team] || { injuries: 0, suspensions: 0 };
  var oInj = injuries[result.opponent] || { injuries: 0, suspensions: 0 };

  // 第一步：Elo基础胜率（权重35%）
  var eloDiff = t.elo - o.elo;
  var eloWinProb = 1 / (1 + Math.pow(10, -eloDiff / 400));

  // 第二步：状态修正（权重25%）
  var formDiff = tf.formScore - of.formScore;
  var formWinProb = 0.5 + formDiff / 200;
  formWinProb = Math.max(0.1, Math.min(0.9, formWinProb));

  // 第三步：环境修正（权重15%）
  var tPenalty = (tInj.injuries || 0) * 1.5 + (tInj.suspensions || 0) * 3;
  var oPenalty = (oInj.injuries || 0) * 1.5 + (oInj.suspensions || 0) * 3;
  var envAdj = (oPenalty - tPenalty) * 0.02;
  envAdj += (o.rank - t.rank) * 0.003;
  var venue = (m && m.ground) ? m.ground.toLowerCase() : '';
  var hostTeams = ['united states', 'usa', 'mexico', 'canada'];
  for (var hi = 0; hi < hostTeams.length; hi++) {
    if (result.team.toLowerCase().indexOf(hostTeams[hi]) >= 0 && (venue.indexOf('united states') >= 0 || venue.indexOf('mexico') >= 0 || venue.indexOf('canada') >= 0)) {
      envAdj += 0.08; break;
    }
  }
  var envWinProb = 0.5 + envAdj;
  envWinProb = Math.max(0.1, Math.min(0.9, envWinProb));

  // 三步融合
  var rawWinProb = eloWinProb * 0.35 + formWinProb * 0.25 + envWinProb * 0.15;

  // 第四步：市场赔率校准（权重25%）
  var marketWinProb = null;
  if (typeof lotteryData !== 'undefined' && lotteryData && lotteryData._matches) {
    var lm = lotteryData._matches;
    for (var mk = 0; mk < lm.length; mk++) {
      var had = lm[mk].pools.HAD;
      if (!had) continue;
      var lh = TEAM_ZH_REVERSE[lm[mk].homeTeam] || lm[mk].homeTeamEn;
      var la = TEAM_ZH_REVERSE[lm[mk].awayTeam] || lm[mk].awayTeamEn;
      if ((lh === result.team && la === result.opponent) || (lh === result.opponent && la === result.team)) {
        var isHome = lh === result.team;
        var hImp = 1 / had.h, dImp = 1 / had.d, aImp = 1 / had.a;
        var totalImp = hImp + dImp + aImp;
        marketWinProb = {
          tProb: (isHome ? hImp : aImp) / totalImp,
          dProb: dImp / totalImp,
          oProb: (isHome ? aImp : hImp) / totalImp
        };
        break;
      }
    }
  }

  if (marketWinProb) {
    rawWinProb = rawWinProb * 0.75 + marketWinProb.tProb * 0.25;
  } else {
    rawWinProb = rawWinProb / 0.75;
  }

  // 平局概率
  var gap = Math.abs(result.teamTotal - result.oppTotal);
  var drawBase = 0.28;
  var drawFactor = Math.max(0.05, drawBase - gap * 0.006);
  if (marketWinProb) drawFactor = drawFactor * 0.5 + marketWinProb.dProb * 0.5;

  var rem = 1 - drawFactor;
  var tFinal = rawWinProb * rem;
  var oFinal = (1 - rawWinProb) * rem;

  var verdict = '';
  if (gap >= 25) verdict = '实力差距明显，' + result.team + '取胜概率很高';
  else if (gap >= 12) verdict = result.team + '占优，但' + result.opponent + '有能力制造麻烦';
  else verdict = '势均力敌，任何结果都有可能';

  var scores = predictScores(result);

  return {
    teamProb: Math.round(tFinal * 100),
    drawProb: Math.round(drawFactor * 100),
    oppProb: Math.round(oFinal * 100),
    verdict: verdict,
    hasMarket: !!marketWinProb,
    score1: scores.top1,
    score1Pct: scores.top1Pct,
    score2: scores.top2,
    score2Pct: scores.top2Pct
  };
}

// 筛选世界杯正赛（2026-06-11起），无数据则回退到全部比赛
function filterWC(matches) {
  var arr = matches || [];
  var wc = arr.filter(function(r) { return r.date >= '2026-06-11'; });
  return wc.length > 0 ? wc : arr;
}

// 从 analysisData.rankings 获取球队排名，无数据时从积分榜推算，保底50
function getTeamRank(teamName) {
  var rankings = analysisData.rankings || {};
  var entry = rankings[teamName];
  if (entry && entry.rank) return entry.rank;

  // 从小组积分榜推算相对排名
  if (typeof worldCupData !== 'undefined' && worldCupData.matches) {
    var groupName = '';
    worldCupData.matches.forEach(function(m) {
      if (m.team1 === teamName || m.team2 === teamName) {
        if (m.group && m.group.indexOf('Group ') === 0) groupName = m.group;
      }
    });
    if (groupName && typeof computeStandings === 'function') {
      var table = computeStandings(groupName);
      for (var i = 0; i < table.length; i++) {
        if (table[i].name === teamName) {
          // 组内排名 × 4 ≈ 世界排名估算
          return Math.min(80, (i + 1) * 4 + 10);
        }
      }
    }
  }

  return 50;
}

function filterWC(matches) {
  var arr = matches || [];
  var wc = arr.filter(function(r) { return r.date >= '2026-06-11'; });
  return wc.length > 0 ? wc : arr;
}

// 从 worldCupData 动态补充世界杯比赛结果到 form 数据
function enrichFormWithWCResults(formData, teamName) {
  if (!worldCupData || !worldCupData.matches) return formData;
  var enriched = JSON.parse(JSON.stringify(formData || { formScore: 40, recent: [] }));
  if (!enriched.recent) enriched.recent = [];

  // 收集该队已完赛的世界杯比赛
  var wcResults = [];
  worldCupData.matches.forEach(function(m) {
    if (m.score1 == null || m.score2 == null) return;
    if (isPlaceholder(m.team1) || isPlaceholder(m.team2)) return;
    if (m.team1 !== teamName && m.team2 !== teamName) return;
    var isHome = m.team1 === teamName;
    var gf = isHome ? m.score1 : m.score2;
    var ga = isHome ? m.score2 : m.score1;
    var opp = isHome ? m.team2 : m.team1;
    wcResults.push({
      date: m.date,
      opponent: opp,
      oppRank: getTeamRank(opp),
      result: gf + '-' + ga,
      venue: isHome ? 'home' : 'away',
      comp: 'World Cup'
    });
  });

  // 按日期逆序排，插入到 recent 最前面
  wcResults.sort(function(a, b) { return b.date.localeCompare(a.date); });
  for (var i = wcResults.length - 1; i >= 0; i--) {
    // 去重：同日期+同对手不重复加
    var dup = enriched.recent.some(function(r) {
      return r.date === wcResults[i].date && r.opponent === wcResults[i].opponent;
    });
    if (!dup) enriched.recent.unshift(wcResults[i]);
  }

  return enriched;
}

function computeAvgGoals(formData) {
  var recents = filterWC(formData.recent);
  if (recents.length === 0) return 1.3;
  var total = 0, count = 0;
  for (var i = 0; i < recents.length; i++) {
    if (recents[i].result === '未赛') continue;
    var parts = recents[i].result.split('-');
    total += parseInt(parts[0]) || 0;
    count++;
  }
  return count > 0 ? total / count : 1.3;
}

function computeAvgConc(formData) {
  var recents = filterWC(formData.recent);
  if (recents.length === 0) return 1.3;
  var total = 0, count = 0;
  for (var i = 0; i < recents.length; i++) {
    if (recents[i].result === '未赛') continue;
    var parts = recents[i].result.split('-');
    total += parseInt(parts[1]) || 0;
    count++;
  }
  return count > 0 ? total / count : 1.3;
}

function computeFormMini(formData) {
  var recents = filterWC(formData.recent);
  if (recents.length === 0) return '';
  var html = '<span class="form-mini">';
  var count = Math.min(5, recents.length);
  for (var i = 0; i < count; i++) {
    var r = recents[i];
    if (r.result === '未赛') { html += '<span class="fm-dot fm-none"></span>'; continue; }
    var parts = r.result.split('-');
    var gf = parseInt(parts[0]), ga = parseInt(parts[1]);
    if (gf > ga) html += '<span class="fm-dot fm-win" title="' + r.result + ' vs ' + r.opponent + '">W</span>';
    else if (gf < ga) html += '<span class="fm-dot fm-loss" title="' + r.result + ' vs ' + r.opponent + '">L</span>';
    else html += '<span class="fm-dot fm-draw" title="' + r.result + ' vs ' + r.opponent + '">D</span>';
  }
  html += '</span>';
  return html;
}

function parseSquadValue(str) {
  var s = str.replace('€', '').replace('亿', '');
  return parseFloat(s) || 0.5;
}

function computeFormScore(formData, isTeam) {
  var score = formData.formScore || 50;
  var recents = formData.recent || [];
  var weighted = 0, totalWeight = 0;
  for (var i = 0; i < recents.length; i++) {
    var r = recents[i];
    var w = 1 + (recents.length - i) * 0.15;
    var base, oppW;
    if (r.result === '未赛') { base = 50; oppW = 1; }
    else {
      var parts = r.result.split('-');
      var gf = parseInt(parts[0]), ga = parseInt(parts[1]);
      if (gf > ga) { base = 85; oppW = 1 + (50 - r.oppRank) * 0.01; }
      else if (gf < ga) { base = 10; oppW = 1 - (50 - r.oppRank) * 0.008; }
      else { base = 45; oppW = 1 + (50 - r.oppRank) * 0.005; }
      if (r.venue === 'away') oppW *= 1.15;
      base += Math.min(15, (gf - ga) * 4); // goal difference bonus
    }
    weighted += base * Math.max(0.4, oppW) * w;
    totalWeight += w;
  }
  return totalWeight > 0 ? Math.round(weighted / totalWeight) : score;
}

function computeHostScore(team, opponent, stadium) {
  var hostCountries = ['美国', '加拿大', '墨西哥'];
  if (!stadium) return 7;
  var tRank = analysisData.rankings[team] || {};
  var oRank = analysisData.rankings[opponent] || {};

  if (tRank.conf === 'CONCACAF' && hostCountries.indexOf(stadium.country) !== -1) return 14;
  if (oRank.conf === 'CONCACAF' && hostCountries.indexOf(stadium.country) !== -1) return 1;
  // General: check if playing in own confederation region
  if (stadium.country === '墨西哥' && tRank.conf === 'CONCACAF') return 12;
  if (stadium.country === '加拿大' && tRank.conf === 'CONCACAF') return 12;
  if (stadium.country === '美国' && tRank.conf === 'CONCACAF') return 12;
  return 7;
}

function computeSituationScore(team, opponent, matchDate) {
  // Check if teams have matches and compute standing situation
  if (typeof worldCupData === 'undefined' || !worldCupData.matches) return 5;

  var tGroup = '', oGroup = '';
  var matches = worldCupData.matches;
  for (var i = 0; i < matches.length; i++) {
    if ((matches[i].team1 === team || matches[i].team2 === team) && matches[i].group && matches[i].group.indexOf('Group') === 0) {
      tGroup = matches[i].group;
    }
    if ((matches[i].team1 === opponent || matches[i].team2 === opponent) && matches[i].group && matches[i].group.indexOf('Group') === 0) {
      oGroup = matches[i].group;
    }
  }

  if (!tGroup || tGroup !== oGroup) return 5; // not a group match or different groups

  // Get standings
  var standings = typeof computeStandings === 'function' ? computeStandings() : {};
  var groupStandings = standings[tGroup] || [];

  var tPos = -1, oPos = -1, tPts = -1, oPts = -1, tPlayed = 0, oPlayed = 0;
  for (var j = 0; j < groupStandings.length; j++) {
    if (groupStandings[j].team === team) { tPos = j; tPts = groupStandings[j].pts; tPlayed = groupStandings[j].played || 0; }
    if (groupStandings[j].team === opponent) { oPos = j; oPts = groupStandings[j].pts; oPlayed = groupStandings[j].played || 0; }
  }

  // Situation boost: team that needs points more gets higher score
  var totalMatches = 3;
  var tRemain = totalMatches - tPlayed;
  var oRemain = totalMatches - oPlayed;

  // If team is ahead and almost through, good situation
  if (tPos === 0 && tPts >= 4 && oPts >= 0) return 8;
  // If team is struggling and must win
  if (tPos >= 2 && tRemain <= 1 && tPts <= 3) return 9;
  // Default: slight edge if higher position
  if (tPos < oPos) return 7;
  if (tPos > oPos) return 3;
  return 5;
}

// ---- Insight generation ----

function generateInsights(result) {
  var insights = [];
  var tf = result.teamForm, of = result.oppForm;
  var tRecents = filterWC(tf.recent), oRecents = filterWC(of.recent);
  var tName = typeof trTeam === 'function' ? trTeam(result.team) : result.team;
  var oName = typeof trTeam === 'function' ? trTeam(result.opponent) : result.opponent;

  // Recent form trend
  var tLast5 = tRecents.slice(0, 5);
  var tWins = 0, tLosses = 0, tGoals = 0, tConc = 0;
  var actualGames = 0;
  for (var i = 0; i < tLast5.length; i++) {
    var r = tLast5[i];
    if (r.result === '未赛') continue;
    actualGames++;
    var parts = r.result.split('-');
    var g1 = parseInt(parts[0]), g2 = parseInt(parts[1]);
    tGoals += g1;
    tConc += g2;
    if (g1 > g2) tWins++;
    if (g1 < g2) tLosses++;
  }
  var n = Math.max(1, actualGames);
  var tAvgGoals = actualGames > 0 ? tGoals / actualGames : 0;
  if (tWins >= 4 && tLosses === 0) {
    insights.push({ icon: '🔥', text: tName + '近' + n + '场' + tWins + '胜' + (n - tWins) + '平，状态极佳，场均' + tAvgGoals.toFixed(1) + '球' });
  } else if (tWins >= 3) {
    insights.push({ icon: '📈', text: tName + '近' + n + '场' + tWins + '胜，场均' + tAvgGoals.toFixed(1) + '球，势头良好' });
  } else if (tLosses >= 3) {
    insights.push({ icon: '⚠️', text: tName + '近' + n + '场' + tLosses + '败，状态低迷，需警惕' });
  }

  // Attacking power comparison
  var oLast5 = oRecents.slice(0, 5);
  var oConcTotal = 0, oConcCount = 0;
  for (var oi = 0; oi < oLast5.length; oi++) {
    if (oLast5[oi].result === '未赛') continue;
    oConcTotal += parseInt(oLast5[oi].result.split('-')[1]) || 0;
    oConcCount++;
  }
  var oAvgConc = oConcCount > 0 ? oConcTotal / oConcCount : 1.3;
  if (tAvgGoals >= 2.2 && oAvgConc >= 1.5) {
    insights.push({ icon: '⚽', text: tName + '场均进球' + tAvgGoals.toFixed(1) + '个，' + oName + '场均失球' + oAvgConc.toFixed(1) + '个，进攻端优势明显' });
  }

  // Clean sheet analysis
  var tCleanSheets = 0;
  for (var cs = 0; cs < tLast5.length; cs++) {
    if (tLast5[cs].result !== '未赛' && parseInt(tLast5[cs].result.split('-')[1]) === 0) tCleanSheets++;
  }
  if (tCleanSheets >= 3) {
    insights.push({ icon: '🛡️', text: tName + '近' + n + '场' + tCleanSheets + '次零封，防守稳固' });
  }

  // Over/under goals trend
  var totalGoals = tGoals + tConc;
  if (actualGames >= 3 && totalGoals / actualGames >= 3.0) {
    insights.push({ icon: '🎯', text: tName + '近' + n + '场比赛场均' + (totalGoals / actualGames).toFixed(1) + '球，大球趋势明显' });
  } else if (actualGames >= 3 && totalGoals / actualGames <= 1.5) {
    insights.push({ icon: '😴', text: tName + '近' + n + '场比赛场均仅' + (totalGoals / actualGames).toFixed(1) + '球，偏向小球' });
  }

  // Strong opponent quality
  var strongOpps = [];
  for (var j = 0; j < tRecents.length; j++) {
    if (tRecents[j].oppRank <= 15) strongOpps.push(tRecents[j]);
  }
  if (strongOpps.length > 0) {
    var sw = 0;
    for (var k = 0; k < strongOpps.length; k++) {
      if (strongOpps[k].result.split('-')[0] > strongOpps[k].result.split('-')[1]) sw++;
    }
    insights.push({ icon: '💪', text: tName + '近一年对阵TOP15球队' + strongOpps.length + '场，取得' + sw + '胜，抗强能力' + (sw >= strongOpps.length * 0.5 ? '出色' : '一般') });
  }

  // Squad value gap
  var tv = parseSquadValue(result.teamRank.squadValue);
  var ov = parseSquadValue(result.oppRank.squadValue);
  if (tv > ov * 3) {
    insights.push({ icon: '💰', text: tName + '全队身价€' + tv.toFixed(1) + '亿，是对手(€' + ov.toFixed(1) + '亿)的' + (tv / ov).toFixed(0) + '倍，纸面实力碾压' });
  } else if (ov > tv * 3) {
    insights.push({ icon: '💎', text: oName + '身价€' + ov.toFixed(1) + '亿远超' + tName + '(€' + tv.toFixed(1) + '亿)，但身价不决定一切' });
  }

  // Host advantage
  if (result.scores.host >= 12) {
    insights.push({ icon: '🏟️', text: tName + '享受主场东道主优势，球迷支持度极高' });
  }

  // Injury / suspension
  var injuries = analysisData.injuries || {};
  var tInj = injuries[result.team] || {};
  var oInj = injuries[result.opponent] || {};
  var tIssues = (tInj.injuries || 0) + (tInj.suspensions || 0);
  var oIssues = (oInj.injuries || 0) + (oInj.suspensions || 0);
  if (tIssues >= 2) {
    insights.push({ icon: '🏥', text: tName + '伤停' + tIssues + '人' + (tInj.note ? '（' + tInj.note + '）' : '') + '，战力受损需留意' });
  }
  if (oIssues >= 1 && tIssues < 2) {
    insights.push({ icon: '🩹', text: oName + '伤停' + oIssues + '人，' + tName + '有机可乘' });
  }

  // Only show top 5 insights
  return insights.slice(0, 5);
}

// ---- Render ----

function renderAnalysis() {
  var container = document.getElementById('analysis-content');
  if (!container) return;

  if (Object.keys(analysisData).length === 0) {
    container.innerHTML = '<div class="spinner"></div>';
    loadAnalysisData().then(function() {
      renderAnalysis();
    }).catch(function(err) {
      container.innerHTML = '<div class="analysis-empty">' + t('analysisLoadFailed') + '<br><small>' + t('analysisRetry') + ' <a href="javascript:renderAnalysis()">' + t('analysisClickRetry') + '</a></small></div>';
    });
    return;
  }

  if (typeof worldCupData === 'undefined' || !worldCupData.matches || worldCupData.matches.length === 0) {
    container.innerHTML = '<div class="analysis-empty">' + t('analysisNoSchedule') + '</div>';
    return;
  }

  // 用最新的 ESPN 实时停赛数据更新分析数据
  if (typeof worldCupSuspensions !== 'undefined' && worldCupSuspensions && Object.keys(worldCupSuspensions).length > 0) {
    analysisData.injuries = mergeInjuryAndSuspensionData(analysisData.injuries || {}, worldCupSuspensions);
  }

  var matches = [];
  if (typeof worldCupData !== 'undefined' && worldCupData.matches) {
    matches = worldCupData.matches.filter(function(m) {
      return m.group && m.group.indexOf('Group') === 0 && !isPlaceholder(m.team1) && !isPlaceholder(m.team2);
    });
  }

  // Only show matches from next available dates (today onwards or upcoming)
  var today = new Date();
  var todayStr = today.toISOString().substring(0, 10);

  var upcoming = [];
  var past = [];
  for (var i = 0; i < matches.length; i++) {
    if (matches[i].date >= todayStr) {
      upcoming.push(matches[i]);
    } else {
      past.push(matches[i]);
    }
  }

  // Sort upcoming by date
  upcoming.sort(function(a, b) { return a.date.localeCompare(b.date) || a.time.localeCompare(b.time); });
  past.sort(function(a, b) { return b.date.localeCompare(a.date); });

  // Take next 16 upcoming matches
  var target = upcoming.slice(0, 16);
  if (target.length < 6) {
    target = target.concat(past.slice(0, 16 - target.length));
  }

  var html = '';

  if (target.length === 0) {
    container.innerHTML = '<div class="analysis-empty">' + t('analysisNoMatches') + '</div>';
    return;
  }

  html += '<div class="analysis-header">';
  html += '<h2>' + t('analysisTitle') + '</h2>';
  html += '<p class="analysis-subtitle">' + t('analysisSubtitle') + '</p>';
  html += '</div>';

  html += '<div class="analysis-info-bar">';
  html += '<span>' + t('analysisMatchCount').replace('{count}', target.length) + '</span>';
  html += '<span class="analysis-model-badge">' + t('analysisModel') + '</span>';
  html += '</div>';

  for (var j = 0; j < target.length; j++) {
    var m = target[j];
    var result = computeMatchScore(m.team1, m.team2, m.ground, m.date);
    result.ground = m.ground;
    result.matchInfo = m;
    var insights = generateInsights(result);

    html += renderAnalysisCard(result, insights, m, j);
  }

  // Recommendations at the bottom
  html += renderAnalysisRecommendations(target);

  container.innerHTML = html;
}

function renderAnalysisCard(result, insights, m, idx) {
  var tScore = result.teamTotal;
  var oScore = result.oppTotal;
  var gap = result.gap;
  var gapLevel = gap >= 25 ? '★★★ ' + t('analysisClearEdge') : (gap >= 12 ? '★★☆ ' + t('analysisEdge') : '★☆☆ ' + t('analysisClose'));

  var homeFlag = typeof getFlagImg === 'function' ? getFlagImg(result.team) : '';
  var awayFlag = typeof getFlagImg === 'function' ? getFlagImg(result.opponent) : '';

  var tl = result.teamRank;
  var ol = result.oppRank;
  var tName = (typeof currentLang !== 'undefined' && currentLang === 'zh' && typeof TEAM_ZH !== 'undefined' && TEAM_ZH[result.team]) ? TEAM_ZH[result.team] : result.team;
  var oName = (typeof currentLang !== 'undefined' && currentLang === 'zh' && typeof TEAM_ZH !== 'undefined' && TEAM_ZH[result.opponent]) ? TEAM_ZH[result.opponent] : result.opponent;
  var tFormMini = typeof computeFormMini === 'function' ? computeFormMini(result.teamForm) : '';
  var oFormMini = typeof computeFormMini === 'function' ? computeFormMini(result.oppForm) : '';

  var html = '<div class="analysis-card">';

  // Header
  html += '<div class="analysis-card-header">';
  html += '<div class="analysis-match-id">' + m.round + ' · ' + m.date + ' ' + (m.time ? m.time.substring(0, 5) : '') + '</div>';
  html += '<div class="analysis-teams">';
  html += '<div class="analysis-team home-team">' + homeFlag + '<span>' + tName + '</span></div>';
  html += '<span class="analysis-vs">VS</span>';
  html += '<div class="analysis-team away-team">' + awayFlag + '<span>' + oName + '</span></div>';
  html += '</div>';
  html += '<div class="analysis-form-row"><div class="analysis-form-side">' + tFormMini + '</div><div class="analysis-form-side">' + oFormMini + '</div></div>';
  if (m.group) html += '<div class="analysis-group-tag">' + m.group + ' · ' + m.ground + '</div>';
  else html += '<div class="analysis-group-tag">' + t(roundKey(m.round)) + ' · ' + m.ground + '</div>';
  html += '</div>';

  // Overall score bar
  html += '<div class="analysis-score-section">';
  html += '<div class="analysis-score-row">';
  html += '<span class="analysis-score-num">' + tScore + '</span>';
  html += '<div class="analysis-score-bar-wrap">';
  html += '<div class="analysis-score-bar"><div class="analysis-score-fill" style="width:' + tScore + '%"></div></div>';
  html += '<div class="analysis-score-label">' + gapLevel + '</div>';
  html += '</div>';
  html += '<span class="analysis-score-num">' + oScore + '</span>';
  html += '</div>';
  html += '<div class="analysis-gap-text">' + t('analysisGap') + ': ' + gap + ' ' + t('analysisPoints') + '</div>';
  html += '</div>';

  // Dimension breakdown
  html += '<div class="analysis-dims">';
  html += renderDimRow(t('analysisRanking'), tl.rank, ol.rank, result.scores.ranking, 20, tl.rank < ol.rank);
  html += renderDimRow(t('analysisForm'), result.teamForm.formScore, result.oppForm.formScore, result.scores.form, 25, result.teamForm.formScore > result.oppForm.formScore);
  html += renderDimRow(t('analysisSquad'), tl.squadValue, ol.squadValue, result.scores.squad, 10, parseSquadValue(tl.squadValue) > parseSquadValue(ol.squadValue));
  html += renderDimRow(t('analysisAttack'), (typeof computeAvgGoals==='function'?computeAvgGoals(result.teamForm).toFixed(1):'-') + '球/场', (typeof computeAvgGoals==='function'?computeAvgGoals(result.oppForm).toFixed(1):'-') + '球/场', result.scores.attack, 10, result.scores.attack > 5);
  html += renderDimRow(t('analysisDefense'), (typeof computeAvgConc==='function'?computeAvgConc(result.teamForm).toFixed(1):'-') + '失/场', (typeof computeAvgConc==='function'?computeAvgConc(result.oppForm).toFixed(1):'-') + '失/场', result.scores.defense, 10, result.scores.defense > 5);
  html += renderDimRow(t('analysisHost'), '-', '-', result.scores.host, 15, result.scores.host > 7);
  html += renderDimRow(t('analysisSituation'), '-', '-', result.scores.situation, 10, result.scores.situation > 5);
  var tInjDisplay = '-', oInjDisplay = '-';
  if (typeof analysisData !== 'undefined' && analysisData.injuries) {
    var injT = analysisData.injuries[result.team] || {};
    var injO = analysisData.injuries[result.opponent] || {};
    var tIssues = (injT.injuries || 0) + (injT.suspensions || 0);
    var oIssues = (injO.injuries || 0) + (injO.suspensions || 0);
    tInjDisplay = tIssues > 0 ? '伤停' + tIssues + '人' : '全员健康';
    oInjDisplay = oIssues > 0 ? '伤停' + oIssues + '人' : '全员健康';
  }
  html += renderDimRow(t('analysisInjury'), tInjDisplay, oInjDisplay, result.scores.injury, 5, result.scores.injury > 2.5);
  html += '</div>';

  // Insights
  html += '<div class="analysis-insights">';
  html += '<div class="analysis-insights-title">' + t('analysisKeyInsights') + '</div>';
  for (var i = 0; i < insights.length; i++) {
    html += '<div class="analysis-insight-item"><span class="insight-icon">' + insights[i].icon + '</span> ' + insights[i].text + '</div>';
  }
  html += '</div>';

  // Odds reference (if lottery data available)
  if (typeof lotteryData !== 'undefined' && lotteryData && lotteryData._matches) {
    var lm = lotteryData._matches;
    for (var k = 0; k < lm.length; k++) {
      var lh = TEAM_ZH_REVERSE[lm[k].homeTeam] || lm[k].homeTeamEn;
      var la = TEAM_ZH_REVERSE[lm[k].awayTeam] || lm[k].awayTeamEn;
      if ((lh === result.team && la === result.opponent) || (lh === result.opponent && la === result.team)) {
        var had = lm[k].pools.HAD;
        if (had) {
          html += '<div class="analysis-odds-ref">';
          html += '<span class="odds-ref-label">' + t('lotteryHAD') + '</span>';
          html += '<span class="odds-ref-val">' + t('lotteryHome') + ' ' + had.h.toFixed(2) + '</span>';
          html += '<span class="odds-ref-val">' + t('lotteryDraw') + ' ' + had.d.toFixed(2) + '</span>';
          html += '<span class="odds-ref-val">' + t('lotteryAway') + ' ' + had.a.toFixed(2) + '</span>';
          html += '<span class="odds-ref-verdict">' + oddsVerdict(result, had) + '</span>';
          html += '</div>';
        }
        break;
      }
    }
  }

  // 赛前预测概率
  var pred = computePrediction(result, m);
  html += '<div class="analysis-prediction">';
  html += '<div class="pred-title">' + t('predTitle') + '</div>';
  html += '<div class="pred-bar-wrap"><div class="pred-bar">';
  html += '<div class="pred-fill pred-fill-t" style="width:' + pred.teamProb + '%">' + (pred.teamProb >= 15 ? result.team + ' ' + pred.teamProb + '%' : '') + '</div>';
  html += '<div class="pred-fill pred-fill-d" style="width:' + pred.drawProb + '%">' + (pred.drawProb >= 12 ? t('lotteryDraw') + ' ' + pred.drawProb + '%' : '') + '</div>';
  html += '<div class="pred-fill pred-fill-o" style="width:' + pred.oppProb + '%">' + (pred.oppProb >= 15 ? result.opponent + ' ' + pred.oppProb + '%' : '') + '</div>';
  html += '</div></div>';
  html += '<div class="pred-legend">';
  html += '<span class="pred-dot pred-dot-t"></span>' + result.team + ' ' + pred.teamProb + '%';
  html += '<span class="pred-dot pred-dot-d"></span>' + t('lotteryDraw') + ' ' + pred.drawProb + '%';
  html += '<span class="pred-dot pred-dot-o"></span>' + result.opponent + ' ' + pred.oppProb + '%';
  html += '</div>';
  html += '<div class="pred-verdict">' + pred.verdict + '</div>';
  html += '<div class="pred-scores">';
  html += '<span class="pred-score-label">' + t('predScore') + '</span>';
  html += '<span class="pred-score-val">' + pred.score1 + '</span><span class="pred-score-pct">' + pred.score1Pct + '%</span>';
  html += '<span class="pred-score-val">' + pred.score2 + '</span><span class="pred-score-pct">' + pred.score2Pct + '%</span>';
  html += '</div>';
  if (pred.hasMarket) {
    html += '<div class="pred-source">' + t('predSource') + '</div>';
  }
  html += '</div>';

  html += '</div>';
  return html;
}

function renderDimRow(label, tVal, oVal, score, maxScore, tEdge) {
  var pct = Math.round(score / maxScore * 100);
  var barColor = pct >= 70 ? 'dim-green' : (pct >= 45 ? 'dim-yellow' : 'dim-red');
  return '<div class="analysis-dim-row">' +
    '<span class="dim-label">' + label + '</span>' +
    '<span class="dim-val dim-val-left ' + (tEdge ? 'dim-edge' : '') + '">' + tVal + '</span>' +
    '<div class="dim-bar-wrap"><div class="dim-bar ' + barColor + '" style="width:' + pct + '%"></div></div>' +
    '<span class="dim-val dim-val-right ' + (!tEdge ? 'dim-edge' : '') + '">' + oVal + '</span>' +
  '</div>';
}

function oddsVerdict(result, had) {
  var tOdds = had.h, drawOdds = had.d, oppOdds = had.a;
  var gap = result.gap;

  if (gap > 20 && tOdds < 1.50) return '▸ ' + t('analysisOddsMatch');
  if (gap > 15 && tOdds < 1.80) return '▸ ' + t('analysisOddsMostlyMatch');
  if (gap > 10 && tOdds > 2.50) return '▸ ' + t('analysisOddsValue');
  if (gap < -10 && tOdds < 2.00) return '▸ ' + t('analysisOddsCaution');
  return '▸ ' + t('analysisOddsNormal');
}

// ---- Analysis-based recommendations ----

function renderAnalysisRecommendations(target) {
  // Score all target matches
  var scored = [];
  for (var i = 0; i < target.length; i++) {
    var m = target[i];
    var result = computeMatchScore(m.team1, m.team2, m.ground, m.date);
    result.matchInfo = m;
    scored.push(result);
  }

  // Find safe bets: high gap + low HAD odds
  var safeBets = [];
  var valueBets = [];
  var upsetAlerts = [];
  var closeGames = [];

  for (var j = 0; j < scored.length; j++) {
    var s = scored[j];
    var lm = null;
    if (typeof lotteryData !== 'undefined' && lotteryData && lotteryData._matches) {
      for (var k = 0; k < lotteryData._matches.length; k++) {
        var lh = TEAM_ZH_REVERSE[lotteryData._matches[k].homeTeam] || lotteryData._matches[k].homeTeamEn;
        var la = TEAM_ZH_REVERSE[lotteryData._matches[k].awayTeam] || lotteryData._matches[k].awayTeamEn;
        if ((lh === s.team && la === s.opponent) || (lh === s.opponent && la === s.team)) {
          lm = lotteryData._matches[k]; break;
        }
      }
    }

    if (s.gap >= 25 && lm && lm.pools.HAD && lm.pools.HAD.h < 1.50) {
      safeBets.push({ result: s, lottery: lm });
    } else if (s.gap >= 10 && lm && lm.pools.HAD && lm.pools.HAD.h > 2.00 && lm.pools.HAD.h < 3.50) {
      valueBets.push({ result: s, lottery: lm });
    } else if (s.gap <= 5 && lm && lm.pools.HAD) {
      closeGames.push({ result: s, lottery: lm });
    } else if (s.gap < 0 && s.gap > -10 && lm && lm.pools.HAD && lm.pools.HAD.h < 1.80) {
      upsetAlerts.push({ result: s, lottery: lm });
    }
  }

  if (safeBets.length + valueBets.length + closeGames.length === 0) return '';

  var html = '<div class="analysis-recommendations">';
  html += '<div class="analysis-rec-header">' + t('analysisRecommendations') + '</div>';

  // Safe bets
  if (safeBets.length >= 2) {
    html += '<div class="analysis-rec-card rec-safe">';
    html += '<div class="rec-card-type">⭐ ' + t('analysisSafeBet') + ' 2' + t('analysisParlayUnit') + '</div>';
    var sb1 = safeBets[0], sb2 = safeBets[1];
    var combinedOdds = (sb1.lottery.pools.HAD.h * sb2.lottery.pools.HAD.h);
    html += '<div class="rec-card-legs">';
    html += renderRecLeg(sb1, true);
    html += renderRecLeg(sb2, true);
    html += '</div>';
    html += '<div class="rec-card-footer">';
    html += '<span>' + t('analysisCombinedOdds') + ': ' + combinedOdds.toFixed(2) + '</span>';
    html += '<span>' + t('lotteryEstimated') + ': ¥' + (combinedOdds * 2).toFixed(2) + '（1' + t('lotteryMultiplier') + '）</span>';
    html += '<button class="rec-follow-btn" onclick="followRecommendation([' + safeBets[0].lottery.matchNum + ',' + safeBets[1].lottery.matchNum + '])">' + t('analysisFollow') + '</button>';
    html += '</div></div>';
  }

  // Value bets
  if (valueBets.length >= 2) {
    html += '<div class="analysis-rec-card rec-value">';
    html += '<div class="rec-card-type">💎 ' + t('analysisValueBet') + ' 2' + t('analysisParlayUnit') + '</div>';
    var vb1 = valueBets[0], vb2 = valueBets[1];
    var vOdds = (vb1.lottery.pools.HAD.h * vb2.lottery.pools.HAD.h);
    html += '<div class="rec-card-legs">';
    html += renderRecLeg(vb1, true);
    html += renderRecLeg(vb2, true);
    html += '</div>';
    html += '<div class="rec-card-footer">';
    html += '<span>' + t('analysisCombinedOdds') + ': ' + vOdds.toFixed(2) + '</span>';
    html += '<span>' + t('lotteryEstimated') + ': ¥' + (vOdds * 2).toFixed(2) + '（1' + t('lotteryMultiplier') + '）</span>';
    html += '</div></div>';
  }

  // Close/fun games
  if (closeGames.length > 0) {
    html += '<div class="analysis-rec-card rec-fun">';
    html += '<div class="rec-card-type">🎯 ' + t('analysisFunBet') + '</div>';
    html += '<div class="rec-card-legs">';
    for (var c = 0; c < Math.min(3, closeGames.length); c++) {
      html += renderRecLeg(closeGames[c], false);
    }
    html += '</div>';
    html += '</div>';
  }

  // Upset alerts
  if (upsetAlerts.length > 0) {
    html += '<div class="analysis-rec-card rec-upset">';
    html += '<div class="rec-card-type">⚠️ ' + t('analysisUpsetAlert') + '</div>';
    html += '<div class="rec-card-legs">';
    for (var u = 0; u < Math.min(2, upsetAlerts.length); u++) {
      html += renderRecLeg(upsetAlerts[u], false);
    }
    html += '</div>';
    html += '</div>';
  }

  html += '</div>';
  return html;
}

function renderRecLeg(item, showOdds) {
  var r = item.result;
  var lm = item.lottery;
  var tName = (typeof currentLang !== 'undefined' && currentLang === 'zh' && typeof TEAM_ZH !== 'undefined' && TEAM_ZH[r.team]) ? TEAM_ZH[r.team] : r.team;
  var oName = (typeof currentLang !== 'undefined' && currentLang === 'zh' && typeof TEAM_ZH !== 'undefined' && TEAM_ZH[r.opponent]) ? TEAM_ZH[r.opponent] : r.opponent;
  var flag = typeof getFlagImg === 'function' ? getFlagImg(r.team) : '';

  var html = '<div class="rec-leg">';
  html += flag + '<span class="rec-leg-team">' + tName + ' vs ' + oName + '</span>';
  html += '<span class="rec-leg-pick">' + t('lotteryHome') + '</span>';
  if (showOdds && lm && lm.pools.HAD) {
    html += '<span class="rec-leg-odds">@' + lm.pools.HAD.h.toFixed(2) + '</span>';
  }
  html += '<span class="rec-leg-score">' + t('analysisScore') + ' ' + r.teamTotal + '</span>';
  html += '</div>';
  return html;
}

function followRecommendation(matchNums) {
  if (typeof switchTab !== 'function') return;
  switchTab('lottery');

  setTimeout(function() {
    lotterySelected = [];
    for (var i = 0; i < matchNums.length; i++) {
      var m = typeof findMatch === 'function' ? findMatch(matchNums[i]) : null;
      if (m && m.pools.HAD) {
        var tName = (typeof currentLang !== 'undefined' && currentLang === 'zh') ? m.homeTeam : m.homeTeamEn;
        var oName = (typeof currentLang !== 'undefined' && currentLang === 'zh') ? m.awayTeam : m.awayTeamEn;
        lotterySelected.push({
          matchNum: matchNums[i], pool: 'HAD', option: 'h', odds: m.pools.HAD.h,
          matchLabel: tName + ' vs ' + oName,
          poolLabel: 'lotteryHAD', optionLabel: 'lotteryHome'
        });
      }
    }
    if (typeof renderLottery === 'function') renderLottery();
  }, 200);
}

// Compact recommendations for lottery tab
function renderLotteryRecs(lotteryMatches) {
  var scored = [];
  for (var i = 0; i < lotteryMatches.length; i++) {
    var lm = lotteryMatches[i];
    var result = computeMatchScore(lm.homeTeamEn, lm.awayTeamEn, lm.ground, lm.matchDate);
    result.lottery = lm;
    scored.push(result);
  }

  // Find safe bets
  var safeBets = [];
  for (var j = 0; j < scored.length; j++) {
    var s = scored[j];
    var had = s.lottery.pools.HAD;
    if (s.gap >= 20 && had && had.h < 1.50) {
      safeBets.push(s);
    }
  }

  if (safeBets.length < 2) return '';

  var html = '<div class="lottery-recs">';
  html += '<div class="lottery-recs-title">⭐ ' + t('analysisRecommendations') + '</div>';
  html += '<div class="lottery-recs-list">';

  // Safe 2-parlay
  var best2 = safeBets.slice(0, 2);
  var combOdds = (best2[0].lottery.pools.HAD.h * best2[1].lottery.pools.HAD.h);
  html += '<div class="lottery-rec-item" onclick="followRecommendation([' + best2[0].lottery.matchNum + ',' + best2[1].lottery.matchNum + '])">';
  html += '<span class="lottery-rec-type">' + t('analysisSafeBet') + ' 2' + t('analysisParlayUnit') + '</span>';
  html += '<span class="lottery-rec-teams">' + best2[0].lottery.homeTeam + ' + ' + best2[1].lottery.homeTeam + '</span>';
  html += '<span class="lottery-rec-odds">@' + combOdds.toFixed(2) + '</span>';
  html += '<span class="lottery-rec-action">' + t('analysisFollow') + ' →</span>';
  html += '</div>';

  html += '</div></div>';
  return html;
}
