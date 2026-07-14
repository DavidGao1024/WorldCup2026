// js/lottery.js
var lotteryData = null;
var lotterySelected = []; // [{ matchNum, pool, option, odds, matchLabel, poolLabel, optionLabel }]
var lotteryActivePool = {}; // { matchNum: 'HAD' }

var TEAM_ZH_REVERSE = {};
(function() {
  var keys = Object.keys(TEAM_ZH);
  for (var i = 0; i < keys.length; i++) {
    TEAM_ZH_REVERSE[TEAM_ZH[keys[i]]] = keys[i];
  }
})();

var POOL_META = {
  HAD:  { key: 'lotteryHAD',  options: [{ id: 'h', label: 'lotteryHome' }, { id: 'd', label: 'lotteryDraw' }, { id: 'a', label: 'lotteryAway' }] },
  HHAD: { key: 'lotteryHHAD', options: [{ id: 'h', label: 'lotteryHome' }, { id: 'd', label: 'lotteryDraw' }, { id: 'a', label: 'lotteryAway' }] },
  TTG:  { key: 'lotteryTTG',  options: [
    { id: 's0', label: '0' }, { id: 's1', label: '1' }, { id: 's2', label: '2' }, { id: 's3', label: '3' },
    { id: 's4', label: '4' }, { id: 's5', label: '5' }, { id: 's6', label: '6' }, { id: 's7', label: '7+' }
  ]},
  HAFU: { key: 'lotteryHAFU', options: [
    { id: 'hh', label: 'lotteryHH' }, { id: 'hd', label: 'lotteryHD' }, { id: 'ha', label: 'lotteryHA' },
    { id: 'dh', label: 'lotteryDH' }, { id: 'dd', label: 'lotteryDD' }, { id: 'da', label: 'lotteryDA' },
    { id: 'ah', label: 'lotteryAH' }, { id: 'ad', label: 'lotteryAD' }, { id: 'aa', label: 'lotteryAA' }
  ]},
  CRS:  { key: 'lotteryCRS', options: [] }
};
var POOL_ORDER = ['HAD', 'HHAD', 'CRS', 'TTG', 'HAFU'];

// CRS 比分固定顺序：主胜12个 + 胜其他, 平局4个 + 平其他, 客胜12个 + 负其他
var CRS_SCORE_ORDER = [
  's01s00', 's02s00', 's02s01', 's03s00', 's03s01', 's03s02',
  's04s00', 's04s01', 's04s02', 's05s00', 's05s01', 's05s02', 's1sa',
  's00s00', 's01s01', 's02s02', 's03s03', 's1sd',
  's00s01', 's00s02', 's01s02', 's00s03', 's01s03', 's02s03',
  's00s04', 's01s04', 's02s04', 's00s05', 's01s05', 's02s05', 's1sh'
];
var CRS_LABEL_MAP = {
  's1sa': 'lotteryOtherHome', 's1sd': 'lotteryOtherDraw', 's1sh': 'lotteryOtherAway'
};

function fetchLotteryOdds() {
  return fetch('data/lottery-odds.json')
    .then(function(r) { return r.json(); })
    .catch(function() { return null; });
}

function matchLotteryToSchedule(lotteryMatches) {
  var scheduleMatches = (typeof worldCupData !== 'undefined' && worldCupData.matches) ? worldCupData.matches : [];
  var result = [];

  for (var i = 0; i < lotteryMatches.length; i++) {
    var lm = lotteryMatches[i];
    var homeEn = TEAM_ZH_REVERSE[lm.homeTeam] || lm.homeTeamEn;
    var awayEn = TEAM_ZH_REVERSE[lm.awayTeam] || lm.awayTeamEn;
    var matched = null;

    for (var j = 0; j < scheduleMatches.length; j++) {
      var sm = scheduleMatches[j];
      if (sm.date === lm.matchDate) {
        var t1 = sm.team1, t2 = sm.team2;
        if ((t1 === homeEn && t2 === awayEn) || (t1 === awayEn && t2 === homeEn)) {
          matched = sm;
          break;
        }
      }
    }

    result.push({
      matchNum: lm.matchNum,
      matchNumStr: lm.matchNumStr,
      matchDate: lm.matchDate,
      matchTime: lm.matchTime,
      homeTeam: lm.homeTeam,
      awayTeam: lm.awayTeam,
      homeTeamEn: homeEn,
      awayTeamEn: awayEn,
      homeRank: lm.homeRank,
      awayRank: lm.awayRank,
      pools: lm.pools,
      availablePools: lm.availablePools,
      status: lm.status,
      group: matched ? matched.group : null,
      ground: matched ? matched.ground : null
    });
  }
  return result;
}

function getSelectionsForMatch(matchNum) {
  var idxs = [];
  for (var i = 0; i < lotterySelected.length; i++) {
    if (lotterySelected[i].matchNum === matchNum) idxs.push(i);
  }
  return idxs;
}

function getSelectedMatchNums() {
  var nums = [];
  for (var i = 0; i < lotterySelected.length; i++) {
    var mn = lotterySelected[i].matchNum;
    if (nums.indexOf(mn) === -1) nums.push(mn);
  }
  return nums;
}

function findPoolMeta(matchNum, poolCode) {
  var m = findMatch(matchNum);
  if (!m) return null;
  var pools = m.availablePools;
  for (var i = 0; i < pools.length; i++) {
    if (pools[i].poolCode === poolCode) return pools[i];
  }
  return null;
}

function isSelectionValid() {
  if (lotterySelected.length === 0) return false;
  var matchNums = getSelectedMatchNums();
  if (matchNums.length === 1) {
    // Single match: check if its pool allows single
    var sel = lotterySelected[0];
    var meta = findPoolMeta(sel.matchNum, sel.pool);
    return meta && meta.bettingSingle === 1;
  }
  return true;
}

// Group by (matchNum, pool), then by matchNum.
// Each (matchNum, pool) = one "leg set".
// A valid parlay picks one pool per match, then one option from that pool.
// 注数 = product over matches of (total options across all pools for that match)
function getSelectionGroupsByPool() {
  var poolGroups = {}; // key: "matchNum:pool"
  for (var i = 0; i < lotterySelected.length; i++) {
    var s = lotterySelected[i];
    var key = s.matchNum + ':' + s.pool;
    if (!poolGroups[key]) {
      poolGroups[key] = { matchNum: s.matchNum, pool: s.pool, matchLabel: s.matchLabel, odds: [] };
    }
    poolGroups[key].odds.push(s.odds);
  }
  return poolGroups;
}

// Group poolGroups by matchNum
function getMatchGroups() {
  var poolGroups = getSelectionGroupsByPool();
  var matchGroups = {}; // key: matchNum
  var keys = Object.keys(poolGroups);
  for (var i = 0; i < keys.length; i++) {
    var pg = poolGroups[keys[i]];
    if (!matchGroups[pg.matchNum]) {
      matchGroups[pg.matchNum] = [];
    }
    matchGroups[pg.matchNum].push(pg);
  }
  return matchGroups;
}

function computeOddsRange() {
  var matchGroups = getMatchGroups();
  var matchKeys = Object.keys(matchGroups);

  // Edge: no selections
  if (matchKeys.length === 0) return { min: 0, max: 0, comboCount: 0 };

  // Generate all parlays: for each match, pick one pool, then one option
  // Start with a list of "partial parlays" each being a single odds value
  var parlayOdds = [];
  var first = true;

  for (var m = 0; m < matchKeys.length; m++) {
    var pools = matchGroups[matchKeys[m]];
    // Collect all leg-options for this match: all odds across all pools
    var legOdds = [];
    for (var p = 0; p < pools.length; p++) {
      for (var o = 0; o < pools[p].odds.length; o++) {
        legOdds.push(pools[p].odds[o]);
      }
    }
    // Cross-product
    if (first) {
      parlayOdds = legOdds.slice();
      first = false;
    } else {
      var newOdds = [];
      for (var c = 0; c < parlayOdds.length; c++) {
        for (var l = 0; l < legOdds.length; l++) {
          newOdds.push(parlayOdds[c] * legOdds[l]);
        }
      }
      parlayOdds = newOdds;
    }
  }

  var min = parlayOdds[0], max = parlayOdds[0];
  for (var k = 1; k < parlayOdds.length; k++) {
    if (parlayOdds[k] < min) min = parlayOdds[k];
    if (parlayOdds[k] > max) max = parlayOdds[k];
  }
  return { min: min, max: max, comboCount: parlayOdds.length };
}

function getParlayTag() {
  var matchCount = getSelectedMatchNums().length;
  if (matchCount < 2) return '';
  return t('lotteryParlay').replace('{n}', matchCount);
}

function renderLottery() {
  var container = document.getElementById('lottery-content');

  if (!lotteryData || !lotteryData.matches) {
    container.innerHTML = '<div class="spinner"></div>';
    fetchLotteryOdds().then(function(data) {
      if (data && data.matches) {
        lotteryData = data;
        lotteryData._matches = matchLotteryToSchedule(data.matches);
      }
      renderLottery();
    });
    return;
  }

  var allMatches = lotteryData._matches;
  // 过滤已开赛的比赛
  var now = new Date();
  var matches = allMatches.filter(function(m) {
    var kickoff = new Date(m.matchDate + 'T' + m.matchTime);
    return kickoff > now;
  });
  var html = '';

  html += '<div class="lottery-info">';
  html += '<span>' + t('lotteryUpdateTime') + ': <span class="update-time">' + formatLotteryTime(lotteryData.updateTime) + '</span></span>';
  html += '<span>' + t('lotteryMatchCount').replace('{count}', matches.length) + '</span>';
  html += '</div>';

  // Analysis-based recommendations if data loaded
  if (typeof analysisData !== 'undefined' && Object.keys(analysisData).length > 0 && typeof renderLotteryRecs === 'function') {
    html += renderLotteryRecs(matches);
  }

  for (var i = 0; i < matches.length; i++) {
    html += renderMatchCard(matches[i]);
  }

  html += renderBetBar();

  container.innerHTML = html;
  bindLotteryEvents();
  updateBetPayout();
}

function formatLotteryTime(isoStr) {
  if (!isoStr) return '';
  var d = new Date(isoStr);
  var month = d.getMonth() + 1;
  var day = d.getDate();
  var hours = d.getHours();
  var mins = d.getMinutes();
  return month + '/' + day + ' ' + (hours < 10 ? '0' : '') + hours + ':' + (mins < 10 ? '0' : '') + mins;
}

function renderMatchCard(m) {
  var homeFlag = getFlagImg(m.homeTeamEn);
  var awayFlag = getFlagImg(m.awayTeamEn);
  var homeDisp = currentLang === 'zh' ? m.homeTeam : m.homeTeamEn;
  var awayDisp = currentLang === 'zh' ? m.awayTeam : m.awayTeamEn;

  var html = '<div class="lottery-card">';
  // Header
  html += '<div class="lottery-card-header">';
  html += '<div class="match-label">';
  html += '<span class="match-num">' + m.matchNumStr + '</span>';
  html += '<span class="match-date">' + m.matchDate + ' ' + m.matchTime.substring(0, 5) + '</span>';
  html += '</div>';
  html += '<div class="match-teams">';
  html += '<div class="team-col">' + homeFlag + '<span class="team-name">' + homeDisp + '</span>';
  if (m.homeRank) html += '<span class="team-rank">' + m.homeRank + '</span>';
  html += '</div>';
  html += '<span class="vs-text">VS</span>';
  html += '<div class="team-col">' + awayFlag + '<span class="team-name">' + awayDisp + '</span>';
  if (m.awayRank) html += '<span class="team-rank">' + m.awayRank + '</span>';
  html += '</div>';
  if (m.group) html += '<div style="text-align:center;margin-top:6px;font-size:0.75rem;color:#86efac;">' + m.group + '</div>';
  html += '</div>';

  // Pool tabs with single/parlay badge
  var activePool = lotteryActivePool[m.matchNum] || 'HAD';
  html += '<div class="lottery-pool-tabs">';
  for (var p = 0; p < POOL_ORDER.length; p++) {
    var poolCode = POOL_ORDER[p];
    var poolMeta = findPoolMeta(m.matchNum, poolCode);
    var badge = '';
    if (poolMeta) {
      if (poolMeta.bettingSingle === 1) {
        badge = '<span class="pool-badge single" title="' + t('lotterySingleOk') + '">●</span>';
      } else {
        badge = '<span class="pool-badge parlay" title="' + t('lotteryParlayOnly') + '">◐</span>';
      }
    }
    html += '<div class="lottery-pool-tab' + (poolCode === activePool ? ' active' : '') + '" data-pool="' + poolCode + '" data-match="' + m.matchNum + '">' + t(POOL_META[poolCode].key) + badge + '</div>';
  }
  html += '</div>';

  html += '<div class="lottery-odds-content" data-match="' + m.matchNum + '" data-pool="' + activePool + '">';
  html += renderOddsRow(m, activePool);
  html += '</div>';

  html += '</div>';
  return html;
}

function getCrsOptions(pool) {
  var options = [];
  for (var i = 0; i < CRS_SCORE_ORDER.length; i++) {
    var key = CRS_SCORE_ORDER[i];
    if (typeof pool[key] === 'undefined' || pool[key] === null) continue;
    var label;
    if (CRS_LABEL_MAP[key]) {
      label = t(CRS_LABEL_MAP[key]);
    } else {
      // s01s02 → "1:2"
      var home = parseInt(key.substring(1, 3));
      var away = parseInt(key.substring(4, 6));
      label = home + ':' + away;
    }
    options.push({ id: key, label: label, _raw: true });
  }
  return options;
}

function renderOddsRow(m, poolCode) {
  var pool = m.pools[poolCode];
  var meta = POOL_META[poolCode];
  var options;

  if (poolCode === 'CRS') {
    if (!pool) return '<div class="lottery-no-data">' + t('lotteryNoData') + '</div>';
    options = getCrsOptions(pool);
    if (options.length === 0) return '<div class="lottery-no-data">' + t('lotteryNoData') + '</div>';
  } else {
    var firstOpt = meta.options[0];
    var hasData = pool && firstOpt && typeof pool[firstOpt.id] !== 'undefined' && pool[firstOpt.id] !== null;
    if (!hasData) {
      return '<div class="lottery-no-data">' + t('lotteryNoData') + '</div>';
    }
    options = meta.options;
  }

  var html = '<div class="lottery-odds-row pool-' + poolCode.toLowerCase() + '">';
  for (var i = 0; i < options.length; i++) {
    var opt = options[i];
    var odds = pool[opt.id];
    var selIdxs = getSelectionsForMatch(m.matchNum);
    var isSelected = false;
    for (var s = 0; s < selIdxs.length; s++) {
      if (lotterySelected[selIdxs[s]].pool === poolCode && lotterySelected[selIdxs[s]].option === opt.id) {
        isSelected = true; break;
      }
    }
    var isOther = poolCode === 'CRS' && CRS_LABEL_MAP[opt.id];
    html += '<div class="lottery-odds-btn' + (isSelected ? ' selected' : '') + (isOther ? ' crs-other' : '') + '" data-match="' + m.matchNum + '" data-pool="' + poolCode + '" data-option="' + opt.id + '" data-odds="' + odds + '">';
    html += '<span class="odds-label">' + (opt._raw ? opt.label : t(opt.label)) + '</span>';
    html += '<span class="odds-value">' + odds.toFixed(2) + '</span>';
    if (poolCode === 'HHAD' && pool.goalLine) {
      html += '<span class="odds-goalline">' + t('lotteryGoalLine') + ' ' + pool.goalLine + '</span>';
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function renderBetBar() {
  var hasSel = lotterySelected.length > 0;
  var valid = isSelectionValid();
  var matchCount = getSelectedMatchNums().length;
  var range = hasSel ? computeOddsRange() : null;
  var html = '<div class="bet-bar' + (hasSel ? ' has-selection' : '') + (valid ? ' is-valid' : '') + '">';
  html += '<div class="bet-selection">';

  if (hasSel) {
    html += '<span class="bet-count">' + t('lotterySelectedCount').replace('{n}', matchCount) + '</span>';
    if (range && range.comboCount > 1) {
      html += ' <span class="bet-combo-hint">' + t('lotteryComboCount').replace('{n}', range.comboCount) + '</span>';
    }
    if (matchCount > 1) {
      var parlay = getParlayTag();
      if (range.comboCount === 1) {
        html += ' <span class="bet-combined-inline">' + parlay + ' @' + range.min.toFixed(2) + '</span>';
      } else {
        html += ' <span class="bet-combined-inline">' + parlay + '</span>';
      }
    }
    if (!valid) {
      html += '<span class="bet-warning">' + t('lotteryNeedParlay') + '</span>';
    }
    html += '<button class="bet-detail-btn" onclick="showBetDetail()">' + t('lotteryDetail') + '</button>';
  } else {
    html += '<span class="bet-none">' + t('lotteryNone') + '</span>';
  }

  html += '</div>';
  html += '</div>';

  // Modal
  html += '<div class="bet-modal-overlay" id="bet-modal" style="display:none" onclick="closeBetDetail(event)">';
  html += '<div class="bet-modal" onclick="event.stopPropagation()">';
  html += '<div class="bet-modal-header">';
  html += '<span class="bet-modal-title">' + t('lotteryDetail') + '</span>';
  html += '<button class="bet-modal-close" onclick="closeBetDetail()">✕</button>';
  html += '</div>';
  html += '<div class="bet-modal-body">';
  // Selection list grouped by match, then by pool
  if (hasSel) {
    var matchGroups = getMatchGroups();
    var matchKeys = Object.keys(matchGroups);
    for (var m = 0; m < matchKeys.length; m++) {
      var pools = matchGroups[matchKeys[m]];
      var matchLabel = pools[0].matchLabel;
      html += '<div class="bet-modal-match-group">';
      html += '<div class="bet-modal-match-name">' + matchLabel + '</div>';
      for (var p = 0; p < pools.length; p++) {
        html += '<div class="bet-modal-pool-row"><span class="bet-modal-pool-tag">' + t(POOL_META[pools[p].pool].key) + '</span>';
        for (var s = 0; s < lotterySelected.length; s++) {
          var sel = lotterySelected[s];
          if (sel.matchNum === pools[p].matchNum && sel.pool === pools[p].pool) {
            html += '<div class="bet-modal-item">';
            html += '<span class="bet-modal-opt-label">' + t(sel.optionLabel) + '</span>';
            html += '<span class="bet-modal-odds">@' + sel.odds.toFixed(2) + '</span>';
            html += '<span class="bet-modal-remove" data-idx="' + s + '" onclick="removeBetSelection(' + s + ')">✕</span>';
            html += '</div>';
          }
        }
        html += '</div>';
      }
      html += '</div>';
    }
  }
  html += '</div>';
  // Footer
  html += '<div class="bet-modal-footer">';
  html += '<div class="bet-modal-row">';
  html += '<label>' + t('lotteryMultiplier') + '</label>';
  html += '<div class="bet-multiplier-wrap">';
  html += '<button class="bet-mult-btn" onclick="changeMultiplier(-1)">−</button>';
  html += '<input type="number" id="bet-multiplier" value="1" min="1" max="999" onchange="updateBetPayout()" oninput="updateBetPayout()">';
  html += '<button class="bet-mult-btn" onclick="changeMultiplier(1)">+</button>';
  html += '</div>';
  html += '</div>';
  if (range && range.comboCount > 0) {
    if (matchCount > 1) {
      html += '<div class="bet-modal-row bet-modal-combined">';
      html += '<span>' + getParlayTag() + ' ' + t('lotteryCombined') + '</span>';
      html += '<span></span>';
      html += '</div>';
    }
    html += '<div class="bet-modal-row">';
    html += '<span>' + t('lotteryComboCount').replace('{n}', range.comboCount) + '</span>';
    html += '<span class="combo-count-val">' + t('lotteryPerBet') + ' × ' + range.comboCount + ' = ¥' + (range.comboCount * 2).toFixed(0) + '</span>';
    html += '</div>';
    html += '<div class="bet-modal-row bet-modal-payout">';
    html += '<span>' + t('lotteryEstimated') + '</span>';
    html += '<span><span class="payout-amount" id="bet-payout-amount">¥0</span><span class="payout-range" id="bet-payout-range"></span></span>';
    html += '</div>';
    html += '<div class="bet-modal-row">';
    html += '<span>' + t('lotteryTotalCost') + '</span>';
    html += '<span class="total-cost" id="bet-total-cost">¥0</span>';
    html += '</div>';
  }
  if (!valid) {
    html += '<div class="bet-modal-warning">' + t('lotteryNeedParlay') + '</div>';
  }
  html += '</div>';
  html += '</div></div>';

  return html;
}

function showBetDetail() {
  document.getElementById('bet-modal').style.display = 'flex';
  updateBetPayout();
}

function closeBetDetail(e) {
  if (e && e.target !== document.getElementById('bet-modal')) return;
  document.getElementById('bet-modal').style.display = 'none';
}

function removeBetSelection(idx) {
  lotterySelected.splice(idx, 1);
  renderLottery();
}

function changeMultiplier(delta) {
  var input = document.getElementById('bet-multiplier');
  if (!input) return;
  var val = (parseInt(input.value) || 0) + delta;
  if (val < 0) val = 0;
  if (val > 999) val = 999;
  input.value = val;
  updateBetPayout();
}

function bindLotteryEvents() {
  var tabs = document.querySelectorAll('.lottery-pool-tab');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].onclick = function() {
      var matchNum = parseInt(this.dataset.match);
      var pool = this.dataset.pool;
      lotteryActivePool[matchNum] = pool;
      var siblings = this.parentElement.querySelectorAll('.lottery-pool-tab');
      for (var s = 0; s < siblings.length; s++) { siblings[s].classList.remove('active'); }
      this.classList.add('active');
      var content = this.parentElement.parentElement.querySelector('.lottery-odds-content');
      content.dataset.pool = pool;
      var m = findMatch(matchNum);
      content.innerHTML = renderOddsRow(m, pool);
      bindOddsButtons(content);
    };
  }

  var oddsBtns = document.querySelectorAll('.lottery-odds-btn');
  for (var j = 0; j < oddsBtns.length; j++) {
    bindOddsButton(oddsBtns[j]);
  }
}

function bindOddsButtons(container) {
  var btns = container.querySelectorAll ? container.querySelectorAll('.lottery-odds-btn') : [];
  if (!container.querySelectorAll) { btns = [container]; }
  for (var j = 0; j < btns.length; j++) {
    bindOddsButton(btns[j]);
  }
}

function bindOddsButton(btn) {
  btn.onclick = function() {
    var matchNum = parseInt(this.dataset.match);
    var pool = this.dataset.pool;
    var option = this.dataset.option;
    var odds = parseFloat(this.dataset.odds);
    var m = findMatch(matchNum);

    var matchLabel = (currentLang === 'zh' ? m.homeTeam : m.homeTeamEn) + ' vs ' + (currentLang === 'zh' ? m.awayTeam : m.awayTeamEn);
    var poolLabel = POOL_META[pool].key;
    var optionLabel = '';
    if (pool === 'CRS') {
      if (CRS_LABEL_MAP[option]) {
        optionLabel = t(CRS_LABEL_MAP[option]);
      } else {
        var ch = parseInt(option.substring(1, 3));
        var ca = parseInt(option.substring(4, 6));
        optionLabel = ch + ':' + ca;
      }
    } else {
      var metaOptions = POOL_META[pool].options;
      for (var o = 0; o < metaOptions.length; o++) {
        if (metaOptions[o].id === option) { optionLabel = metaOptions[o].label; break; }
      }
    }

    // Find if this exact option is already selected
    var foundIdx = -1;
    for (var s = 0; s < lotterySelected.length; s++) {
      if (lotterySelected[s].matchNum === matchNum && lotterySelected[s].pool === pool && lotterySelected[s].option === option) {
        foundIdx = s; break;
      }
    }

    if (foundIdx !== -1) {
      // Deselect this option
      lotterySelected.splice(foundIdx, 1);
    } else {
      lotterySelected.push({
        matchNum: matchNum, pool: pool, option: option, odds: odds,
        matchLabel: matchLabel, poolLabel: poolLabel, optionLabel: optionLabel
      });
    }

    renderLottery();
  };
}

function findMatch(matchNum) {
  var matches = lotteryData._matches;
  for (var i = 0; i < matches.length; i++) {
    if (matches[i].matchNum === matchNum) return matches[i];
  }
  return null;
}

function updateBetPayout() {
  var input = document.getElementById('bet-multiplier');
  var payoutEl = document.getElementById('bet-payout-amount');
  var rangeEl = document.getElementById('bet-payout-range');
  var costEl = document.getElementById('bet-total-cost');
  if (!input || !payoutEl) return;
  var multiplier = parseInt(input.value) || 0;
  if (multiplier < 0) { input.value = 0; multiplier = 0; }
  if (isSelectionValid() && multiplier > 0) {
    var range = computeOddsRange();
    var minPayout = (multiplier * 2 * range.min).toFixed(2);
    if (range.comboCount === 1) {
      payoutEl.textContent = '¥' + minPayout;
      if (rangeEl) rangeEl.textContent = '';
    } else {
      var maxPayout = (multiplier * 2 * range.max).toFixed(2);
      payoutEl.textContent = '¥' + minPayout;
      if (rangeEl) rangeEl.textContent = ' ~ ¥' + maxPayout;
    }
    if (costEl) {
      var totalCost = (range.comboCount * 2 * multiplier).toFixed(0);
      costEl.textContent = '¥' + totalCost;
    }
  } else {
    payoutEl.textContent = '¥0';
    if (rangeEl) rangeEl.textContent = '';
    if (costEl) costEl.textContent = '¥0';
  }
}
