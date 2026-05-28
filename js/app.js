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

function getFlagImg(name) {
  if (!name || name[0] === 'W' || name[0] === 'L' || /^\d[A-Z]/.test(name)) return '';
  return '<img class="flag-img" src="img/flags/' + name + '.png" alt="" width="24" height="16">';
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
  } else if (tab === 'champions') {
    renderChampions();
  }
}

function onFilterChange() {
  var g = document.getElementById('filter-group').value;
  var savedTeam = g === 'all' ? 'all' : document.getElementById('filter-team').value;
  populateTeamFilter(g, savedTeam);
  renderSchedule(g, document.getElementById('filter-team').value);
}

function onTeamFilterChange() {
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

function initParticles() {
  var canvas = document.getElementById('header-canvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var particles = [];
  var count = 60;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  for (var i = 0; i < count; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.5 + 0.5,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      alpha: Math.random() * 0.6 + 0.2,
      pulse: Math.random() * Math.PI * 2
    });
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.pulse += 0.02;
      var a = p.alpha + Math.sin(p.pulse) * 0.2;
      if (p.x < 0) p.x = canvas.width;
      if (p.x > canvas.width) p.x = 0;
      if (p.y < 0) p.y = canvas.height;
      if (p.y > canvas.height) p.y = 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,215,0,' + Math.max(0, Math.min(1, a)) + ')';
      ctx.fill();
    }
    requestAnimationFrame(draw);
  }
  draw();
}

async function init() {
  initParticles();
  populateTimezoneSelect();
  document.getElementById('timezone-select').addEventListener('change', onTimezoneChange);
  document.getElementById('schedule-list').innerHTML = '<div class="spinner"></div>';

  await loadData();

  var toggleSpans = document.querySelectorAll('#lang-toggle span');
  toggleSpans.forEach(function(s) {
    s.addEventListener('click', function() { toggleLang(); });
  });

  updateUIText();
  populateFilters();
  switchTab('schedule');
}

function updateUIText() {
  document.getElementById('title').textContent = t('title');
  document.getElementById('subtitle').textContent = t('subtitle');
  var spans = document.querySelectorAll('#lang-toggle span');
  spans.forEach(function(s) {
    s.classList.toggle('active', s.dataset.lang === currentLang);
  });

  var i18nEls = document.querySelectorAll('[data-i18n]');
  for (var i = 0; i < i18nEls.length; i++) {
    i18nEls[i].textContent = t(i18nEls[i].dataset.i18n);
  }
}

document.addEventListener('DOMContentLoaded', init);
