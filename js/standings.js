// js/standings.js
function renderStandings(groupName) {
  var container = document.getElementById('standings-content');
  var groups = getGroups();
  var target = groupName || (groups.length > 0 ? groups[0] : 'Group A');
  var standings = computeStandings(target);

  var html = '<div class="filters"><select id="standings-group" onchange="onStandingsGroupChange()">';
  groups.forEach(function(g) {
    html += '<option value="' + g + '"' + (g === target ? ' selected' : '') + '>' + g + '</option>';
  });
  html += '</select></div>';

  if (!standings.length) {
    html += '<div class="no-data">' + t('noData') + '</div>';
    container.innerHTML = html;
    return;
  }

  html += '<table class="standings-table"><thead><tr>' +
    '<th>' + t('team') + '</th><th>' + t('played') + '</th><th>' + t('won') + '</th>' +
    '<th>' + t('drawn') + '</th><th>' + t('lost') + '</th><th>' + t('gf') + '</th>' +
    '<th>' + t('ga') + '</th><th>' + t('gd') + '</th><th>' + t('pts') + '</th>' +
    '</tr></thead><tbody>';

  standings.forEach(function(row, i) {
    var qualified = i < 2;
    html += '<tr class="' + (qualified ? 'qualified' : '') + '">' +
      '<td>' + row.name + (qualified ? '<span class="qualified-mark">▲' + t('advanced') + '</span>' : '') + '</td>' +
      '<td>' + row.played + '</td><td>' + row.won + '</td><td>' + row.drawn + '</td>' +
      '<td>' + row.lost + '</td><td>' + row.gf + '</td><td>' + row.ga + '</td>' +
      '<td>' + (row.gd > 0 ? '+' + row.gd : row.gd) + '</td><td><strong>' + row.pts + '</strong></td>' +
    '</tr>';
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

function onStandingsGroupChange() {
  var sel = document.getElementById('standings-group');
  renderStandings(sel.value);
}
