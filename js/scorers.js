// js/scorers.js
// 射手榜 — 从 ESPN 比赛详情中提取进球数据

function renderScorers() {
  var container = document.getElementById('scorers-content');
  if (!container) return;

  var goals = extractAllGoals();
  if (goals.length === 0) {
    container.innerHTML = '<div class="no-data">' + t('noData') + '</div>';
    return;
  }

  // 按进球数降序，相同则按球员名排序
  goals.sort(function(a, b) { return b.goals - a.goals || a.player.localeCompare(b.player); });

  var html = '<div class="scorers-header">';
  html += '<p class="scorers-subtitle">' + t('scorersSubtitle').replace('{count}', goals.length) + '</p>';
  html += '</div>';

  html += '<table class="scorers-table"><thead><tr>';
  html += '<th>' + t('scorersPlayer') + '</th><th>' + t('scorersGoals') + '</th>';
  html += '</tr></thead><tbody>';

  for (var i = 0; i < goals.length; i++) {
    var g = goals[i];
    html += '<tr>';
    html += '<td class="sc-player">' + getFlagImg(g.team) + '<span>' + trPlayer(g.player) + '</span></td>';
    html += '<td class="sc-goals">' + g.goals + '</td>';
    html += '</tr>';
  }

  html += '</tbody></table>';
  container.innerHTML = html;
}

function extractAllGoals() {
  if (typeof espnRawEvents === 'undefined' || !espnRawEvents || !espnRawEvents.length) {
    return [];
  }

  var playerGoals = {}; // key: "playerName|teamName"

  for (var i = 0; i < espnRawEvents.length; i++) {
    var e = espnRawEvents[i];
    var c = e.competitions && e.competitions[0];
    if (!c || !c.competitors || c.competitors.length < 2) continue;

    var state = c.status && c.status.type && c.status.type.state;
    if (state !== 'post') continue;

    var team1 = typeof mapEspnName === 'function' ? mapEspnName(c.competitors[0].team.displayName) : c.competitors[0].team.displayName;
    var team2 = typeof mapEspnName === 'function' ? mapEspnName(c.competitors[1].team.displayName) : c.competitors[1].team.displayName;
    var team1Id = c.competitors[0].team.id;

    var details = c.details || [];
    for (var j = 0; j < details.length; j++) {
      var d = details[j];
      // 检查是否为进球（包括各种类型）
      var isGoal = d.scoringPlay && !d.ownGoal;
      if (!isGoal) continue;
      if (!d.athletesInvolved || !d.athletesInvolved.length) continue;

      var scorer = d.athletesInvolved[0].displayName;
      var goalTeam = d.team.id === team1Id ? team1 : team2;
      var key = scorer + '|' + goalTeam;

      if (!playerGoals[key]) {
        playerGoals[key] = { player: scorer, team: goalTeam, goals: 0 };
      }
      playerGoals[key].goals++;
    }
  }

  return Object.values(playerGoals);
}
