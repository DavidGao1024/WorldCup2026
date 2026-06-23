// js/schedule.js
function renderSchedule(filterGroup, filterTeam) {
  var container = document.getElementById('schedule-list');
  var matches = getMatches();
  if (!matches.length) {
    container.innerHTML = '<div class="no-data">' + t('noData') + '</div>';
    return;
  }

  var filtered = matches;
  if (filterGroup && filterGroup !== 'all') {
    filtered = filtered.filter(function(m) { return m.group === filterGroup; });
  }
  if (filterTeam && filterTeam !== 'all') {
    filtered = filtered.filter(function(m) { return m.team1 === filterTeam || m.team2 === filterTeam; });
  }

  var byDate = {};
  filtered.forEach(function(m) {
    var c = convertTime(m.time, m.date);
    m._displayTime = c.time;
    m._displayDate = c.date;
    if (!byDate[c.date]) byDate[c.date] = [];
    byDate[c.date].push(m);
  });

  var today = new Date().toISOString().slice(0, 10);
  var html = '';

  var dates = Object.keys(byDate).sort();
  var weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  var weekdaysEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  dates.forEach(function(date) {
    var dayMatches = byDate[date];
    var d = new Date(date + 'T00:00:00');
    var wd = currentLang === 'zh' ? weekdays[d.getDay()] : weekdaysEn[d.getDay()];
    var displayDate;
    if (currentLang === 'zh') {
      displayDate = (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + wd;
    } else {
      displayDate = d.toLocaleDateString('en', { month: 'short', day: 'numeric' }) + ' ' + wd;
    }
    var isToday = date === today;

    html += '<div class="date-group"><div class="date-header' + (isToday ? ' today' : '') + '">';
    if (isToday) html += '★ ' + t('today') + ' · ';
    html += displayDate + '</div><div class="matches-grid">';

    dayMatches.forEach(function(m) {
      var time = m._displayTime;
      var isGroup = m.group && m.group.indexOf('Group ') === 0;
      var stageLabel = isGroup ? m.group : t(roundKey(m.round));
      var hasScore = m.score1 != null && m.score2 != null;
      var isLive = m.status === 'in';
      var scoreDisplay = hasScore ? m.score1 + ' - ' + m.score2 : t('vs');
      var liveBadge = isLive ? '<span class="live-badge">LIVE</span>' : '';
      var venueName = trVenue(m.ground);

      html += '<div class="match-card" data-match-num="' + m.num + '" style="cursor:pointer">' +
        liveBadge +
        (!isGroup ? '<span class="match-round">' + stageLabel + '</span>' : '') +
        '<div class="match-time">' + time + ' (' + getUTCOffsetStr() + ') · ' + venueName + '</div>' +
        '<div class="match-teams">' +
          '<div class="team">' + getFlagImg(m.team1) + '<span class="name">' + trTeam(m.team1) + '</span></div>' +
          '<div class="score">' + scoreDisplay + '</div>' +
          '<div class="team">' + getFlagImg(m.team2) + '<span class="name">' + trTeam(m.team2) + '</span></div>' +
        '</div>' +
        '<div class="match-ground">' + (isGroup ? stageLabel : venueName) + '</div>' +
      '</div>';
    });

    html += '</div></div>';
  });

  container.innerHTML = html || '<div class="no-data">' + t('noData') + '</div>';

  // 点击比赛卡片弹出详情
  container.querySelectorAll('.match-card').forEach(function(card) {
    card.addEventListener('click', function() {
      var num = parseInt(card.getAttribute('data-match-num'));
      if (num) showMatchModal(num);
    });
  });
}

function populateFilters() {
  var groupFilter = document.getElementById('filter-group');
  var teamFilter = document.getElementById('filter-team');
  var savedGroup = groupFilter.value;
  var savedTeam = teamFilter.value;

  groupFilter.innerHTML = '<option value="all">' + t('allGroups') + '</option>';
  getGroups().forEach(function(g) {
    groupFilter.innerHTML += '<option value="' + g + '">' + g + '</option>';
  });
  groupFilter.value = savedGroup || 'all';

  populateTeamFilter(savedGroup || 'all', savedTeam);
}

function populateTeamFilter(groupName, savedTeam) {
  var teamFilter = document.getElementById('filter-team');
  var teams = groupName === 'all' ? getTeams() : getTeamsByGroup(groupName);
  teamFilter.innerHTML = '<option value="all">' + t('allTeams') + '</option>';
  teams.forEach(function(t) {
    teamFilter.innerHTML += '<option value="' + t + '">' + trTeam(t) + '</option>';
  });
  teamFilter.value = savedTeam || 'all';
}

// ---- 比赛详情弹窗 ----

function showMatchModal(matchNum) {
  // 先关闭已有的弹窗
  closeMatchModal();

  var matches = typeof getMatches === 'function' ? getMatches() : (worldCupData ? worldCupData.matches : []);
  var match = null;
  for (var i = 0; i < matches.length; i++) {
    if (matches[i].num === matchNum) { match = matches[i]; break; }
  }
  if (!match) return;

  var modal = createMatchModal();
  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';

  // 点击遮罩关闭
  modal.addEventListener('click', function(e) {
    if (e.target === modal) closeMatchModal();
  });
  // ESC 关闭
  var escHandler = function(e) { if (e.key === 'Escape') { closeMatchModal(); document.removeEventListener('keydown', escHandler); } };
  document.addEventListener('keydown', escHandler);

  var body = modal.querySelector('.match-modal-body');

  var eventId = typeof findEspnEventId === 'function' ? findEspnEventId(match) : null;

  if (!eventId) {
    // 无 ESPN 数据 → 显示基本比赛信息
    body.innerHTML = renderMatchBasicInfo(match);
    return;
  }

  // 加载中
  body.innerHTML = '<div class="match-modal-loading">' + t('matchLoading') + '</div>';

  if (typeof fetchMatchSummary === 'function') {
    fetchMatchSummary(eventId).then(function(summary) {
      if (summary && summary.lineups && summary.lineups.length > 0 && summary.lineups[0].starters.length > 0) {
        body.innerHTML = renderMatchModalContent(summary, match);
      } else {
        // 有 summary 但无阵容（未开始比赛或阵容未公布）
        body.innerHTML = renderMatchBasicInfo(match, summary);
      }
    }).catch(function() {
      body.innerHTML = renderMatchBasicInfo(match);
    });
  } else {
    body.innerHTML = renderMatchBasicInfo(match);
  }
}

function createMatchModal() {
  var overlay = document.createElement('div');
  overlay.className = 'match-modal-overlay';
  overlay.innerHTML =
    '<button class="match-modal-close">✕</button>' +
    '<div class="match-modal">' +
      '<div class="match-modal-body"></div>' +
    '</div>';
  overlay.querySelector('.match-modal-close').addEventListener('click', function() {
    closeMatchModal();
  });
  return overlay;
}

function closeMatchModal() {
  var overlay = document.querySelector('.match-modal-overlay');
  if (overlay) overlay.remove();
  document.body.style.overflow = '';
}

function renderMatchBasicInfo(match, summary) {
  var hasScore = match.score1 != null && match.score2 != null;
  var scoreDisplay = hasScore ? match.score1 + ' - ' + match.score2 : 'vs';
  var time = match._displayTime || (match.date + ' ' + (match.time || ''));
  var isGroup = match.group && match.group.indexOf('Group ') === 0;
  var stageLabel = isGroup ? (match.group || '') : (typeof t === 'function' ? t(typeof roundKey === 'function' ? roundKey(match.round) : match.round) : match.round);

  var html = '';
  // Header
  html += '<div class="match-modal-header">';
  html += '<div class="match-modal-score">';
  html += '<div class="match-modal-team">' + getFlagImg(match.team1) + '<span class="match-modal-team-name">' + trTeam(match.team1) + '</span></div>';
  html += '<div><span class="match-modal-score-num">' + scoreDisplay + '</span></div>';
  html += '<div class="match-modal-team">' + getFlagImg(match.team2) + '<span class="match-modal-team-name">' + trTeam(match.team2) + '</span></div>';
  html += '</div>';
  html += '<div class="match-modal-meta"><span>' + time + '</span><span>·</span><span>' + trVenue(match.ground) + '</span><span>·</span><span>' + stageLabel + '</span></div>';
  html += '</div>';

  // Events from summary (if available)
  if (summary && summary.events && summary.events.length > 0) {
    html += '<div class="match-events-section">';
    html += '<div class="match-events-title">' + t('matchEventsTitle') + '</div>';
    for (var i = 0; i < summary.events.length; i++) {
      var ev = summary.events[i];
      var evtTeam = typeof mapEspnName === 'function' ? mapEspnName(ev.team) : ev.team;
      var isHome = evtTeam === match.team1 || evtTeam === trTeam(match.team1);
      var alignClass = isHome ? 'match-event-home' : 'match-event-away';
      var icon = '';
      if (ev.type.indexOf('goal') >= 0 && ev.type.indexOf('own') === -1) icon = '⚽';
      else if (ev.type.indexOf('own-goal') >= 0) icon = '🔴';
      else if (ev.type === 'yellow-card') icon = '🟨';
      else if (ev.type === 'red-card') icon = '🟥';
      else if (ev.type === 'substitution') icon = '🔄';
      var scorer = ev.participants && ev.participants[0] ? ev.participants[0].name : '';
      var p2 = ev.participants && ev.participants[1] ? ev.participants[1].name : '';
      var isSub = ev.type === 'substitution';
      html += '<div class="match-event-row ' + alignClass + '">';
      html += '<span class="match-event-time">' + ev.time + '</span>';
      html += '<span class="match-event-icon">' + icon + '</span>';
      html += '<span class="match-event-player">' + scorer + (isSub ? ' ↔ ' + p2 : (p2 ? ' <span class="match-event-assist">(' + t('matchAssist') + ': ' + p2 + ')</span>' : '')) + '</span>';
      html += '</div>';
    }
    html += '</div>';
  }

  // Stats（仅已完赛比赛显示）
  var hasScore2 = match.score1 != null && match.score2 != null;
  if (hasScore2 && summary && summary.stats && summary.stats.length === 2) {
    html += '<div class="match-stats-section">';
    html += '<div class="match-stats-title">' + t('matchStats') + '</div>';
    var statNames = ['possessionPct', 'totalShots', 'shotsOnTarget', 'totalPasses', 'passPct', 'foulsCommitted', 'wonCorners', 'effectiveTackles', 'interceptions', 'effectiveClearance'];
    var statLabels = { possessionPct: '控球率(%)', totalShots: '射门', shotsOnTarget: '射正', totalPasses: '传球', passPct: '传球成功率(%)', foulsCommitted: '犯规', wonCorners: '角球', effectiveTackles: '抢断', interceptions: '拦截', effectiveClearance: '解围' };
    for (var s = 0; s < statNames.length; s++) {
      var sn = statNames[s];
      var sv0 = '', sv1 = '';
      for (var st = 0; st < (summary.stats[0].stats || []).length; st++) {
        if ((summary.stats[0].stats[st].name || '') === sn) sv0 = summary.stats[0].stats[st].value;
        if ((summary.stats[1].stats[st].name || '') === sn) sv1 = summary.stats[1].stats[st].value;
      }
      if (!sv0 && !sv1) continue;
      var v0 = parseFloat(sv0) || 0, v1 = parseFloat(sv1) || 0;
      var isPct = sn === 'possessionPct' || sn === 'passPct';
      var d0 = isPct ? (sn === 'passPct' ? Math.round(v0 * 100) : Math.round(v0)) : v0;
      var d1 = isPct ? (sn === 'passPct' ? Math.round(v1 * 100) : Math.round(v1)) : v1;
      var total = v0 + v1 || 1;
      var pct0 = Math.round(v0 / total * 100), pct1 = Math.round(v1 / total * 100);
      var fmt0 = isPct ? d0 + '%' : d0;
      var fmt1 = isPct ? d1 + '%' : d1;
      html += '<div class="match-stat-row">';
      html += '<span class="match-stat-val">' + fmt0 + '</span>';
      html += '<span class="match-stat-bar-wrap"><span class="match-stat-bar-home" style="width:' + pct0 + '%"></span><span class="match-stat-bar-away" style="width:' + pct1 + '%"></span></span>';
      html += '<span class="match-stat-val">' + fmt1 + '</span>';
      html += '<span class="match-stat-label">' + (statLabels[sn] || sn) + '</span>';
      html += '</div>';
    }
    html += '</div>';
  }

  // No lineup available message
  if (!summary || !summary.lineups || summary.lineups.length === 0 || summary.lineups[0].starters.length === 0) {
    html += '<div class="match-lineup-empty">' + t('matchNoLineup') + '</div>';
  }

  return html;
}

function renderMatchModalContent(summary, match) {
  var hasScore = match.score1 != null && match.score2 != null;
  var scoreDisplay = hasScore ? match.score1 + ' - ' + match.score2 : 'vs';
  var time = match._displayTime || (match.date + ' ' + (match.time || ''));
  var isGroup = match.group && match.group.indexOf('Group ') === 0;
  var stageLabel = isGroup ? (match.group || '') : (typeof t === 'function' ? t(typeof roundKey === 'function' ? roundKey(match.round) : match.round) : match.round);

  var html = '';

  // Header
  html += '<div class="match-modal-header">';
  html += '<div class="match-modal-score">';
  html += '<div class="match-modal-team">' + getFlagImg(match.team1) + '<span class="match-modal-team-name">' + trTeam(match.team1) + '</span></div>';
  html += '<div><span class="match-modal-score-num">' + scoreDisplay + '</span></div>';
  html += '<div class="match-modal-team">' + getFlagImg(match.team2) + '<span class="match-modal-team-name">' + trTeam(match.team2) + '</span></div>';
  html += '</div>';
  html += '<div class="match-modal-meta"><span>' + time + '</span><span>·</span><span>' + trVenue(match.ground) + '</span><span>·</span><span>' + stageLabel + '</span></div>';
  html += '</div>';

  // Lineups
  html += '<div class="match-modal-lineups">';
  for (var li = 0; li < summary.lineups.length; li++) {
    html += renderLineupCol(summary.lineups[li], match);
  }
  html += '</div>';

  // Match Events
  if (summary.events && summary.events.length > 0) {
    html += '<div class="match-events-section">';
    html += '<div class="match-events-title">' + t('matchEventsTitle') + '</div>';
    for (var ei = 0; ei < summary.events.length; ei++) {
      var ev = summary.events[ei];
      var isHome = ev.team === match.team1;
      var alignClass = isHome ? 'match-event-home' : 'match-event-away';
      var icon = '';
      if (ev.type.indexOf('goal') >= 0 && ev.type.indexOf('own') === -1) icon = '⚽';
      else if (ev.type.indexOf('own-goal') >= 0) icon = '🔴';
      else if (ev.type === 'yellow-card') icon = '🟨';
      else if (ev.type === 'red-card') icon = '🟥';
      else if (ev.type === 'substitution') icon = '🔄';
      var scorer = ev.participants && ev.participants[0] ? ev.participants[0].name : '';
      var p2 = ev.participants && ev.participants[1] ? ev.participants[1].name : '';
      var isSub = ev.type === 'substitution';
      html += '<div class="match-event-row ' + alignClass + '">';
      html += '<span class="match-event-time">' + ev.time + '</span>';
      html += '<span class="match-event-icon">' + icon + '</span>';
      html += '<span class="match-event-player">' + scorer + (isSub ? ' ↔ ' + p2 : (p2 ? ' <span class="match-event-assist">(' + t('matchAssist') + ': ' + p2 + ')</span>' : '')) + '</span>';
      html += '</div>';
    }
    html += '</div>';
  }

  // Stats
  if (summary.stats && summary.stats.length === 2) {
    html += '<div class="match-stats-section">';
    html += '<div class="match-stats-title">' + t('matchStats') + '</div>';
    var statNames = ['possessionPct', 'totalShots', 'shotsOnTarget', 'totalPasses', 'passPct', 'foulsCommitted', 'wonCorners', 'effectiveTackles', 'interceptions', 'effectiveClearance'];
    var statLabels = { possessionPct: '控球率(%)', totalShots: '射门', shotsOnTarget: '射正', totalPasses: '传球', passPct: '传球成功率(%)', foulsCommitted: '犯规', wonCorners: '角球', effectiveTackles: '抢断', interceptions: '拦截', effectiveClearance: '解围' };
    for (var s = 0; s < statNames.length; s++) {
      var sn = statNames[s];
      var sv0 = '', sv1 = '';
      for (var st = 0; st < (summary.stats[0].stats || []).length; st++) {
        if (summary.stats[0].stats[st].name === sn) sv0 = summary.stats[0].stats[st].value;
        if (summary.stats[1].stats[st].name === sn) sv1 = summary.stats[1].stats[st].value;
      }
      if (!sv0 && !sv1) continue;
      var v0 = parseFloat(sv0) || 0, v1 = parseFloat(sv1) || 0;
      var isPct = sn === 'possessionPct' || sn === 'passPct';
      var d0 = isPct ? (sn === 'passPct' ? Math.round(v0 * 100) : Math.round(v0)) : v0;
      var d1 = isPct ? (sn === 'passPct' ? Math.round(v1 * 100) : Math.round(v1)) : v1;
      var total = v0 + v1 || 1;
      var pct0 = Math.round(v0 / total * 100), pct1 = Math.round(v1 / total * 100);
      var fmt0 = isPct ? d0 + '%' : d0;
      var fmt1 = isPct ? d1 + '%' : d1;
      html += '<div class="match-stat-row">';
      html += '<span class="match-stat-val">' + fmt0 + '</span>';
      html += '<span class="match-stat-bar-wrap"><span class="match-stat-bar-home" style="width:' + pct0 + '%"></span><span class="match-stat-bar-away" style="width:' + pct1 + '%"></span></span>';
      html += '<span class="match-stat-val">' + fmt1 + '</span>';
      html += '<span class="match-stat-label">' + (statLabels[sn] || sn) + '</span>';
      html += '</div>';
    }
    html += '</div>';
  }

  return html;
}

function renderLineupCol(lineup, match) {
  var html = '<div class="match-field-col">';
  html += '<div class="match-field-team-name">' + trTeam(lineup.team) + '</div>';
  html += '<div class="match-field-formation">' + (lineup.formation || '') + '</div>';

  // Football pitch
  html += '<div class="match-pitch">';
  html += '<div class="pitch-line-mid"></div>';
  html += '<div class="pitch-circle-mid"></div>';
  html += '<div class="pitch-box-18"></div>';
  html += '<div class="pitch-box-6"></div>';
  html += '<div class="pitch-box-18-top"></div>';
  html += '<div class="pitch-box-6-top"></div>';
  html += '<div class="pitch-goal-b"></div>';
  html += '<div class="pitch-goal-t"></div>';

  // Group starters by position category
  var categories = categorizePlayers(lineup.starters || []);

  // Place each player on the field
  (lineup.starters || []).forEach(function(p) {
    var pos = getFieldXY(p, categories, lineup.formation);
    html += '<div class="match-player-dot" style="left:' + pos.x + '%;top:' + pos.y + '%">';
    html += '<span class="dot-jersey">' + p.jersey + '</span>';
    html += '<span class="dot-name">' + p.shortName + '</span>';
    html += '<span class="dot-pos-tag">' + (p.positionAbbr || '') + '</span>';
    html += '</div>';
  });

  html += '</div>'; // end pitch

  // Bench as compact list
  if (lineup.bench && lineup.bench.length > 0) {
    html += '<div class="match-bench-title">' + t('matchBench') + ' (' + lineup.bench.length + ')</div>';
    html += '<div class="match-bench-list">';
    (lineup.bench || []).forEach(function(p) {
      html += '<span class="match-bench-item"><span class="match-bench-num">#' + p.jersey + '</span>' + p.shortName + '</span>';
    });
    html += '</div>';
  }

  html += '</div>';
  return html;
}

// 将球员按位置分类：GK, DEF, MID, FWD
function categorizePlayers(players) {
  var cats = { GK: [], DEF: [], MID: [], FWD: [] };
  players.forEach(function(p) {
    var posName = (p.position || '').toLowerCase();
    var posAbbr = (p.positionAbbr || '').toUpperCase();
    // GK
    if (posName === 'goalkeeper' || posAbbr === 'G' || posAbbr === 'GK') {
      cats.GK.push(p); return;
    }
    // DEF: 以 CD, CB, LB, RB, WB, SW 开头或恰好 == D
    if (posAbbr === 'D' || /^(CD|CB|LB|RB|WB|SW)/.test(posAbbr)) {
      cats.DEF.push(p); return;
    }
    // MID: 以 CM, DM, AM, LM, RM, M 开头 或 名称含 midfield
    if (posName.indexOf('midfield') >= 0 || /^(CM|DM|AM|LM|RM|M)/.test(posAbbr)) {
      cats.MID.push(p); return;
    }
    // 其余 → FWD
    cats.FWD.push(p);
  });
  return cats;
}

// 根据位置分类计算球员在场上的 X, Y 百分比坐标
// formation: 阵型字符串，如 "4-2-3-1"
function getFieldXY(player, categories, formation) {
  var posAbbr = (player.positionAbbr || '').toUpperCase();
  var cat = '';
  if (categories.GK.indexOf(player) >= 0) cat = 'GK';
  else if (categories.DEF.indexOf(player) >= 0) cat = 'DEF';
  else if (categories.MID.indexOf(player) >= 0) cat = 'MID';
  else cat = 'FWD';

  // 解析阵型获取各排深度
  var rows = getFormationYRows(formation, categories);
  var rowY = rows[cat];
  // 如果 MID 有多排，按排序后的位置分配
  if (cat === 'MID' && Array.isArray(rowY)) {
    // 把所有 MID 球员按深度排序，按阵型数字分配到各排
    var sortedMids = categories.MID.slice();
    sortedMids.sort(function(a, b) {
      return midDepthRank(a.positionAbbr) - midDepthRank(b.positionAbbr);
    });
    var midParts = getMidParts(formation);
    var posIdx = sortedMids.indexOf(player);
    var cumulative = 0;
    for (var r = 0; r < midParts.length; r++) {
      cumulative += midParts[r];
      if (posIdx < cumulative) { rowY = rowY[r]; break; }
    }
    if (Array.isArray(rowY)) rowY = rowY[rowY.length - 1]; // fallback
  }
  var y = (typeof rowY === 'number') ? rowY : 48;

  // 同一排（同 Y）的球员按左→右排序
  var peers = getPeersInRow(player, cat, categories, formation);
  peers.sort(function(a, b) { return posOrder(a.positionAbbr) - posOrder(b.positionAbbr); });
  var idx = peers.indexOf(player);
  var count = peers.length;

  // X: 均匀分布
  var x;
  if (count <= 1) { x = 50; }
  else if (count === 2) { x = [28, 72][idx]; }
  else if (count === 3) { x = [18, 50, 82][idx]; }
  else if (count === 4) { x = [12, 36, 64, 88][idx]; }
  else { x = 8 + (84 * idx / (count - 1)); }

  return { x: x, y: y };
}

// 根据阵型计算每类球员的 Y 坐标百分比
function getFormationYRows(formation, categories) {
  var parts = (formation || '4-4-2').split('-').map(Number).filter(function(n) { return n > 0; });
  if (parts.length < 3) parts = [4, 4, 2]; // fallback

  var defCount = parts[0];
  var fwdCount = parts[parts.length - 1];
  var midParts = parts.slice(1, parts.length - 1); // 中场可能多排

  // 根据总排数分配 Y
  var totalRows = 1 + 1 + midParts.length + 1; // GK + DEF + MID rows + FWD
  // Y 从下到上: GK(88), DEF(74), MID rows..., FWD(16)
  var yPositions = [];
  yPositions.push(88); // GK
  yPositions.push(74); // DEF

  if (midParts.length === 1) {
    yPositions.push(46); // 单排中场
  } else if (midParts.length === 2) {
    yPositions.push(58); // 防守中场
    yPositions.push(34); // 进攻中场
  } else if (midParts.length >= 3) {
    yPositions.push(62);
    yPositions.push(44);
    yPositions.push(26);
  }

  yPositions.push(16); // FWD

  var result = { GK: yPositions[0], DEF: yPositions[1], FWD: yPositions[yPositions.length - 1] };
  result.MID = midParts.length === 1 ? yPositions[2] : yPositions.slice(2, 2 + midParts.length);
  return result;
}

// 阵型字符串中提取中场各排人数，如 "4-2-3-1" → [2, 3]
function getMidParts(formation) {
  var parts = (formation || '4-4-2').split('-').map(Number).filter(function(n) { return n > 0; });
  if (parts.length < 3) return [4];
  return parts.slice(1, parts.length - 1);
}

// 获取同一排（同 Y）的球员
function getPeersInRow(player, cat, categories, formation) {
  if (cat === 'GK' || cat === 'DEF' || cat === 'FWD') return categories[cat];

  // MID: 按深度分组
  var midParts = getMidParts(formation);
  if (midParts.length <= 1) return categories.MID;

  // 所有 MID 球员按深度排序
  var sortedMids = categories.MID.slice();
  sortedMids.sort(function(a, b) {
    return midDepthRank(a.positionAbbr) - midDepthRank(b.positionAbbr);
  });
  var posIdx = sortedMids.indexOf(player);

  // 按阵型数字分配到对应排
  var cumulative = 0;
  for (var r = 0; r < midParts.length; r++) {
    cumulative += midParts[r];
    if (posIdx < cumulative) {
      // 返回这一排的所有球员
      var start = cumulative - midParts[r];
      return sortedMids.slice(start, cumulative);
    }
  }
  return categories.MID;
}

// 中场球员深度排序: DM=0, CM=1, AM=2
function midDepthRank(abbr) {
  var a = (abbr || '').toUpperCase();
  if (/^(DM|CDM|LDM|RDM)/.test(a)) return 0;
  if (/^(AM|CAM|LAM|RAM)/.test(a)) return 2;
  return 1; // CM, LM, RM etc.
}

// 位置排序值：左=0, 中=2, 右=4
function posOrder(abbr) {
  var a = (abbr || '').toUpperCase();
  if (/(-L$|^LB$|^LWB$|^LW$|^LF$|^LM$)/.test(a)) return 0;
  if (/(-R$|^RB$|^RWB$|^RW$|^RF$|^RM$)/.test(a)) return 4;
  if (/(-CL$|^LCB$|^LDM$|^LCM$|^LCF$)/.test(a)) return 1;
  if (/(-CR$|^RCB$|^RDM$|^RCM$|^RCF$)/.test(a)) return 3;
  return 2;
}
