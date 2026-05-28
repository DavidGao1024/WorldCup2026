// js/champions.js
var CHAMPIONS = [
  { year: 2022, host: 'Qatar', winner: 'Argentina', runnerUp: 'France', flag: '🇦🇷' },
  { year: 2018, host: 'Russia', winner: 'France', runnerUp: 'Croatia', flag: '🇫🇷' },
  { year: 2014, host: 'Brazil', winner: 'Germany', runnerUp: 'Argentina', flag: '🇩🇪' },
  { year: 2010, host: 'South Africa', winner: 'Spain', runnerUp: 'Netherlands', flag: '🇪🇸' },
  { year: 2006, host: 'Germany', winner: 'Italy', runnerUp: 'France', flag: '🇮🇹' },
  { year: 2002, host: 'South Korea/Japan', winner: 'Brazil', runnerUp: 'Germany', flag: '🇧🇷' },
  { year: 1998, host: 'France', winner: 'France', runnerUp: 'Brazil', flag: '🇫🇷' },
  { year: 1994, host: 'USA', winner: 'Brazil', runnerUp: 'Italy', flag: '🇧🇷' },
  { year: 1990, host: 'Italy', winner: 'Germany', runnerUp: 'Argentina', flag: '🇩🇪' },
  { year: 1986, host: 'Mexico', winner: 'Argentina', runnerUp: 'Germany', flag: '🇦🇷' },
  { year: 1982, host: 'Spain', winner: 'Italy', runnerUp: 'Germany', flag: '🇮🇹' },
  { year: 1978, host: 'Argentina', winner: 'Argentina', runnerUp: 'Netherlands', flag: '🇦🇷' },
  { year: 1974, host: 'Germany', winner: 'Germany', runnerUp: 'Netherlands', flag: '🇩🇪' },
  { year: 1970, host: 'Mexico', winner: 'Brazil', runnerUp: 'Italy', flag: '🇧🇷' },
  { year: 1966, host: 'England', winner: 'England', runnerUp: 'Germany', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  { year: 1962, host: 'Chile', winner: 'Brazil', runnerUp: 'Czechoslovakia', flag: '🇧🇷' },
  { year: 1958, host: 'Sweden', winner: 'Brazil', runnerUp: 'Sweden', flag: '🇧🇷' },
  { year: 1954, host: 'Switzerland', winner: 'Germany', runnerUp: 'Hungary', flag: '🇩🇪' },
  { year: 1950, host: 'Brazil', winner: 'Uruguay', runnerUp: 'Brazil', flag: '🇺🇾' },
  { year: 1938, host: 'France', winner: 'Italy', runnerUp: 'Hungary', flag: '🇮🇹' },
  { year: 1934, host: 'Italy', winner: 'Italy', runnerUp: 'Czechoslovakia', flag: '🇮🇹' },
  { year: 1930, host: 'Uruguay', winner: 'Uruguay', runnerUp: 'Argentina', flag: '🇺🇾' }
];

function renderChampions() {
  var container = document.getElementById('champions-content');
  var html = '<div class="champions-grid">';

  CHAMPIONS.forEach(function(c) {
    var wn = trTeam(c.winner);
    var ru = trTeam(c.runnerUp);
    var hostName = trTeam(c.host);
    var flagImg = getFlagImg(c.winner);
    html += '<div class="champion-card">' +
      '<div class="champion-year">' + c.year + ' ' + hostName + '</div>' +
      '<div class="champion-flag">' + flagImg + '</div>' +
      '<div class="champion-info">' +
        '<div class="champion-winner">' + wn + '</div>' +
        '<div class="champion-runner">' + ru + '</div>' +
      '</div>' +
    '</div>';
  });

  html += '</div>';
  container.innerHTML = html;
}
