// js/knockout.js
// 淘汰赛对阵图。
//
// 对阵树构建策略：通过队伍名中的引用（W{num}/L{num}）和已完成比赛胜者反查
// 两种方式共同确定父子关系。这是因为数据源（openfootball/worldcup.json）在
// 比赛结束后会把占位引用替换为实际队名，单靠 parseRef 无法追踪已结束比赛的
// 晋级路径。findParent 先尝试引用解析，失败则在前一轮胜者中按队名查找。

var KO_ROUNDS = [
  'Round of 32', 'Round of 16', 'Quarter-final',
  'Semi-final', 'Match for third place', 'Final'
];

// 每轮应出现的比赛数（用于结构校验）
var KO_EXPECTED = { 'Round of 32': 16, 'Round of 16': 8, 'Quarter-final': 4, 'Semi-final': 2, 'Match for third place': 1, 'Final': 1 };

function getPrevRound(round) {
  var idx = KO_ROUNDS.indexOf(round);
  return idx > 0 ? KO_ROUNDS[idx - 1] : null;
}

// 按轮次索引胜者: { 'Round of 32': { 'France': 77 }, 'Round of 16': { 'France': 89 } }
// 避免同一球队在多轮中获胜时的歧义
function buildWinnersByRound(matches) {
  var wbr = {};
  KO_ROUNDS.forEach(function(r) { wbr[r] = {}; });
  matches.forEach(function(m) {
    if (m.score1 == null || !m.round) return;
    var w = null;
    if (m.hadPen) {
      if (m.score1p > m.score2p) w = m.team1;
      else if (m.score2p > m.score1p) w = m.team2;
      else if (m.winner) w = m.winner;
    } else if (m.score1 !== m.score2) {
      w = m.score1 > m.score2 ? m.team1 : m.team2;
    }
    if (w) wbr[m.round][w] = m.num;
  });
  return wbr;
}

function findParent(name, childRound, wbr) {
  if (!name) return 0;
  // 先尝试 W{num}/L{num} 引用解析
  if (name[0] === 'W' || name[0] === 'L') {
    return parseInt(name.substring(1)) || 0;
  }
  // 回退：在前一轮的胜者中查找该队名
  var prev = getPrevRound(childRound);
  if (prev && wbr[prev] && wbr[prev][name]) {
    return wbr[prev][name];
  }
  return 0;
}

function renderKnockout() {
  var container = document.getElementById('knockout-content');
  var matches = getKnockoutMatches();
  if (!matches.length) { container.innerHTML = '<div class="no-data">' + t('noData') + '</div>'; return; }

  var byNum = {};
  matches.forEach(function(m) { byNum[m.num] = m; });

  var wbr = buildWinnersByRound(matches);

  var parents = {};
  matches.forEach(function(m) {
    var p1 = findParent(m.team1, m.round, wbr), p2 = findParent(m.team2, m.round, wbr);
    if (p1 || p2) parents[m.num] = [p1, p2].filter(Boolean);
  });

  // 决赛的对阵双方确定左右半区
  var finalMatch = matches.find(function(m) { return m.round === 'Final'; });
  var sfNums = finalMatch ? (parents[finalMatch.num] || []) : [];
  // 回退：如果决赛引用丢失（数据已解析为实际队名），从 Semi-final 轮次直接取
  if (sfNums.length !== 2) {
    var sfMatches = matches.filter(function(m) { return m.round === 'Semi-final'; });
    sfNums = sfMatches.map(function(m) { return m.num; });
  }

  function collectHalf(sfNum) {
    var result = {};
    KO_ROUNDS.forEach(function(r) { result[r] = []; });
    if (!sfNum) return result;
    var queue = [{ num: sfNum, slot: 0, span: 8 }];
    var seen = {};
    while (queue.length > 0) {
      var item = queue.shift();
      if (seen[item.num]) continue;
      seen[item.num] = true;
      var m = byNum[item.num];
      if (!m) continue;
      result[m.round].push(item);
      var ps = parents[item.num];
      if (ps && ps.length === 2) {
        queue.push({ num: ps[0], slot: item.slot, span: item.span / 2 });
        queue.push({ num: ps[1], slot: item.slot + item.span / 2, span: item.span / 2 });
      }
    }
    KO_ROUNDS.forEach(function(r) { result[r].sort(function(a, b) { return a.slot - b.slot; }); });
    return result;
  }

  var leftTree = collectHalf(sfNums[0]);
  var rightTree = collectHalf(sfNums[1]);

  // 结构校验：确保每轮比赛数符合预期
  var allSlots = {};
  KO_ROUNDS.forEach(function(r) { allSlots[r] = (leftTree[r] || []).concat(rightTree[r] || []); });
  if (finalMatch) allSlots['Final'] = [finalMatch];
  var tpMatch = matches.find(function(m) { return m.round === 'Match for third place'; });
  if (tpMatch) allSlots['Match for third place'] = [tpMatch];

  for (var r in KO_EXPECTED) {
    var actual = (allSlots[r] || []).length;
    if (actual !== KO_EXPECTED[r]) {
      console.warn('[对阵图] ' + r + ' 应显示 ' + KO_EXPECTED[r] + ' 场，实际 ' + actual + ' 场。' +
        '可能是数据中引用链断裂，请检查 worldcup.json 中该轮比赛的 team1/team2 是否正确。');
    }
  }

  var totalH = 82 * 8;
  var html = '<div class="bracket-v">';

  // 左半区：R32 → R16 → QF → SF
  html += '<div class="br-half br-left">';
  ['Round of 32', 'Round of 16', 'Quarter-final', 'Semi-final'].forEach(function(r) {
    html += buildCol(r, leftTree, byNum, totalH);
  });
  html += '</div>';

  // 中间：决赛 + 三四名
  html += '<div class="br-center">';
  html += '<div class="br-vcol"><div class="br-vslots" style="height:' + totalH + 'px">';
  // 决赛对齐 SF 高度（50%），三四名放下面
  if (finalMatch) {
    html += '<div class="br-slot br-final-slot" style="top:34%;height:30%;" data-match="' + finalMatch.num + '">';
    html += renderBracketMatch(finalMatch, byNum);
    html += '</div>';
  }
  var tp = matches.find(function(m) { return m.round === 'Match for third place'; });
  if (tp) {
    html += '<div class="br-slot br-third-slot" style="top:68%;height:24%;" data-match="' + tp.num + '">';
    html += renderBracketMatch(tp, byNum);
    html += '</div>';
  }
  html += '</div></div></div>';

  // 右半区：SF ← QF ← R16 ← R32
  html += '<div class="br-half br-right">';
  ['Semi-final', 'Quarter-final', 'Round of 16', 'Round of 32'].forEach(function(r) {
    html += buildCol(r, rightTree, byNum, totalH);
  });
  html += '</div>';

  html += '</div>';
  container.innerHTML = html;

  container.querySelectorAll('.br-match').forEach(function(el) {
    el.addEventListener('click', function(e) {
      e.stopPropagation();
      var num = parseInt(el.closest('.br-slot').getAttribute('data-match'));
      if (num && typeof showMatchModal === 'function') showMatchModal(num);
    });
  });

  setTimeout(drawLines, 200);
  window.addEventListener('resize', drawLines);
}

function buildCol(round, tree, byNum, totalH) {
  var list = tree[round] || [];
  var html = '<div class="br-vcol"><div class="br-vslots" style="height:' + totalH + 'px">';
  list.forEach(function(item) {
    var m = byNum[item.num];
    if (!m) return;
    var topPct = (item.slot / 8 * 100);
    var hPct = (item.span / 8 * 100);
    html += '<div class="br-slot" style="top:' + topPct + '%;height:' + hPct + '%;" data-match="' + m.num + '">';
    html += renderBracketMatch(m, byNum);
    html += '</div>';
  });
  html += '</div></div>';
  return html;
}

function parseRef(name) {
  if (!name) return 0;
  if (name[0] === 'W' || name[0] === 'L') return parseInt(name.substring(1)) || 0;
  return 0;
}

function renderBracketMatch(m, byNum) {
  var hasScore = m.score1 != null && m.score2 != null;
  var w1 = false, w2 = false;
  if (hasScore) {
    if (m.hadPen) {
      if (m.score1p != null) { w1 = m.score1p > m.score2p; w2 = m.score2p > m.score1p; }
      else if (m.winner) { w1 = m.winner === m.team1; w2 = m.winner === m.team2; }
    } else {
      w1 = m.score1 > m.score2; w2 = m.score2 > m.score1;
    }
  }

  var s1 = hasScore ? m.score1 : '-';
  var s2 = hasScore ? m.score2 : '-';
  if (hasScore && m.hadPen) {
    s1 += ' <span class="br-pen">(' + (m.score1p != null ? m.score1p : '') + ')</span>';
    s2 += ' <span class="br-pen">(' + (m.score2p != null ? m.score2p : '') + ')</span>';
  } else if (hasScore && m.hadET) {
    s1 += ' <span class="br-et">' + t('aetShort') + '</span>';
    s2 += ' <span class="br-et">' + t('aetShort') + '</span>';
  }

  var t1 = isPlaceholder(m.team1) ? resolveTeam(m.team1, byNum) : trTeam(m.team1);
  var t2 = isPlaceholder(m.team2) ? resolveTeam(m.team2, byNum) : trTeam(m.team2);
  var ph1 = isPlaceholder(m.team1), ph2 = isPlaceholder(m.team2);
  var f1 = ph1 ? (isResolved(m.team1, byNum) ? getFlagImg(resolveWinner(m.team1, byNum)) : '') : getFlagImg(m.team1);
  var f2 = ph2 ? (isResolved(m.team2, byNum) ? getFlagImg(resolveWinner(m.team2, byNum)) : '') : getFlagImg(m.team2);
  var isPH = (ph1 && !isResolved(m.team1, byNum)) && (ph2 && !isResolved(m.team2, byNum));

  return '<div class="br-match' + (isPH ? ' br-ph' : '') + '">' +
    '<div class="br-team' + (w1 ? ' br-winner' : '') + '">' + f1 + '<span class="br-name">' + t1 + '</span><span class="br-score">' + s1 + '</span></div>' +
    '<div class="br-team' + (w2 ? ' br-winner' : '') + '">' + f2 + '<span class="br-name">' + t2 + '</span><span class="br-score">' + s2 + '</span></div>' +
  '</div>';
}

function drawLines() {
  var container = document.querySelector('.bracket-v');
  if (!container) return;
  var oldSvg = container.querySelector('.br-lines');
  if (oldSvg) oldSvg.remove();

  var matches = container.querySelectorAll('.br-match');
  var maxRight = 0, maxBottom = 0;
  var cr = container.getBoundingClientRect();
  matches.forEach(function(m) {
    var r = m.getBoundingClientRect();
    if (r.right - cr.left > maxRight) maxRight = r.right - cr.left;
    if (r.bottom - cr.top > maxBottom) maxBottom = r.bottom - cr.top;
  });
  var w = Math.max(maxRight + 20, cr.width);
  var h = Math.max(maxBottom + 20, cr.height);

  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('br-lines');
  svg.style.cssText = 'position:absolute;top:0;left:0;width:' + w + 'px;height:' + h + 'px;pointer-events:none;z-index:0';
  container.appendChild(svg);

  var drawn = {};
  var koMatches = getKnockoutMatches();
  var lineWbr = buildWinnersByRound(koMatches);
  koMatches.forEach(function(m) {
    if (m.round === 'Match for third place' || m.round === 'Final') return;
    [m.team1, m.team2].forEach(function(t) {
      var pnum = findParent(t, m.round, lineWbr);
      if (!pnum) return;
      var key = Math.min(pnum, m.num) + '-' + Math.max(pnum, m.num);
      if (drawn[key]) return;
      drawn[key] = true;
      var pSlot = container.querySelector('[data-match="' + pnum + '"]');
      var cSlot = container.querySelector('[data-match="' + m.num + '"]');
      if (pSlot && cSlot) drawLine(pSlot, cSlot, svg, container);
    });
  });

  // 决赛直连：两 SF 各画一条水平直线到决赛卡片
  var finalSlot = container.querySelector('[data-match="104"]');
  var sf101 = container.querySelector('[data-match="101"]');
  var sf102 = container.querySelector('[data-match="102"]');
  [sf101, sf102].forEach(function(sf) {
    if (!sf || !finalSlot) return;
    var fm = sf.querySelector('.br-match');
    var tm = finalSlot.querySelector('.br-match');
    if (!fm || !tm) return;
    var cr = container.getBoundingClientRect();
    var rf = fm.getBoundingClientRect();
    var rt = tm.getBoundingClientRect();

    var goRight = rt.left > rf.right;
    var x1 = goRight ? rf.right - cr.left : rf.left - cr.left;
    var y1 = rf.top + rf.height / 2 - cr.top;
    var x2 = goRight ? rt.left - cr.left : rt.right - cr.left;
    var y2 = y1;

    var path = 'M' + x1 + ',' + y1 + ' L' + x2 + ',' + y2;

    var line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('d', path);
    line.setAttribute('stroke', '#ffd700');
    line.setAttribute('stroke-width', '1.4');
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke-linecap', 'round');
    svg.appendChild(line);
  });
}

function drawLine(fromSlot, toSlot, svg, container) {
  var fm = fromSlot.querySelector('.br-match');
  var tm = toSlot.querySelector('.br-match');
  if (!fm || !tm) return;

  var cr = container.getBoundingClientRect();
  var rf = fm.getBoundingClientRect();
  var rt = tm.getBoundingClientRect();

  var goRight = rt.left > rf.right;
  var x1 = goRight ? rf.right - cr.left + 4 : rf.left - cr.left - 4;
  var y1 = rf.top + rf.height / 2 - cr.top;
  var x2 = goRight ? rt.left - cr.left - 4 : rt.right - cr.left + 4;
  var y2 = rt.top + rt.height / 2 - cr.top;

  var midX = goRight ? x1 + (x2 - x1) * 0.45 : x1 - (x1 - x2) * 0.45;

  var path = 'M' + x1 + ',' + y1 + ' H' + midX + ' V' + y2 + ' H' + x2;

  var line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  line.setAttribute('d', path);
  line.setAttribute('stroke', '#2d6a3e');
  line.setAttribute('stroke-width', '1.2');
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke-linecap', 'round');
  line.setAttribute('opacity', '0.7');
  svg.appendChild(line);
}

function placeholderLabel(name) {
  if (name[0] === 'W') return t('winnerOf') + ' ' + name.substring(1);
  if (name[0] === 'L') return t('loserOf') + ' ' + name.substring(1);
  if (/^\d[A-Z]/.test(name)) return name.substring(1) + t('groupFirst');
  return name;
}

// 如果引用的比赛已有结果，返回晋级队名，否则返回占位文本
function resolveTeam(name, byNum) {
  var ref = parseRef(name);
  if (!ref) return placeholderLabel(name);
  var m = byNum[ref];
  if (!m || m.score1 == null) return placeholderLabel(name);
  if (m.hadPen) {
    if (m.score1p > m.score2p) return trTeam(m.team1);
    if (m.score2p > m.score1p) return trTeam(m.team2);
    if (m.winner) return trTeam(m.winner);
  }
  if (m.score1 > m.score2) return trTeam(m.team1);
  if (m.score2 > m.score1) return trTeam(m.team2);
  return placeholderLabel(name);
}

function resolveWinner(name, byNum) {
  var ref = parseRef(name);
  if (!ref) return name;
  var m = byNum[ref];
  if (!m || m.score1 == null) return name;
  if (m.hadPen) {
    if (m.score1p > m.score2p) return m.team1;
    if (m.score2p > m.score1p) return m.team2;
    if (m.winner) return m.winner;
  }
  if (m.score1 > m.score2) return m.team1;
  if (m.score2 > m.score1) return m.team2;
  return name;
}

function isResolved(name, byNum) {
  var ref = parseRef(name);
  if (!ref) return false;
  var m = byNum[ref];
  return m && m.score1 != null && (m.score1 !== m.score2 || m.hadPen);
}
