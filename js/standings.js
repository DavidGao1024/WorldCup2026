// js/standings.js
function renderStandings() {
  var container = document.getElementById('standings-content');
  var groups = getGroups();
  var html = '';

  groups.forEach(function(g) {
    var standings = computeStandings(g);
    html += '<h3 class="group-title">' + g + '</h3>';
    if (!standings.length) {
      html += '<div class="no-data">' + t('noData') + '</div>';
      return;
    }
    html += '<table class="standings-table"><thead><tr>' +
      '<th>' + t('team') + '</th><th>' + t('played') + '</th><th>' + t('won') + '</th>' +
      '<th>' + t('drawn') + '</th><th>' + t('lost') + '</th><th>' + t('gf') + '</th>' +
      '<th>' + t('ga') + '</th><th>' + t('gd') + '</th><th>' + t('pts') + '</th>' +
      '</tr></thead><tbody>';

    standings.forEach(function(row) {
      html += '<tr>' +
        '<td>' + getFlagImg(row.name) + ' ' + trTeam(row.name) + '</td>' +
        '<td>' + row.played + '</td><td>' + row.won + '</td><td>' + row.drawn + '</td>' +
        '<td>' + row.lost + '</td><td>' + row.gf + '</td><td>' + row.ga + '</td>' +
        '<td>' + (row.gd > 0 ? '+' + row.gd : row.gd) + '</td><td><strong>' + row.pts + '</strong></td>' +
      '</tr>';
    });

    html += '</tbody></table>';
  });

  container.innerHTML = html || '<div class="no-data">' + t('noData') + '</div>';
}
