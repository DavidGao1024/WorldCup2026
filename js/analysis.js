// js/analysis.js
var analysisData = {};

function loadAnalysisData() {
  return Promise.all([
    fetch('data/fifa-rankings.json').then(function(r) { return r.json(); }),
    fetch('data/team-form.json').then(function(r) { return r.json(); }),
    fetch('data/stadiums.json').then(function(r) { return r.json(); }),
    fetch('data/injuries.json').then(function(r) { return r.json(); }).catch(function() { return {}; }),
    fetch('data/player-importance.json').then(function(r) { return r.json(); }).catch(function() { return {}; }),
    fetch('data/stadiums-climate.json').then(function(r) { return r.json(); }).catch(function() { return {}; }),
    fetch('data/rotation-analysis.json').then(function(r) { return r.json(); }).catch(function() { return {}; })
  ]).then(function(results) {
    analysisData.rankings = results[0];
    analysisData.forms = results[1];
    analysisData.stadiums = results[2];
    analysisData.rawInjuries = results[3];
    analysisData.playerImportance = results[4];
    analysisData.injuries = mergeInjuryAndSuspensionData(
      results[3],
      (typeof worldCupSuspensions !== 'undefined' && worldCupSuspensions) ? worldCupSuspensions : {},
      results[4]
    );
    analysisData.stadiumClimate = results[5];
    analysisData.rotation = results[6];
    // v10: 裁判维度移除,refereeDB/refereeAssign 留空壳避免其它代码 ReferenceError
    analysisData.refereeDB = {};
    analysisData.refereeAssign = [];
    return analysisData;
  });
}

// 合并伤病数据（injuries.json v2 球员级格式）和停赛数据（ESPN），计算加权 impact
// importanceData 来自 player-importance.json，用于 ESPN 停赛球员的 importance 查表
function mergeInjuryAndSuspensionData(injuryData, suspensionData, importanceData) {
  var merged = {};
  var allTeams = {};
  Object.keys(injuryData || {}).forEach(function(t) { allTeams[t] = true; });
  Object.keys(suspensionData || {}).forEach(function(t) { allTeams[t] = true; });

  function stripAccents(s) { return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }

  function lookupImportance(impMap, name) {
    if (!impMap || !name) return 3;
    if (impMap[name] != null) return impMap[name];
    var stripped = stripAccents(name);
    if (stripped !== name && impMap[stripped] != null) return impMap[stripped];
    return 3;
  }

  Object.keys(allTeams).forEach(function(team) {
    if (team === 'updateTime' || team === 'source' || team === 'note' || team === '_note' || team === '_format') return;
    var inj = injuryData[team] || { injuries: 0, suspensions: 0, players: [], note: '' };
    var sus = suspensionData[team] || { suspensions: 0, suspendedPlayers: [], note: '' };
    var impMap = (importanceData || {})[team] || {};

    var impact = 0;
    var allAffected = [];

    // 伤病（来自 injuries.json v2 球员级数据）
    if (inj.players && inj.players.length > 0) {
      inj.players.forEach(function(p) {
        var imp = p.importance || 3;
        var mult = (p.status === 'out') ? 1.0 : 0.5;
        var pi = imp * mult;
        impact += pi;
        allAffected.push({ name: p.name, importance: imp, status: p.status, detail: p.detail || '', impact: pi, source: 'injury' });
      });
    } else if (inj.injuries > 0) {
      // 旧格式兼容：按每伤 2.25 估算
      impact += inj.injuries * 2.25;
    }

    // 停赛（来自 ESPN，确定缺阵，mult=1.0）
    var suspendedPlayers = sus.suspendedPlayers || [];
    suspendedPlayers.forEach(function(sp) {
      var imp = lookupImportance(impMap, sp.name);
      var pi = imp * 1.0;
      impact += pi;
      allAffected.push({ name: sp.name, importance: imp, status: 'out', detail: sp.reason || '', impact: pi, source: 'suspension' });
    });

    // 额外计入旧 injuries.json 中手动标的 suspensions 字段
    var extraSus = (inj.suspensions || 0) + (sus.suspensions || 0) - suspendedPlayers.length;
    if (extraSus > 0) impact += extraSus * 3;

    impact = Math.min(20, Math.round(impact * 10) / 10);

    var notes = [];
    if (inj.note) notes.push(inj.note);
    if (sus.note) notes.push(sus.note);

    merged[team] = {
      injuries: inj.players ? inj.players.filter(function(p) { return p.status === 'out'; }).length : (inj.injuries || 0),
      suspensions: suspendedPlayers.length,
      impact: impact,
      affectedPlayers: allAffected,
      suspendedPlayers: suspendedPlayers,
      injuryNote: inj.note || '',
      suspensionNote: sus.note || '',
      note: notes.filter(Boolean).join('; ')
    };
  });

  return merged;
}

// ---- Scoring engine ----

// 历史交锋评分 (10 pts) — 基于近5年两队相互交锋记录
// 数据源: ESPN summary.headToHeadGames,缓存于 analysisData.h2h[key]
// 评分逻辑: 净胜率(队A胜率-负率) × 5 + 5(中性),范围 [0, 10]
// 时间衰减: 近2年权重 1.0,2-5年权重 0.5
function computeH2HScore(team, opponent) {
  if (!analysisData.h2h) return 5;
  var key = [team, opponent].sort().join('|');
  var cached = analysisData.h2h[key];
  if (!cached || !cached.games || !cached.games.length) return 5;

  var now = new Date();
  var fiveYearsAgo = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());
  var twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());

  var wW = 0, dW = 0, lW = 0, totalW = 0;

  for (var i = 0; i < cached.games.length; i++) {
    var g = cached.games[i];
    if (!g.date) continue;
    var gd = new Date(g.date);
    if (isNaN(gd.getTime())) continue;
    if (gd < fiveYearsAgo) continue;

    var weight = gd >= twoYearsAgo ? 1.0 : 0.5;

    // g.result 是从 cached.teamA 视角的 W/D/L
    var result;
    if (cached.teamA === team) {
      result = g.result;
    } else if (cached.teamA === opponent) {
      result = g.result === 'W' ? 'L' : (g.result === 'L' ? 'W' : 'D');
    } else {
      continue;
    }
    if (!result) continue;

    totalW += weight;
    if (result === 'W') wW += weight;
    else if (result === 'D') dW += weight;
    else lW += weight;
  }

  if (totalW === 0) return 5;
  var netWinRate = (wW - lW) / totalW;
  var score = 5 + netWinRate * 5;
  return Math.max(0, Math.min(10, Math.round(score)));
}

// 后台预取未开赛比赛的 H2H 数据(用于在 renderAnalysis 时填充 analysisData.h2h)
function prefetchH2HForUpcoming() {
  if (typeof worldCupData === 'undefined' || !worldCupData.matches) return;
  if (typeof findEspnEventId !== 'function' || typeof fetchMatchSummary !== 'function') return;

  analysisData.h2h = analysisData.h2h || {};

  var upcoming = worldCupData.matches.filter(function(m) {
    if (m.score1 != null && m.score2 != null) return false;
    if (typeof isPlaceholder === 'function' && (isPlaceholder(m.team1) || isPlaceholder(m.team2))) return false;
    return true;
  });

  var fetched = 0;
  var scheduled = false;
  function scheduleRerender() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(function() {
      scheduled = false;
      if (document.getElementById('analysis-content')) renderAnalysis();
    }, 800);
  }

  upcoming.slice(0, 10).forEach(function(m) {
    var eventId = findEspnEventId(m);
    if (!eventId) return;
    fetchMatchSummary(eventId).then(function(summary) {
      if (!summary || !summary.h2h) return;
      fetched++;
      // fetchMatchSummary 已经把 H2H 写入 analysisData.h2h
      scheduleRerender();
    });
  });
}

// H2H 维度的 UI 文案：返回 {t, o} 两队各自的"近X场 Y胜Z平W负"
// 5年内有交锋 → 显示近期战绩; 5年内无 → 显示历史战绩(标"X年未交手")
function buildH2HDetail(team, opponent, tName, oName) {
  if (!analysisData.h2h) return { t: '-', o: '-' };
  var key = [team, opponent].sort().join('|');
  var cached = analysisData.h2h[key];
  if (!cached || !cached.games || !cached.games.length) return { t: '无数据', o: '无数据' };

  var now = new Date();
  var fiveYearsAgo = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());

  var tW5 = 0, tD5 = 0, tL5 = 0;
  var tWAll = 0, tDAll = 0, tLAll = 0;
  var latestDate = null;
  for (var i = 0; i < cached.games.length; i++) {
    var g = cached.games[i];
    if (!g.date) continue;
    var gd = new Date(g.date);
    if (isNaN(gd.getTime())) continue;
    var result;
    if (cached.teamA === team) result = g.result;
    else if (cached.teamA === opponent) result = g.result === 'W' ? 'L' : (g.result === 'L' ? 'W' : 'D');
    else continue;
    if (!result) continue;
    if (result === 'W') { tWAll++; if (gd >= fiveYearsAgo) tW5++; }
    else if (result === 'D') { tDAll++; if (gd >= fiveYearsAgo) tD5++; }
    else { tLAll++; if (gd >= fiveYearsAgo) tL5++; }
    if (!latestDate || gd > latestDate) latestDate = gd;
  }

  var total5 = tW5 + tD5 + tL5;
  var totalAll = tWAll + tDAll + tLAll;
  if (total5 > 0) {
    return {
      t: '近' + total5 + '场 ' + tW5 + '胜' + tD5 + '平' + tL5 + '负',
      o: '近' + total5 + '场 ' + tL5 + '胜' + tD5 + '平' + tW5 + '负'
    };
  }
  if (totalAll > 0) {
    var yearsAgo = latestDate ? Math.floor((now - latestDate) / (365.25 * 24 * 3600 * 1000)) : 0;
    var yearsLabel = yearsAgo > 0 ? yearsAgo + '年未交手·' : '';
    return {
      t: yearsLabel + '历史' + totalAll + '场 ' + tWAll + '胜' + tDAll + '平' + tLAll + '负',
      o: yearsLabel + '历史' + totalAll + '场 ' + tLAll + '胜' + tDAll + '平' + tWAll + '负'
    };
  }
  return { t: '无交锋记录', o: '无交锋记录' };
}

// H2H insight 文本洞察（只对有显著差距的 H2H 输出）
function buildH2HInsight(team, opponent, tName, oName) {
  if (!analysisData.h2h) return null;
  var key = [team, opponent].sort().join('|');
  var cached = analysisData.h2h[key];
  if (!cached || !cached.games || !cached.games.length) return null;

  var now = new Date();
  var fiveYearsAgo = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());
  var twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());

  var tW = 0, tD = 0, tL = 0, recent = [];
  for (var i = 0; i < cached.games.length; i++) {
    var g = cached.games[i];
    if (!g.date) continue;
    var gd = new Date(g.date);
    if (isNaN(gd.getTime()) || gd < fiveYearsAgo) continue;
    var result;
    if (cached.teamA === team) result = g.result;
    else if (cached.teamA === opponent) result = g.result === 'W' ? 'L' : (g.result === 'L' ? 'W' : 'D');
    else continue;
    if (!result) continue;
    if (result === 'W') tW++;
    else if (result === 'D') tD++;
    else tL++;
    if (gd >= twoYearsAgo) recent.push({ result: result, date: g.date, score: g.score, competition: g.competition });
  }

  var total = tW + tD + tL;
  if (total === 0) return null;

  var tNameLocal = (typeof TEAM_ZH !== 'undefined' && TEAM_ZH[team]) ? TEAM_ZH[team] : tName;
  var oNameLocal = (typeof TEAM_ZH !== 'undefined' && TEAM_ZH[opponent]) ? TEAM_ZH[opponent] : oName;

  // 显著差距阈值：胜率差 >= 33%（近5场至少2场净胜差）
  var netRate = (tW - tL) / total;
  if (Math.abs(netRate) < 0.33) return null;

  var stronger = netRate > 0 ? tNameLocal : oNameLocal;
  var sw = netRate > 0 ? tW : tL;
  var sl = netRate > 0 ? tL : tW;
  var recentTxt = '';
  if (recent.length > 0) {
    var last = recent[recent.length - 1] || recent[0];
    recentTxt = '，最近一次(' + (last.date || '') + (last.competition ? ' ' + last.competition : '') + (last.score ? ' ' + last.score : '') + ')';
  }
  return {
    icon: '🤝',
    text: '近5年交锋' + total + '场，' + stronger + sw + '胜' + tD + '平' + sl + '负，心理占优' + recentTxt
  };
}

function computeMatchScore(team, opponent, ground, matchDate, kickoffTime) {
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
  var stadiumClimate = (analysisData.stadiumClimate || {})[ground] || {
    tempJune: { low: 15, high: 25, avg: 20 }, tempJuly: { low: 15, high: 25, avg: 20 },
    humidity: 'moderate', indoor: false, heatCategory: 'moderate'
  };

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

  // 8. Injuries & suspensions (12 pts) — v8 球员级加权
  var tInj = injuries[team] || { impact: 0, injuries: 0, suspensions: 0 };
  var oInj = injuries[opponent] || { impact: 0, injuries: 0, suspensions: 0 };
  var tImpact = (tInj.impact != null) ? tInj.impact : (tInj.injuries * 2.25 + tInj.suspensions * 3);
  var oImpact = (oInj.impact != null) ? oInj.impact : (oInj.injuries * 2.25 + oInj.suspensions * 3);
  scores.injury = Math.round(Math.max(0, Math.min(12, 6 + (oImpact - tImpact) * 0.4)));

  // 10. 裁判影响 — v10 已移除（覆盖率低、SF 阶段缺数据、影响边际）

  // 11. 旅途/休息 (1 pt) — v6新增
  var rotData = analysisData.rotation || {};
  var rot1 = rotData[team] || { restDays: 5, fatigueLevel: 2 };
  var rot2 = rotData[opponent] || { restDays: 5, fatigueLevel: 2 };
  var altPenalty = stadium.alt > 500 ? 1 : 0;
  var travelBonus = (rot1.restDays - rot2.restDays) >= 3 ? 0.5 : 0;
  scores.travel = Math.round(Math.max(0, Math.min(1, 0.5 + travelBonus - altPenalty * 0.5)));

  // 11. 环境适应 (5 pts) — v7新增: 海拔+天气+开球时间+气候适应
  scores.environment = computeEnvironmentScore(team, opponent, stadium, stadiumClimate, kickoffTime);

  // 12. 历史交锋 H2H (10 pts) — v9新增: 基于近5年两队相互战绩
  scores.h2h = computeH2HScore(team, opponent);

  var total = scores.ranking + scores.form + scores.squad +
              scores.attack + scores.defense + scores.host +
              scores.injury + scores.travel + scores.environment + scores.h2h;
  total = Math.round(total);
  total = Math.max(5, Math.min(95, total));
  var maxTotal = 115;  // v10: -referee 2pts (117 → 115)

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
  var tScore = result.teamTotal;
  var oScore = result.oppTotal;

  // 世界杯场均进球约2.5，固定基数
  var totalGoals = 2.5;

  // 压缩比率：以0.5为锚点，确保方向与8维度总分一致
  var rawRatio = tScore / (tScore + oScore);
  var tRatio = 0.5 + (rawRatio - 0.5) * 0.7;
  tRatio = Math.max(0.2, Math.min(0.8, tRatio));

  var tBase = totalGoals * tRatio;
  var oBase = totalGoals * (1 - tRatio);

  // attack/defense 微调（以5分为中性点，±20%）
  var tAttFactor = 1.0 + (result.scores.attack - 5) / 5 * 0.20;
  var tDefFactor = 1.0 + (result.scores.defense - 5) / 5 * 0.20;
  tAttFactor = Math.max(0.80, Math.min(1.20, tAttFactor));
  tDefFactor = Math.max(0.80, Math.min(1.20, tDefFactor));

  var tExp = tBase * tAttFactor;
  var oExp = oBase * (2 - tDefFactor);

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

  tExp = Math.max(0.3, Math.min(3.0, tExp));
  oExp = Math.max(0.3, Math.min(3.0, oExp));

  function poisson(k, lam) {
    if (k < 0 || lam <= 0) return 0;
    var v = Math.exp(-lam);
    for (var i = 1; i <= k; i++) v *= lam / i;
    return v;
  }

  // 平局修正：基于xG差距（而非8维度gap），差距越小平局概率越高
  var xgGap = Math.abs(tExp - oExp);
  var drawBoost = 1.0 + Math.max(0, 1 - xgGap / 2.5) * 1.5;
  drawBoost = Math.max(1.0, Math.min(2.5, drawBoost));

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

  // 归一化
  var totalProb = winTotal + drawTotal + lossTotal;
  winTotal /= totalProb;
  drawTotal /= totalProb;
  lossTotal /= totalProb;

  var scoreTotal = 0;
  for (var si = 0; si < scores.length; si++) scoreTotal += scores[si].prob;
  for (var si = 0; si < scores.length; si++) scores[si].prob /= scoreTotal;

  scores.sort(function(a, b) { return b.prob - a.prob; });

  var wp = Math.round(winTotal * 100);
  var dp = Math.round(drawTotal * 100);
  var lp = Math.round(lossTotal * 100);
  // 修正舍入误差（确保总和=100）
  var sum = wp + dp + lp;
  if (sum !== 100) {
    var diff = 100 - sum;
    var maxVal = Math.max(wp, dp, lp);
    if (maxVal === wp) wp += diff;
    else if (maxVal === dp) dp += diff;
    else lp += diff;
  }

  return {
    top1: scores[0] ? (scores[0].home + '-' + scores[0].away) : '1-0',
    top1Pct: scores[0] ? Math.round(scores[0].prob * 100) : 0,
    top2: scores[1] ? (scores[1].home + '-' + scores[1].away) : '2-0',
    top2Pct: scores[1] ? Math.round(scores[1].prob * 100) : 0,
    top3: scores[2] ? (scores[2].home + '-' + scores[2].away) : '0-0',
    top3Pct: scores[2] ? Math.round(scores[2].prob * 100) : 0,
    winProb: wp,
    drawProb: dp,
    lossProb: lp
  };
}

// ---- 赛前预测引擎（泊松比分 + 胜平负） ----

function computePrediction(result, m) {
  var rankings = analysisData.rankings || {};
  var forms = analysisData.forms || {};
  var injuries = analysisData.injuries || {};

  var t = rankings[result.team] || { elo: 1100, rank: 60 };
  var o = rankings[result.opponent] || { elo: 1100, rank: 60 };

  // 泊松模型：比分 + 胜平负（已修复自洽）
  var scores = predictScores(result);

  // 体彩赔率作为参考
  var marketDrawProb = null;
  if (typeof lotteryData !== 'undefined' && lotteryData && lotteryData._matches) {
    var lm = lotteryData._matches;
    for (var mk = 0; mk < lm.length; mk++) {
      var had = lm[mk].pools.HAD;
      if (!had) continue;
      var lh = TEAM_ZH_REVERSE[lm[mk].homeTeam] || lm[mk].homeTeamEn;
      var la = TEAM_ZH_REVERSE[lm[mk].awayTeam] || lm[mk].awayTeamEn;
      if ((lh === result.team && la === result.opponent) || (lh === result.opponent && la === result.team)) {
        var hImp = 1 / had.h, dImp = 1 / had.d, aImp = 1 / had.a;
        var totalImp = hImp + dImp + aImp;
        marketDrawProb = Math.round(dImp / totalImp * 100);
        break;
      }
    }
  }

  var gap = Math.abs(result.teamTotal - result.oppTotal);
  var stronger = result.teamTotal >= result.oppTotal ? result.team : result.opponent;
  var weaker = result.teamTotal >= result.oppTotal ? result.opponent : result.team;
  var strongerName = (typeof currentLang !== 'undefined' && currentLang === 'zh' && typeof TEAM_ZH !== 'undefined' && TEAM_ZH[stronger]) ? TEAM_ZH[stronger] : stronger;
  var weakerName = (typeof currentLang !== 'undefined' && currentLang === 'zh' && typeof TEAM_ZH !== 'undefined' && TEAM_ZH[weaker]) ? TEAM_ZH[weaker] : weaker;
  var verdict = '';
  if (gap >= 60) verdict = '实力悬殊，' + strongerName + '取胜概率极高';
  else if (gap >= 25) verdict = '实力差距明显，' + strongerName + '取胜概率很高';
  else if (gap >= 12) verdict = strongerName + '占优，但' + weakerName + '有能力制造麻烦';
  else verdict = '势均力敌，任何结果都有可能';

  return {
    teamProb: scores.winProb,
    drawProb: scores.drawProb,
    oppProb: scores.lossProb,
    verdict: verdict,
    hasMarket: marketDrawProb !== null,
    marketDraw: marketDrawProb,
    score1: scores.top1,
    score1Pct: scores.top1Pct,
    score2: scores.top2,
    score2Pct: scores.top2Pct,
    score3: scores.top3,
    score3Pct: scores.top3Pct
  };
}

// 筛选世界杯正赛（2026-06-11起），无数据则回退到全部比赛
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
    var goals = parseInt(parts[0]) || 0;
    // 对手强度归一化：强队防线更难破，进球含金量更高
    var oppRank = recents[i].oppRank || 40;
    var factor = 1.0;
    if (oppRank <= 15) factor = 1.5;
    else if (oppRank <= 30) factor = 1.2;
    else if (oppRank <= 50) factor = 1.0;
    else if (oppRank <= 80) factor = 0.7;
    else factor = 0.5;
    total += goals * factor;
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
    var conc = parseInt(parts[1]) || 0;
    // 对手强度归一化：被强队进球正常，被弱队进球严重
    var oppRank = recents[i].oppRank || 40;
    var factor = 1.0;
    if (oppRank <= 15) factor = 0.7;
    else if (oppRank <= 30) factor = 0.85;
    else if (oppRank <= 50) factor = 1.0;
    else if (oppRank <= 80) factor = 1.2;
    else factor = 1.5;
    total += conc * factor;
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
  if (!stadium) return 7;
  // 世界杯只有3个东道主(USA/Canada/Mexico)在自己国土比赛才算主场,其它一律中立场地
  var hostTeamByCountry = { '美国': 'USA', '加拿大': 'Canada', '墨西哥': 'Mexico' };
  var hostTeam = hostTeamByCountry[stadium.country];
  if (!hostTeam) return 7;        // 比赛不在东道主国家(理论上 2026 不会出现,纯中立)
  if (team === hostTeam) return 14;     // 东道主在自己主场
  if (opponent === hostTeam) return 1; // 对手是东道主
  return 7;                              // 两队都不是该场地东道主(例: 法国vs西班牙在达拉斯)
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
  var groupStandings = typeof computeStandings === 'function' ? computeStandings(tGroup) : [];

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

// ---- v7 环境适应维度 (5 pts) ----

function parseKickoffLocalHour(kickoffTime) {
  if (!kickoffTime || typeof kickoffTime !== 'string') return -1;
  var parts = kickoffTime.split(' ');
  if (parts.length < 2) return -1;
  var hour = parseInt(parts[0].split(':')[0], 10);
  return isNaN(hour) ? -1 : hour;
}

function estimateKickoffTemp(stadiumClimate, localHour, matchMonth) {
  var temps = (matchMonth >= 7) ? stadiumClimate.tempJuly : stadiumClimate.tempJune;
  if (localHour < 0 || localHour > 23) return temps.avg;
  var avg = (temps.low + temps.high) / 2;
  var amp = (temps.high - temps.low) / 2;
  var theta = (localHour - 9.5) * Math.PI / 12;
  return avg + amp * Math.sin(theta);
}

function tempComfortScore(temp, isIndoor) {
  if (isIndoor) return 1.5;
  if (temp >= 18 && temp <= 24) return 1.5;
  if (temp >= 15 && temp <= 28) return 1.2;
  if (temp >= 10 && temp <= 32) return 0.8;
  return 0.3;
}

function humidityComfortScore(humidity, isIndoor) {
  if (isIndoor) return 1.0;
  switch (humidity) {
    case 'dry': return 1.0;
    case 'moderate': return 0.8;
    case 'high': return 0.5;
    case 'very-high': return 0.2;
    default: return 0.8;
  }
}

function altitudePenalty(altMeters, teamConf) {
  if (altMeters <= 300) return 0;
  var raw;
  if (altMeters <= 500)      raw = 0.3;
  else if (altMeters <= 1000) raw = 0.6;
  else if (altMeters <= 1500) raw = 1.0;
  else if (altMeters <= 2000) raw = 1.4;
  else                        raw = 1.8;
  var immunity = 0;
  if (teamConf === 'CONMEBOL') immunity = 0.5;
  else if (teamConf === 'CONCACAF') immunity = 0.4;
  else if (teamConf === 'CAF') immunity = 0.15;
  return raw * (1 - immunity);
}

function getTeamClimateZone(conf) {
  switch (conf) {
    case 'CAF': return 'hot';
    case 'CONCACAF': return 'warm';
    case 'CONMEBOL': return 'warm';
    case 'AFC': return 'mixed';
    case 'UEFA': return 'temperate';
    case 'OFC': return 'temperate';
    default: return 'temperate';
  }
}

function climateAdaptationScore(teamConf, stadiumHeatCategory, isIndoor) {
  if (isIndoor) return 0.8;
  var heatMap = { 'cool': 0, 'moderate': 1, 'warm': 2, 'hot': 3, 'extreme': 4 };
  var heatLevel = heatMap[stadiumHeatCategory] !== undefined ? heatMap[stadiumHeatCategory] : 1;
  var teamHeatMap = { 'temperate': 0, 'mixed': 1, 'warm': 2, 'hot': 3 };
  var teamHeat = teamHeatMap[getTeamClimateZone(teamConf)] || 1;
  var diff = teamHeat - heatLevel;
  if (diff >= 2) return 1.0;
  else if (diff >= 0) return 0.8;
  else if (diff === -1) return 0.5;
  else if (diff === -2) return 0.3;
  else return 0.1;
}

function computeEnvironmentScore(team, opponent, stadium, stadiumClimate, kickoffTime) {
  var tConf = (analysisData.rankings[team] || {}).conf || 'UEFA';
  var oConf = (analysisData.rankings[opponent] || {}).conf || 'UEFA';

  // 1. 海拔适应 (0-2.0): 相对海拔优势
  var altMeters = stadium.alt || 50;
  var tAltPen = altitudePenalty(altMeters, tConf);
  var oAltPen = altitudePenalty(altMeters, oConf);
  var altRelative = (oAltPen - tAltPen) * 0.8;
  var altScore = 1.0 + altRelative;
  altScore = Math.max(0, Math.min(2.0, altScore));

  // 2. 气候舒适度 (0-1.5): 温度+湿度
  var localHour = parseKickoffLocalHour(kickoffTime);
  var matchMonth = 6;
  var estTemp = estimateKickoffTemp(stadiumClimate, localHour, matchMonth);
  var isIndoor = stadiumClimate.indoor || false;
  var tempScore = tempComfortScore(estTemp, isIndoor);
  var humScore = humidityComfortScore(stadiumClimate.humidity, isIndoor);
  var comfortScore = tempScore * 0.7 + humScore * 0.3;
  var climateComfort = comfortScore * (1.5 / 1.35);

  // 3. 气候适应 (0-1.0): 球队vs球场气候匹配
  var adaptScore = climateAdaptationScore(tConf, stadiumClimate.heatCategory, isIndoor);

  // 4. 合并: 海拔2.0 + 气候1.5 + 适应1.0 + 基准0.5 = 5.0
  var raw = altScore + climateComfort + adaptScore;
  return Math.round(Math.max(0, Math.min(5, raw)));
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

  // Strong opponent quality (removed — redundant with form dimension; H2H is more relevant)

  // H2H insight — 近5年交锋记录
  var h2hInsight = buildH2HInsight(result.team, result.opponent, tName, oName);
  if (h2hInsight) insights.push(h2hInsight);

  // Squad value gap
  var tv = parseSquadValue(result.teamRank.squadValue);
  var ov = parseSquadValue(result.oppRank.squadValue);
  if (tv > ov * 3) {
    insights.push({ icon: '💰', text: tName + '全队身价€' + tv.toFixed(1) + '亿，是对手(€' + ov.toFixed(1) + '亿)的' + (tv / ov).toFixed(0) + '倍，纸面实力碾压' });
  } else if (ov > tv * 3) {
    insights.push({ icon: '💎', text: oName + '身价€' + ov.toFixed(1) + '亿远超' + tName + '(€' + tv.toFixed(1) + '亿)，但身价不决定一切' });
  }

  // Host advantage — only for actual host nations
  var hostNations = ['USA', 'United States', 'Mexico', 'Canada'];
  var isHostNation = false;
  for (var hi = 0; hi < hostNations.length; hi++) {
    if (result.team === hostNations[hi] || result.opponent === hostNations[hi]) { isHostNation = true; break; }
  }
  if (isHostNation && result.scores.host >= 12) {
    var hostTeam = result.team;
    for (var hj = 0; hj < hostNations.length; hj++) {
      if (result.opponent === hostNations[hj]) { hostTeam = result.opponent; break; }
    }
    var hostName = typeof trTeam === 'function' ? trTeam(hostTeam) : hostTeam;
    insights.push({ icon: '🏟️', text: hostName + '主场作战，东道主球迷支持度极高' });
  }

  // Injury / suspension — v8 球员级加权
  var injuries = analysisData.injuries || {};
  var tInj = injuries[result.team] || {};
  var oInj = injuries[result.opponent] || {};

  function buildInjInsightText(injData, displayName) {
    var players = injData.affectedPlayers;
    if (players && players.length > 0) {
      var keyPlayers = players.filter(function(p) { return p.importance >= 4; });
      if (keyPlayers.length > 0) {
        var keyNames = keyPlayers.slice(0, 2).map(function(p) {
          return (typeof trPlayer === 'function' ? trPlayer(p.name) : p.name);
        }).join('、');
        var statusText = keyPlayers[0].status === 'out' ? '缺阵' : '出战成疑';
        if ((injData.impact || 0) >= 8) {
          return displayName + '核心球员' + keyNames + statusText + '，战力严重受损';
        }
        return displayName + keyNames + statusText + '，阵容受损需留意';
      }
      return displayName + '伤停' + players.length + '人，战力受损需留意';
    }
    var issues = (injData.injuries || 0) + (injData.suspensions || 0);
    if (issues >= 2) return displayName + '伤停' + issues + '人' + (injData.note ? '（' + injData.note + '）' : '') + '，战力受损需留意';
    return null;
  }

  var tInsight = buildInjInsightText(tInj, tName);
  var oInsight = buildInjInsightText(oInj, oName);
  if (tInsight) insights.push({ icon: '🏥', text: tInsight });
  if (oInsight && !tInsight) {
    insights.push({ icon: '🩹', text: oInsight + '，' + tName + '有机可乘' });
  }

  // Only show top 5 insights
  return insights.slice(0, 5);
}

// ---- Render ----

function getFinalRoundGroups(upcomingMatches) {
  // Group matches by group
  var groups = {};
  for (var i = 0; i < upcomingMatches.length; i++) {
    var m = upcomingMatches[i];
    if (!m.group || m.group.indexOf('Group') !== 0) continue;
    var gn = m.group;
    if (!groups[gn]) groups[gn] = [];
    groups[gn].push(m);
  }

  // Check which groups are in final round (all teams have played 2 matches)
  var finalGroups = {};
  for (var gn in groups) {
    // Get all matches for this group from worldCupData
    var allMs = [];
    for (var j = 0; j < worldCupData.matches.length; j++) {
      if (worldCupData.matches[j].group === gn) allMs.push(worldCupData.matches[j]);
    }
    allMs.sort(function(a, b) { return a.date.localeCompare(b.date); });

    // Check if these upcoming matches are the last ones (no more matches after)
    var upcomingDates = {};
    for (var k = 0; k < groups[gn].length; k++) {
      upcomingDates[groups[gn][k].date] = true;
    }
    var lastDate = allMs[allMs.length - 1].date;
    var isFinal = Object.keys(upcomingDates).every(function(d) { return d === lastDate; });

    if (!isFinal) continue;

    // Compute current standings
    var teams = {};
    allMs.forEach(function(tm) { teams[tm.team1] = true; teams[tm.team2] = true; });
    var recs = {};
    for (var tn in teams) recs[tn] = { team: tn, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, pts: 0 };
    allMs.forEach(function(tm) {
      if (tm.score1 == null || tm.score2 == null) return;
      var t1 = recs[tm.team1], t2 = recs[tm.team2];
      if (!t1 || !t2) return;
      t1.played++; t2.played++; t1.gf += tm.score1; t1.ga += tm.score2; t1.gd = t1.gf - t1.ga;
      t2.gf += tm.score2; t2.ga += tm.score1; t2.gd = t2.gf - t2.ga;
      if (tm.score1 > tm.score2) { t1.won++; t2.lost++; t1.pts += 3; }
      else if (tm.score1 < tm.score2) { t2.won++; t1.lost++; t2.pts += 3; }
      else { t1.drawn++; t2.drawn++; t1.pts += 1; t2.pts += 1; }
    });
    var arr = [];
    for (var tn in recs) arr.push(recs[tn]);
    arr.sort(function(a, b) { return b.pts - a.pts || b.gd - a.gd || b.gf - a.gf; });

    // Tag teams
    var maxPtsPossible = arr[1] ? (arr[1].pts + 3) : 0;
    for (var ti = 0; ti < arr.length; ti++) {
      // Already qualified as group winner (can't be caught)
      if (ti === 0 && arr[ti].pts >= maxPtsPossible && arr[ti].played === 2) {
        arr[ti].qualified = true;
        arr[ti].willRotate = true;
      }
      // Eliminated (can't reach 2nd place even with a win)
      if (arr[ti].played === 2 && arr.length >= 2 && arr[ti].pts + 3 < arr[1].pts) {
        arr[ti].eliminated = true;
      }
    }

    // Build context for each upcoming match
    var finalMatches = groups[gn].map(function(fm) {
      var ctx = {};
      var t1 = arr.find(function(x) { return x.team === fm.team1; });
      var t2 = arr.find(function(x) { return x.team === fm.team2; });

      if (t1 && t1.qualified) ctx.team1Rotate = true;
      if (t2 && t2.qualified) ctx.team2Rotate = true;
      if (t1 && t1.eliminated) ctx.team1Eliminated = true;
      if (t2 && t2.eliminated) ctx.team2Eliminated = true;

      // Check if draw suits both (both qualify with a draw)
      if (t1 && t2 && !t1.qualified && !t2.qualified && !t1.eliminated && !t2.eliminated) {
        // Simulate: if draw, do both qualify?
        var drawT1Pts = t1.pts + 1, drawT2Pts = t2.pts + 1;
        var othersMax = arr.filter(function(x) { return x.team !== t1.team && x.team !== t2.team; })
                           .map(function(x) { return x.pts + 3; });
        var worstOther = othersMax.length > 0 ? Math.max.apply(null, othersMax) : 0;
        if (drawT1Pts > worstOther && drawT2Pts > worstOther) {
          ctx.drawIncentive = true;
        }
      }

      // Desperate teams (must win to qualify)
      if (t1 && !t1.qualified && !t1.eliminated) {
        // Check if draw is enough
        var drawPts = t1.pts + 1;
        var isDrawEnough = false;
        if (t2) {
          var otherMax = arr.filter(function(x) { return x.team !== t1.team && x.team !== t2.team; })
                            .map(function(x) { return x.pts + 3; });
          isDrawEnough = drawPts >= Math.max.apply(null, otherMax.concat([t2.pts + 1]));
        }
        if (!isDrawEnough) ctx.team1Desperate = true;
      }
      if (t2 && !t2.qualified && !t2.eliminated) {
        var drawPts2 = t2.pts + 1;
        var isDrawEnough2 = false;
        if (t1) {
          var otherMax2 = arr.filter(function(x) { return x.team !== t1.team && x.team !== t2.team; })
                             .map(function(x) { return x.pts + 3; });
          isDrawEnough2 = drawPts2 >= Math.max.apply(null, otherMax2.concat([t1.pts + 1]));
        }
        if (!isDrawEnough2) ctx.team2Desperate = true;
      }

      return { team1: fm.team1, team2: fm.team2, context: ctx };
    });

    if (finalMatches.length > 0) {
      finalGroups[gn] = { teams: arr, matches: finalMatches };
    }
  }

  return finalGroups;
}

function renderAnalysis() {
  var container = document.getElementById('analysis-content');
  if (!container) return;

  if (Object.keys(analysisData).length === 0) {
    container.innerHTML = '<div class="spinner"></div>';
    loadAnalysisData().then(function() {
      renderAnalysis();
      // 后台预取未开赛比赛的 H2H 数据，拉取后自动重渲染
      if (typeof prefetchH2HForUpcoming === 'function') prefetchH2HForUpcoming();
    }).catch(function(err) {
      container.innerHTML = '<div class="analysis-empty">' + t('analysisLoadFailed') + '<br><small>' + t('analysisRetry') + ' <a href="javascript:renderAnalysis()">' + t('analysisClickRetry') + '</a></small></div>';
    });
    return;
  }

  // 后台预取 H2H（首次加载已完成但 H2H 可能还没拉取）
  if (typeof prefetchH2HForUpcoming === 'function' && (!analysisData.h2h || Object.keys(analysisData.h2h).length === 0)) {
    prefetchH2HForUpcoming();
  }

  if (typeof worldCupData === 'undefined' || !worldCupData.matches || worldCupData.matches.length === 0) {
    container.innerHTML = '<div class="analysis-empty">' + t('analysisNoSchedule') + '</div>';
    return;
  }

  // 用最新的 ESPN 实时停赛数据更新分析数据
  if (typeof worldCupSuspensions !== 'undefined' && worldCupSuspensions && Object.keys(worldCupSuspensions).length > 0) {
    analysisData.injuries = mergeInjuryAndSuspensionData(
      analysisData.rawInjuries || analysisData.injuries || {},
      worldCupSuspensions,
      analysisData.playerImportance || {}
    );
  }

  // 构建占位符解析索引（供过滤和后续渲染共用）
  // ⚠️ 淘汰赛 m.team1/m.team2 是占位符 (W97/W98)，m.winner 才是 ESPN 真实队名
  //   需多轮迭代：先解析 R32 → R16 → QF → SF，前一轮比分合并后才能解析下一轮占位符
  var resolveByNum = {};
  var _loserByNum = {};
  function _isPh(n) { return n && (n[0] === 'W' || n[0] === 'L' || (/^\d/.test(n) && /[A-Z]$/.test(n))); }
  function _tryResolve(name) {
    if (name && (name[0] === 'W' || name[0] === 'L')) {
      var n = parseInt(name.substring(1));
      if (name[0] === 'W') {
        if (n && resolveByNum[n]) return resolveByNum[n];
      } else {
        if (n && _loserByNum[n]) return _loserByNum[n];
      }
    }
    return name;
  }
  if (typeof worldCupData !== 'undefined' && worldCupData.matches) {
    // 多轮迭代直到不动点（最多 6 轮：group → R32 → R16 → QF → SF → final）
    for (var pass = 0; pass < 6; pass++) {
      var changed = false;
      worldCupData.matches.forEach(function(m) {
        if (m.score1 == null) return;
        var t1r = _tryResolve(m.team1), t2r = _tryResolve(m.team2);
        var t1IsPh = _isPh(m.team1), t2IsPh = _isPh(m.team2);
        // 优先用 m.winner（ESPN 真实队名）
        if (m.winner && !_isPh(m.winner) && resolveByNum[m.num] !== m.winner) {
          resolveByNum[m.num] = m.winner;
          changed = true;
        }
        // 推断 loser：哪边是真实队名且 != winner
        if (m.winner && !_isPh(m.winner) && !_loserByNum[m.num]) {
          if (t1r && !_isPh(t1r) && t1r !== m.winner && (m.winner === t2r || m.score2 > m.score1)) {
            _loserByNum[m.num] = t1r; changed = true;
          } else if (t2r && !_isPh(t2r) && t2r !== m.winner && (m.winner === t1r || m.score1 > m.score2)) {
            _loserByNum[m.num] = t2r; changed = true;
          }
        }
        // 没有 m.winner 时退回 team1/team2（占位符已解析为真实队名）
        if (!m.winner || _isPh(m.winner)) {
          if (m.score1 > m.score2 && !t1IsPh && resolveByNum[m.num] !== t1r) {
            resolveByNum[m.num] = t1r; changed = true;
            if (!t2IsPh) _loserByNum[m.num] = t2r;
          } else if (m.score2 > m.score1 && !t2IsPh && resolveByNum[m.num] !== t2r) {
            resolveByNum[m.num] = t2r; changed = true;
            if (!t1IsPh) _loserByNum[m.num] = t1r;
          }
        }
      });
      if (!changed) break;
    }
  }
  function tryResolve(name) {
    if (name && (name[0] === 'W' || name[0] === 'L')) {
      var n = parseInt(name.substring(1));
      // W 前缀 → 胜者；L 前缀 → 败者（必须先查 loser，否则会误返回 winner）
      if (name[0] === 'W') {
        if (n && resolveByNum[n]) return resolveByNum[n];
      } else {
        if (n && _loserByNum[n]) return _loserByNum[n];
      }
    }
    return name;
  }

  var matches = [];
  if (typeof worldCupData !== 'undefined' && worldCupData.matches) {
    matches = worldCupData.matches.filter(function(m) {
      var hasScore = m.score1 != null && m.score2 != null;
      if (hasScore) return false;
      var t1r = tryResolve(m.team1), t2r = tryResolve(m.team2);
      return !isPlaceholder(t1r) && !isPlaceholder(t2r);
    });
  }

  // Only show matches from today onwards
  var today = new Date();
  var todayStr = today.toISOString().substring(0, 10);

  var upcoming = [];
  for (var i = 0; i < matches.length; i++) {
    if (matches[i].date >= todayStr) {
      upcoming.push(matches[i]);
    }
  }

  // Sort upcoming by date
  upcoming.sort(function(a, b) { return a.date.localeCompare(b.date) || a.time.localeCompare(b.time); });

  // Take next 16 upcoming matches
  var target = upcoming.slice(0, 16);

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
  html += '<span class="analysis-model-badge">10维分析 v10 · +H2H -裁判</span>';
  html += '</div>';

  // 小组末轮形势分析 → 融入比赛卡片
  var finalRoundGroups = getFinalRoundGroups(target);
  var matchContextMap = {};
  for (var frgKey in finalRoundGroups) {
    var frg = finalRoundGroups[frgKey];
    for (var fmi = 0; fmi < frg.matches.length; fmi++) {
      var fm = frg.matches[fmi];
      var ctxTags = [];
      if (fm.context) {
        if (fm.context.drawIncentive) ctxTags.push('⚠️默契风险');
        if (fm.context.team1Rotate) ctxTags.push(trTeam(fm.team1) + '轮换');
        if (fm.context.team2Rotate) ctxTags.push(trTeam(fm.team2) + '轮换');
        if (fm.context.team1Desperate) ctxTags.push(trTeam(fm.team1) + '生死战');
        if (fm.context.team2Desperate) ctxTags.push(trTeam(fm.team2) + '生死战');
      }
      if (ctxTags.length > 0) {
        var key = fm.team1 + '|' + fm.team2;
        matchContextMap[key] = ctxTags;
      }
    }
  }

  for (var j = 0; j < target.length; j++) {
    var m = target[j];
    // 解析占位符（W93→Spain等），确保 computeMatchScore 能用实际队名查找数据
    var t1r = tryResolve(m.team1), t2r = tryResolve(m.team2);
    var result = computeMatchScore(t1r, t2r, m.ground, m.date, m.time);
    // 用解析后的队名覆盖，供后续渲染使用
    result.team = t1r;
    result.opponent = t2r;
    result.ground = m.ground;
    result.matchInfo = m;
    var insights = generateInsights(result);

    var ctxTags = matchContextMap[m.team1 + '|' + m.team2] || matchContextMap[m.team2 + '|' + m.team1] || null;
    html += renderAnalysisCard(result, insights, m, j, ctxTags);
  }

  // Recommendations at the bottom
  html += renderAnalysisRecommendations(target);

  container.innerHTML = html;
}

function renderAnalysisCard(result, insights, m, idx, ctxTags) {
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
  var venueName = (typeof trVenue === 'function') ? trVenue(m.ground) : (m.ground || '');
  var roundName = (m.group) ? m.group : (typeof roundKey === 'function' ? t(roundKey(m.round)) : m.round);

  var html = '<div class="analysis-card">';

  // Header
  html += '<div class="analysis-card-header">';
  html += '<div class="analysis-match-id">' + roundName + ' · ' + m.date + ' ' + (m.time ? m.time.substring(0, 5) : '') + '</div>';
  html += '<div class="analysis-teams">';
  html += '<div class="analysis-team home-team">' + homeFlag + '<span>' + tName + '</span></div>';
  html += '<span class="analysis-vs">VS</span>';
  html += '<div class="analysis-team away-team">' + awayFlag + '<span>' + oName + '</span></div>';
  html += '</div>';
  html += '<div class="analysis-form-row"><div class="analysis-form-side">' + tFormMini + '</div><div class="analysis-form-side">' + oFormMini + '</div></div>';
  if (m.group) html += '<div class="analysis-group-tag">' + m.group + ' · ' + venueName + '</div>';
  else html += '<div class="analysis-group-tag">' + t(roundKey(m.round)) + ' · ' + venueName + '</div>';
  if (ctxTags && ctxTags.length > 0) {
    html += '<div class="analysis-ctx-tags">';
    for (var cti = 0; cti < ctxTags.length; cti++) {
      html += '<span class="analysis-ctx-tag">' + ctxTags[cti] + '</span>';
    }
    html += '</div>';
  }
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
  // 伤病停赛 — 对比条只显分数，详情放下方
  var tInjDetail = '', oInjDetail = '';
  if (typeof analysisData !== 'undefined' && analysisData.injuries) {
    var injT = analysisData.injuries[result.team] || {};
    var injO = analysisData.injuries[result.opponent] || {};

    function buildInjDetail(injData, teamName) {
      var players = injData.affectedPlayers;
      if (!players || !players.length) {
        var issues = (injData.injuries || 0) + (injData.suspensions || 0);
        return issues > 0 ? '<span class="dd-team">' + escHtml(teamName) + '</span>: 伤停' + issues + '人' : '';
      }
      var parts = players.map(function(p) {
        var name = typeof trPlayer === 'function' ? trPlayer(p.name) : p.name;
        if (name.length > 5) name = name.replace(/^.*[·⋅]/, '');
        var star = p.importance >= 5 ? '<span class="dd-star">★</span>' : (p.importance >= 4 ? '<span class="dd-star">☆</span>' : '');
        var label = p.status === 'out' ? '缺' : '疑';
        return '<span class="dd-player">' + escHtml(name) + '</span>' + star + label;
      });
      return '<span class="dd-team">' + escHtml(teamName) + '</span>: ' + parts.join(' ') + ' <span class="dd-impact">战力-' + injData.impact.toFixed(0) + '</span>';
    }

    var tInjScore = (injT.impact != null) ? injT.impact.toFixed(0) : ((injT.injuries||0)+(injT.suspensions||0));
    var oInjScore = (injO.impact != null) ? injO.impact.toFixed(0) : ((injO.injuries||0)+(injO.suspensions||0));
    var tInjDisplay2 = tInjScore > 0 ? '' + tInjScore : '0';
    var oInjDisplay2 = oInjScore > 0 ? '' + oInjScore : '0';
    tInjDetail = buildInjDetail(injT, tName);
    oInjDetail = buildInjDetail(injO, oName);
  } else {
    var tInjDisplay2 = '-', oInjDisplay2 = '-';
  }
  html += renderDimRow(t('analysisInjury'), tInjDisplay2, oInjDisplay2, result.scores.injury, 12, result.scores.injury > 6);

  // 历史交锋 H2H
  if (result.scores.h2h !== undefined) {
    var h2hDetail = buildH2HDetail(result.team, result.opponent, tName, oName);
    html += renderDimRow('🤝 ' + t('analysisH2H'), h2hDetail.t, h2hDetail.o, result.scores.h2h, 10, result.scores.h2h > 5);
  }

  // 裁判维度 — v10 已移除（覆盖率低、影响边际）

  // 旅途 — 左右显示各自休息天数
  var travelDetail = '';
  if (result.scores.travel !== undefined) {
    var rotData = analysisData.rotation || {};
    var rt1 = rotData[result.team] || {};
    var rt2 = rotData[result.opponent] || {};
    var tRest = rt1.restDays != null ? rt1.restDays : '?';
    var oRest = rt2.restDays != null ? rt2.restDays : '?';
    travelDetail = '<span class="dd-team">' + escHtml(tName) + '</span>休' + tRest + '天 vs <span class="dd-team">' + escHtml(oName) + '</span>休' + oRest + '天';
    var tRestN = typeof tRest === 'number' ? tRest : parseFloat(tRest);
    var oRestN = typeof oRest === 'number' ? oRest : parseFloat(oRest);
    var travelPct = (!isNaN(tRestN) && !isNaN(oRestN) && (tRestN + oRestN) > 0) ? tRestN / (tRestN + oRestN) : null;
    html += renderDimRow('✈️ 旅途', tRest + '天', oRest + '天', result.scores.travel, 1, tRestN > oRestN, travelPct);
  }

  // 环境适应 — 左右显示主客队各自适应度评分
  var envDetail = '';
  if (result.scores.environment !== undefined) {
    var stadiumClimate = (analysisData.stadiumClimate || {})[m.ground] || {};
    var stadium = (analysisData.stadiums || {})[m.ground] || {};
    var envParts = [];
    if (stadiumClimate.indoor) envParts.push('室内');
    var heatLabels = { 'cool': '凉爽', 'moderate': '适中', 'warm': '偏暖', 'hot': '炎热', 'extreme': '极端' };
    envParts.push(heatLabels[stadiumClimate.heatCategory] || '适中');
    if (m.time) {
      var localHr = parseKickoffLocalHour(m.time);
      if (localHr >= 0) envParts.push(localHr + ':00开球');
    }
    envDetail = m.ground + ': ' + envParts.join(' · ');
    var tEnvScore = computeEnvironmentScore(result.team, result.opponent, stadium, stadiumClimate, m.time);
    var oEnvScore = computeEnvironmentScore(result.opponent, result.team, stadium, stadiumClimate, m.time);
    var envPct = (tEnvScore + oEnvScore) > 0 ? tEnvScore / (tEnvScore + oEnvScore) : null;
    html += renderDimRow('🌍 环境适应', tEnvScore.toFixed(1), oEnvScore.toFixed(1), result.scores.environment, 5, tEnvScore > oEnvScore, envPct);
  }
  html += '</div>';

  // 伤停/旅途/环境 详细信息（对比条下方）
  var detailLines = [];
  if (tInjDetail || oInjDetail) {
    if (tInjDetail) detailLines.push(tInjDetail);
    if (oInjDetail) detailLines.push(oInjDetail);
  }
  if (travelDetail) detailLines.push(travelDetail);
  if (envDetail) detailLines.push(envDetail);
  if (detailLines.length > 0) {
    html += '<div class="analysis-dims-detail">';
    for (var di = 0; di < detailLines.length; di++) {
      html += '<div class="dims-detail-item">' + detailLines[di] + '</div>';
    }
    html += '</div>';
  }

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
  html += '<div class="pred-fill pred-fill-t" style="width:' + pred.teamProb + '%">' + (pred.teamProb >= 15 ? tName + ' ' + pred.teamProb + '%' : '') + '</div>';
  html += '<div class="pred-fill pred-fill-d" style="width:' + pred.drawProb + '%">' + (pred.drawProb >= 12 ? t('lotteryDraw') + ' ' + pred.drawProb + '%' : '') + '</div>';
  html += '<div class="pred-fill pred-fill-o" style="width:' + pred.oppProb + '%">' + (pred.oppProb >= 15 ? oName + ' ' + pred.oppProb + '%' : '') + '</div>';
  html += '</div></div>';
  html += '<div class="pred-legend">';
  html += '<span class="pred-dot pred-dot-t"></span>' + tName + ' ' + pred.teamProb + '%';
  html += '<span class="pred-dot pred-dot-d"></span>' + t('lotteryDraw') + ' ' + pred.drawProb + '%';
  html += '<span class="pred-dot pred-dot-o"></span>' + oName + ' ' + pred.oppProb + '%';
  html += '</div>';
  html += '<div class="pred-verdict">' + pred.verdict + '</div>';
  html += '<div class="pred-scores">';
  html += '<span class="pred-score-label">' + t('predScore') + '</span>';
  html += '<span class="pred-score-val">' + pred.score1 + '</span><span class="pred-score-pct">' + pred.score1Pct + '%</span>';
  html += '<span class="pred-score-val">' + pred.score2 + '</span><span class="pred-score-pct">' + pred.score2Pct + '%</span>';
  html += '<span class="pred-score-val">' + pred.score3 + '</span><span class="pred-score-pct">' + pred.score3Pct + '%</span>';
  html += '</div>';
  if (pred.hasMarket) {
    html += '<div class="pred-source">' + t('predSource') + '</div>';
  }
  html += '</div>';

  html += '</div>';
  return html;
}

function renderDimRow(label, tVal, oVal, score, maxScore, tEdge, pctOverride) {
  var pct;
  if (pctOverride != null) {
    pct = Math.round(pctOverride * 100);
  } else {
    pct = Math.round(score / maxScore * 100);
  }
  var barColor = pct >= 70 ? 'dim-green' : (pct >= 45 ? 'dim-yellow' : 'dim-red');
  return '<div class="analysis-dim-row">' +
    '<span class="dim-label">' + label + '</span>' +
    '<span class="dim-val dim-val-left ' + (tEdge ? 'dim-edge' : '') + '" title="' + escHtml(tVal) + '">' + tVal + '</span>' +
    '<div class="dim-bar-wrap"><div class="dim-bar ' + barColor + '" style="width:' + pct + '%"></div></div>' +
    '<span class="dim-val dim-val-right ' + (!tEdge ? 'dim-edge' : '') + '" title="' + escHtml(oVal) + '">' + oVal + '</span>' +
  '</div>';
}

function escHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }

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
    var result = computeMatchScore(m.team1, m.team2, m.ground, m.date, m.time);
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
