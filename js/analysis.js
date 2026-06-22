// js/analysis.js
var analysisData = {};

function loadAnalysisData() {
  return Promise.all([
    fetch('data/fifa-rankings.json').then(function(r) { return r.json(); }),
    fetch('data/team-form.json').then(function(r) { return r.json(); }),
    fetch('data/h2h.json').then(function(r) { return r.json(); }),
    fetch('data/stadiums.json').then(function(r) { return r.json(); }),
    fetch('data/injuries.json').then(function(r) { return r.json(); }).catch(function() { return {}; })
  ]).then(function(results) {
    analysisData.rankings = results[0];
    analysisData.forms = results[1];
    analysisData.h2h = results[2];
    analysisData.stadiums = results[3];
    // 合并静态伤病数据 + ESPN 实时停赛数据
    analysisData.injuries = mergeInjuryAndSuspensionData(
      results[4],
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
  var h2h = analysisData.h2h || {};
  var stadiums = analysisData.stadiums || {};
  var injuries = analysisData.injuries || {};

  var t = rank[team] || { rank: 60, elo: 1100, squadValue: '€0.2亿', avgAge: 27, conf: 'UEFA' };
  var o = rank[opponent] || { rank: 60, elo: 1100, squadValue: '€0.2亿', avgAge: 27, conf: 'UEFA' };
  var tf = form[team] || { formScore: 40, recent: [] };
  var of = form[opponent] || { formScore: 40, recent: [] };
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

  // 3. H2H (10 pts)
  var h2hKey1 = team + '_' + opponent;
  var h2hKey2 = opponent + '_' + team;
  var h2hData = h2h[h2hKey1] || h2h[h2hKey2] || [];
  scores.h2h = computeH2hScore(h2hData, team, opponent);

  // 4. Squad value (10 pts)
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

  // 8. Travel fatigue (10 pts)
  scores.travel = computeTravelScore(team, opponent, stadium, ground);

  // 9. Altitude (5 pts)
  scores.altitude = computeAltitudeScore(team, opponent, stadium);

  // 10. Group standing situation (10 pts)
  scores.situation = computeSituationScore(team, opponent, matchDate);

  // 11. Average age (5 pts)
  var ageDiff = (t.avgAge - o.avgAge);
  scores.age = Math.round(Math.max(0, Math.min(5, 2.5 + ageDiff * 0.5)));

  // 12. Injuries & suspensions (5 pts)
  var tInj = injuries[team] || { injuries: 0, suspensions: 0 };
  var oInj = injuries[opponent] || { injuries: 0, suspensions: 0 };
  var tPenalty = tInj.injuries * 1.5 + tInj.suspensions * 3;
  var oPenalty = oInj.injuries * 1.5 + oInj.suspensions * 3;
  scores.injury = Math.round(Math.max(0, Math.min(5, 2.5 + (oPenalty - tPenalty) * 0.8)));

  var total = scores.ranking + scores.form + scores.h2h + scores.squad +
              scores.attack + scores.defense + scores.host + scores.travel +
              scores.altitude + scores.situation + scores.age + scores.injury;
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

function computeAvgGoals(formData) {
  var recents = formData.recent || [];
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
  var recents = formData.recent || [];
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
  var recents = formData.recent || [];
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

function computeH2hScore(h2hData, team, opponent) {
  if (h2hData.length === 0) return 5; // no history = neutral
  var wins = 0, total = h2hData.length;
  var weightedWins = 0;
  for (var i = 0; i < h2hData.length; i++) {
    var r = h2hData[i];
    var parts = r.result.split('-');
    var g1 = parseInt(parts[0]), g2 = parseInt(parts[1]);
    var isHome = r.venue.indexOf(team) !== -1;
    var w = 1 + (h2hData.length - i) * 0.2; // recency
    if (g1 > g2) { wins++; weightedWins += w; }
    if (g1 < g2) { weightedWins -= w * 0.7; }
  }
  var ratio = weightedWins / Math.max(1, total);
  return Math.round(Math.max(0, Math.min(10, 5 + ratio * 6)));
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

function computeTravelScore(team, opponent, stadium, ground) {
  // Simplified: if stadium is known, assume CONCACAF teams travel less
  if (!stadium) return 5;
  var tRank = analysisData.rankings[team] || {};
  var oRank = analysisData.rankings[opponent] || {};

  var tTravel = travelDistance(tRank.conf, stadium.country);
  var oTravel = travelDistance(oRank.conf, stadium.country);

  var diff = oTravel - tTravel;
  return Math.round(Math.max(0, Math.min(10, 5 + diff)));
}

function travelDistance(conf, hostCountry) {
  if (hostCountry === '墨西哥' || hostCountry === '美国' || hostCountry === '加拿大') {
    if (conf === 'CONCACAF') return 0;
    if (conf === 'CONMEBOL') return 2;
    if (conf === 'UEFA') return 4;
    if (conf === 'CAF') return 5;
    if (conf === 'AFC') return 6;
    if (conf === 'OFC') return 8;
  }
  return 3;
}

function computeAltitudeScore(team, opponent, stadium) {
  if (!stadium || stadium.alt < 1000) return 3;
  var tRank = analysisData.rankings[team] || {};
  var oRank = analysisData.rankings[opponent] || {};

  // CONMEBOL teams (especially Bolivia, Ecuador, Peru, Colombia) handle altitude better
  var highAltConfs = ['CONMEBOL'];
  var tAdapted = highAltConfs.indexOf(tRank.conf) !== -1;
  var oAdapted = highAltConfs.indexOf(oRank.conf) !== -1;

  if (tAdapted && !oAdapted && stadium.alt > 1500) return 5;
  if (!tAdapted && !oAdapted && stadium.alt > 1500) return 2;
  return 3;
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
  var tRecents = tf.recent || [], oRecents = of.recent || [];
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

  // H2H analysis
  var h2hKey1 = result.team + '_' + result.opponent;
  var h2hKey2 = result.opponent + '_' + result.team;
  var h2hData = (analysisData.h2h[h2hKey1] || analysisData.h2h[h2hKey2] || []);
  if (h2hData.length >= 3) {
    var hw = 0;
    for (var h = 0; h < h2hData.length; h++) {
      var parts = h2hData[h].result.split('-');
      if (parseInt(parts[0]) > parseInt(parts[1])) hw++;
    }
    insights.push({ icon: '📜', text: '历史交锋' + h2hData.length + '次，' + tName + '战绩' + hw + '胜' + (h2hData.length - hw) + '负' + (h2hData.length - hw) + '平' });
  } else if (h2hData.length === 0) {
    insights.push({ icon: '🆕', text: '两队暂无历史交锋记录，属于遭遇战' });
  }

  // Squad value gap
  var tv = parseSquadValue(result.teamRank.squadValue);
  var ov = parseSquadValue(result.oppRank.squadValue);
  if (tv > ov * 3) {
    insights.push({ icon: '💰', text: tName + '全队身价€' + tv.toFixed(1) + '亿，是对手(€' + ov.toFixed(1) + '亿)的' + (tv / ov).toFixed(0) + '倍，纸面实力碾压' });
  } else if (ov > tv * 3) {
    insights.push({ icon: '💎', text: oName + '身价€' + ov.toFixed(1) + '亿远超' + tName + '(€' + tv.toFixed(1) + '亿)，但身价不决定一切' });
  }

  // Altitude warning
  if (result.scores.altitude >= 5) {
    insights.push({ icon: '⛰️', text: '本场在海拔' + (analysisData.stadiums[result.ground] ? analysisData.stadiums[result.ground].alt + 'm' : '高海拔') + '进行，' + tName + '更适应高原作战' });
  } else if (result.scores.altitude <= 2) {
    insights.push({ icon: '⛰️', text: '高海拔球场对' + oName + '不利，' + tName + '有一定高原优势' });
  }

  // Travel fatigue
  if (result.scores.travel >= 7) {
    insights.push({ icon: '✈️', text: tName + '旅途距离远小于对手，体能恢复占优' });
  } else if (result.scores.travel <= 3) {
    insights.push({ icon: '🛫', text: oName + '长途跋涉累计距离大，体能可能受影响' });
  }

  // Host advantage
  if (result.scores.host >= 12) {
    insights.push({ icon: '🏟️', text: tName + '享受主场东道主优势，球迷支持度极高' });
  }

  // Age factor
  var ageDiff = result.teamRank.avgAge - result.oppRank.avgAge;
  if (ageDiff > 3) {
    insights.push({ icon: '🧓', text: tName + '平均年龄' + result.teamRank.avgAge + '岁偏大，密集赛程需轮换' });
  } else if (ageDiff < -3) {
    insights.push({ icon: '🧒', text: tName + '平均年龄仅' + result.teamRank.avgAge + '岁，年轻有活力但经验不足' });
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
  html += renderDimRow(t('analysisH2H'), '-', '-', result.scores.h2h, 10, result.scores.h2h > 5);
  html += renderDimRow(t('analysisSquad'), tl.squadValue, ol.squadValue, result.scores.squad, 10, parseSquadValue(tl.squadValue) > parseSquadValue(ol.squadValue));
  html += renderDimRow(t('analysisAttack'), (typeof computeAvgGoals==='function'?computeAvgGoals(result.teamForm).toFixed(1):'-') + '球/场', (typeof computeAvgGoals==='function'?computeAvgGoals(result.oppForm).toFixed(1):'-') + '球/场', result.scores.attack, 10, result.scores.attack > 5);
  html += renderDimRow(t('analysisDefense'), (typeof computeAvgConc==='function'?computeAvgConc(result.teamForm).toFixed(1):'-') + '失/场', (typeof computeAvgConc==='function'?computeAvgConc(result.oppForm).toFixed(1):'-') + '失/场', result.scores.defense, 10, result.scores.defense > 5);
  html += renderDimRow(t('analysisHost'), '-', '-', result.scores.host, 15, result.scores.host > 7);
  html += renderDimRow(t('analysisTravel'), '-', '-', result.scores.travel, 10, result.scores.travel > 5);
  html += renderDimRow(t('analysisAltitude'), '-', '-', result.scores.altitude, 5, result.scores.altitude > 3);
  html += renderDimRow(t('analysisSituation'), '-', '-', result.scores.situation, 10, result.scores.situation > 5);
  html += renderDimRow(t('analysisAge'), tl.avgAge + '岁', ol.avgAge + '岁', result.scores.age, 5, tl.avgAge < ol.avgAge);
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
