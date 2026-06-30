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
      var ct = convertTime(m.time, m.date);
      var hasScore = m.score1 != null && m.score2 != null;

      // 判断获胜方：点球战用点球比分或 winner 字段，否则用总分
      var w1 = false, w2 = false;
      if (hasScore) {
        if (m.hadPen) {
          // 点球决胜
          if (m.score1p != null && m.score2p != null) {
            w1 = m.score1p > m.score2p;
            w2 = m.score2p > m.score1p;
          } else if (m.winner) {
            w1 = m.winner === m.team1;
            w2 = m.winner === m.team2;
          }
        } else {
          w1 = m.score1 > m.score2;
          w2 = m.score2 > m.score1;
        }
      }

      // 比分显示
      var score1Str = hasScore ? m.score1 : '';
      var score2Str = hasScore ? m.score2 : '';
      if (hasScore && m.hadPen) {
        score1Str += ' <span class="bm-pen">(' + (m.score1p != null ? m.score1p : '') + ')</span>';
        score2Str += ' <span class="bm-pen">(' + (m.score2p != null ? m.score2p : '') + ')</span>';
      } else if (hasScore && m.hadET) {
        score1Str += ' <span class="bm-et">aet</span>';
        score2Str += ' <span class="bm-et">aet</span>';
      }

      html += '<div class="bracket-match">' +
        '<div class="bm-teams">' +
          '<div class="bm-team' + (w1 ? ' winner' : '') + '">' +
            '<span>' + trTeam(m.team1) + '</span>' +
            '<span>' + score1Str + '</span>' +
          '</div>' +
          '<div class="bm-team' + (w2 ? ' winner' : '') + '">' +
            '<span>' + trTeam(m.team2) + '</span>' +
            '<span>' + score2Str + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="bm-info">' + ct.date + ' · ' + ct.time + ' · ' + trVenue(m.ground) + '</div>' +
      '</div>';
    });
    html += '</div>';
  });

  html += '</div></div>';
  container.innerHTML = html;
}
