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
    if (!byDate[m.date]) byDate[m.date] = [];
    byDate[m.date].push(m);
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
      var time = convertTime(m.time);
      var isGroup = m.group && m.group.indexOf('Group ') === 0;
      var stageLabel = isGroup ? m.group : t(roundKey(m.round));
      var hasScore = m.score1 != null && m.score2 != null;
      var scoreDisplay = hasScore ? m.score1 + ' - ' + m.score2 : t('vs');
      var venueName = trVenue(m.ground);

      html += '<div class="match-card">' +
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
