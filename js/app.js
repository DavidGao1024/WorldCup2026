// js/app.js
var FLAG_MAP = {
  'Mexico': '🇲🇽', 'South Africa': '🇿🇦', 'South Korea': '🇰🇷', 'Czech Republic': '🇨🇿',
  'Canada': '🇨🇦', 'Bosnia & Herzegovina': '🇧🇦', 'Qatar': '🇶🇦', 'Switzerland': '🇨🇭',
  'Brazil': '🇧🇷', 'Morocco': '🇲🇦', 'Haiti': '🇭🇹', 'Scotland': '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
  'USA': '🇺🇸', 'Paraguay': '🇵🇾', 'Australia': '🇦🇺', 'Turkey': '🇹🇷',
  'Germany': '🇩🇪', 'Curaçao': '🇨🇼', 'Ivory Coast': '🇨🇮', 'Ecuador': '🇪🇨',
  'Argentina': '🇦🇷', 'Japan': '🇯🇵', 'Spain': '🇪🇸', 'Egypt': '🇪🇬',
  'France': '🇫🇷', 'Ukraine': '🇺🇦', 'England': '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 'Norway': '🇳🇴',
  'Portugal': '🇵🇹', 'Netherlands': '🇳🇱', 'Italy': '🇮🇹', 'Uruguay': '🇺🇾',
  'Belgium': '🇧🇪', 'Colombia': '🇨🇴', 'Senegal': '🇸🇳', 'Iran': '🇮🇷',
  'Croatia': '🇭🇷', 'Denmark': '🇩🇰', 'Sweden': '🇸🇪', 'Poland': '🇵🇱',
  'Serbia': '🇷🇸', 'Chile': '🇨🇱', 'Peru': '🇵🇪', 'Mali': '🇲🇱',
  'Algeria': '🇩🇿', 'New Zealand': '🇳🇿', 'Saudi Arabia': '🇸🇦',
  'Tunisia': '🇹🇳', 'Cape Verde': '🇨🇻', 'Iraq': '🇮🇶', 'Austria': '🇦🇹',
  'DR Congo': '🇨🇩', 'Uzbekistan': '🇺🇿', 'Ghana': '🇬🇭', 'Panama': '🇵🇦',
  'Jordan': '🇯🇴'
};

function getFlag(teamName) {
  if (!teamName) return '🏳';
  if (teamName[0] === 'W') return '🏆';
  if (teamName[0] === 'L') return '🏳';
  return FLAG_MAP[teamName] || '🏳';
}

function roundKey(round) {
  var map = {
    'Round of 32': 'roundOf32', 'Round of 16': 'roundOf16',
    'Quarter-final': 'quarterFinal', 'Semi-final': 'semiFinal',
    'Match for third place': 'thirdPlace', 'Final': 'final'
  };
  return map[round] || 'groupStage';
}

var currentTab = 'schedule';

function switchTab(tab) {
  currentTab = tab;
  var allTabs = document.querySelectorAll('.tab');
  var allContent = document.querySelectorAll('.tab-content');
  for (var i = 0; i < allTabs.length; i++) allTabs[i].classList.remove('active');
  for (var j = 0; j < allContent.length; j++) allContent[j].classList.remove('active');
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById(tab + '-content').classList.add('active');

  if (tab === 'schedule') {
    var g = document.getElementById('filter-group');
    var tf = document.getElementById('filter-team');
    renderSchedule(g ? g.value : 'all', tf ? tf.value : 'all');
  } else if (tab === 'standings') {
    renderStandings();
  } else if (tab === 'knockout') {
    renderKnockout();
  }
}

function onFilterChange() {
  var g = document.getElementById('filter-group').value;
  var tf = document.getElementById('filter-team').value;
  renderSchedule(g, tf);
}

function onTimezoneChange() {
  setTimezone(document.getElementById('timezone-select').value);
  refreshCurrentTab();
}

function refreshCurrentTab() {
  switchTab(currentTab);
}

async function init() {
  document.getElementById('schedule-list').innerHTML = '<div class="spinner"></div>';

  await loadData();

  var tzSelect = document.getElementById('timezone-select');
  tzSelect.value = currentTZ;
  tzSelect.addEventListener('change', onTimezoneChange);

  updateUIText();
  populateFilters();
  switchTab('schedule');
}

function updateUIText() {
  document.getElementById('title').textContent = t('title');
  document.getElementById('subtitle').textContent = t('subtitle');
  document.getElementById('lang-btn').textContent = currentLang === 'zh' ? 'EN' : '中';

  var i18nEls = document.querySelectorAll('[data-i18n]');
  for (var i = 0; i < i18nEls.length; i++) {
    i18nEls[i].textContent = t(i18nEls[i].dataset.i18n);
  }
}

document.addEventListener('DOMContentLoaded', init);
