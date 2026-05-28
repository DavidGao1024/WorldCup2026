// js/timezone.js
const TIMEZONES = {
  beijing: { label: 'beijing', offset: 8 },
  eastern: { label: 'eastern', offset: -4 },
  gmt: { label: 'gmt', offset: 0 }
};

let currentTZ = localStorage.getItem('wc-timezone') || 'beijing';

function setTimezone(key) {
  currentTZ = key;
  localStorage.setItem('wc-timezone', key);
}

function convertTime(timeStr, dateStr) {
  var match = timeStr.match(/(\d{2}):(\d{2})\s+UTC([+-]\d+)/);
  if (!match) return { time: timeStr, date: dateStr || '' };
  var h = parseInt(match[1]), m = parseInt(match[2]), utcOff = parseInt(match[3]);

  // Parse match date or default to June 11
  var year = 2026, month = 5, day = 11;
  if (dateStr) {
    var parts = dateStr.split('-');
    year = parseInt(parts[0]);
    month = parseInt(parts[1]) - 1;
    day = parseInt(parts[2]);
  }

  // Convert venue local time to UTC, then to target timezone
  var matchUTC = Date.UTC(year, month, day, h - utcOff, m);
  var targetOff = TIMEZONES[currentTZ].offset;
  var targetUTC = matchUTC + targetOff * 3600000;
  var targetDate = new Date(targetUTC);

  var resultH = targetDate.getUTCHours();
  var resultM = targetDate.getUTCMinutes();
  var resultDate = targetDate.getUTCFullYear() + '-' +
    String(targetDate.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(targetDate.getUTCDate()).padStart(2, '0');

  return {
    time: String(resultH).padStart(2, '0') + ':' + String(resultM).padStart(2, '0'),
    date: resultDate
  };
}

function getUTCOffsetStr() {
  var off = TIMEZONES[currentTZ].offset;
  var sign = off >= 0 ? '+' : '';
  return 'UTC' + sign + off;
}

function populateTimezoneSelect() {
  var select = document.getElementById('timezone-select');
  if (!select) return;
  var saved = select.value;
  select.innerHTML = '';
  Object.keys(TIMEZONES).forEach(function(key) {
    select.innerHTML += '<option value="' + key + '">' + t(key) + '</option>';
  });
  select.value = saved || currentTZ;
}
