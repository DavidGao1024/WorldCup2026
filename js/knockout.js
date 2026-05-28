// js/knockout.js
var KO_ROUNDS = [
  'Round of 32', 'Round of 16', 'Quarter-final',
  'Semi-final', 'Match for third place', 'Final'
];

function renderKnockout() {
  var container = document.getElementById('knockout-content');
  var matches = getKnockoutMatches();

  var byRound = {};
  KO_ROUNDS.forEach(function(r) { byRound[r] = []; });
  matches.forEach(function(m) {
    var r = m.round;
    if (byRound[r]) byRound[r].push(m);
  });

  var activeRounds = KO_ROUNDS.filter(function(r) { return byRound[r].length > 0; });

  var html = '<div class="bracket-container"><div class="bracket">';

  activeRounds.forEach(function(round) {
    html += '<div class="bracket-round"><h3>' + t(roundKey(round)) + '</h3>';
    byRound[round].forEach(function(m) {
      var hasScore = m.score1 != null && m.score2 != null;
      var w1 = hasScore && m.score1 > m.score2;
      var w2 = hasScore && m.score2 > m.score1;
      html += '<div class="bracket-match">' +
        '<div class="bm-teams">' +
          '<div class="bm-team' + (w1 ? ' winner' : '') + '">' +
            '<span>' + getFlag(m.team1) + ' ' + m.team1 + '</span>' +
            (hasScore ? '<span>' + m.score1 + '</span>' : '') +
          '</div>' +
          '<div class="bm-team' + (w2 ? ' winner' : '') + '">' +
            '<span>' + getFlag(m.team2) + ' ' + m.team2 + '</span>' +
            (hasScore ? '<span>' + m.score2 + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="bm-info">' + m.date + ' · ' + convertTime(m.time) + ' · ' + m.ground + '</div>' +
      '</div>';
    });
    html += '</div>';
  });

  html += '</div></div>';
  container.innerHTML = html;
}
