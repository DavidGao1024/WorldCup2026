// js/timezone.js
const TIMEZONES = {
  beijing: { label: 'beijing', offset: 8, flag: '🇨🇳' },
  eastern: { label: 'eastern', offset: -4, flag: '🇺🇸' },
  gmt: { label: 'gmt', offset: 0, flag: '🌐' }
};

let currentTZ = localStorage.getItem('wc-timezone') || detectTimezone();

function detectTimezone() {
  const offset = -new Date().getTimezoneOffset() / 60;
  if (offset === 8) return 'beijing';
  if (offset >= -5 && offset <= -4) return 'eastern';
  return 'gmt';
}

function setTimezone(key) {
  currentTZ = key;
  localStorage.setItem('wc-timezone', key);
}

function convertTime(timeStr) {
  var match = timeStr.match(/(\d{2}):(\d{2})\s+UTC([+-]\d+)/);
  if (!match) return timeStr;
  var h = parseInt(match[1]), m = parseInt(match[2]), utcOff = parseInt(match[3]);
  var date = new Date(Date.UTC(2026, 5, 11, h - utcOff, m));
  var targetOff = TIMEZONES[currentTZ].offset;
  date.setHours(date.getHours() + targetOff);
  return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
}

function getUTCOffsetStr() {
  var off = TIMEZONES[currentTZ].offset;
  var sign = off >= 0 ? '+' : '';
  return 'UTC' + sign + off;
}
