// scripts/update-form.js
// 从 ESPN 拉取全部世界杯比赛结果，更新 team-form.json 和 fifa-rankings.json 的 Elo

var https = require('https');
var fs = require('fs');
var path = require('path');

var DATA_DIR = path.join(__dirname, '..', 'data');

function fetch(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() { resolve(JSON.parse(data)); });
    }).on('error', reject);
  });
}

// ESPN team name → worldcup.json team name
var NAME_MAP = {
  'Bosnia-Herzegovina': "Bosnia & Herzegovina",
  'Congo DR': 'DR Congo',
  'Czechia': 'Czech Republic',
  'Türkiye': 'Turkey',
  'United States': 'USA',
  'South Korea': 'South Korea',
  'Cape Verde': 'Cape Verde',
  'Ivory Coast': 'Ivory Coast',
  'Curaçao': 'Curaçao',
  'Saudi Arabia': 'Saudi Arabia',
  'New Zealand': 'New Zealand',
  'Uzbekistan': 'Uzbekistan',
};

function mapName(n) { return NAME_MAP[n] || n; }

// K=30 for World Cup, home advantage ~40 Elo
function eloExpected(ra, rb) { return 1 / (1 + Math.pow(10, (rb - ra) / 400)); }

// Simple form score: weight recent results with decay, consider opponent strength and GD
function calcFormScore(recent, eloMap) {
  if (!recent || recent.length === 0) return 50;
  var total = 0, weight = 0;
  var now = new Date('2026-07-02');
  for (var i = 0; i < recent.length; i++) {
    var r = recent[i];
    var daysAgo = (now - new Date(r.date)) / (1000 * 86400);
    var w = Math.exp(-daysAgo / 180); // decay half-life ~4 months
    var oppElo = eloMap[r.opponent] || 1400;
    var strengthBonus = (oppElo - 1300) / 400; // -1 to +2
    var pts = r.result === 'W' ? 3 : r.result === 'D' ? 1 : 0;
    var gd = (r.gf || 0) - (r.ga || 0);
    var score = pts * 33 + gd * 3 + strengthBonus * 10;
    total += score * w;
    weight += w;
  }
  var raw = total / weight;
  return Math.round(Math.max(5, Math.min(95, raw + 35)));
}

async function main() {
  console.log('Fetching ESPN scoreboard...');
  var sb = await fetch('https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260611-20260719&limit=200');

  var events = sb.events || [];
  console.log('Found ' + events.length + ' matches');

  // Extract WC results
  var results = {};
  events.forEach(function(e) {
    var comp = e.competitions[0];
    if (!comp) return;
    var t = comp.competitors;
    if (!t || t.length < 2) return;
    var st = e.status.type.name;
    if (st === 'STATUS_SCHEDULED' || st === 'STATUS_FIRST_HALF' || st === 'STATUS_SECOND_HALF' || st === 'STATUS_HALF_TIME') return;

    var t1 = mapName(t[0].team.displayName);
    var t2 = mapName(t[1].team.displayName);
    var s1 = parseInt(t[0].score) || 0;
    var s2 = parseInt(t[1].score) || 0;

    // For AET/PEN, use the final score
    var r1, r2;
    if (s1 > s2) { r1 = 'W'; r2 = 'L'; }
    else if (s2 > s1) { r1 = 'L'; r2 = 'W'; }
    else { r1 = 'D'; r2 = 'D'; }

    var date = e.date.slice(0, 10);
    if (!results[t1]) results[t1] = [];
    if (!results[t2]) results[t2] = [];
    results[t1].push({ date: date, opponent: t2, gf: s1, ga: s2, result: r1, venue: 'neutral', comp: 'World Cup' });
    results[t2].push({ date: date, opponent: t1, gf: s2, ga: s1, result: r2, venue: 'neutral', comp: 'World Cup' });
  });

  // Load current data
  var rankings = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'fifa-rankings.json'), 'utf8'));
  var form = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'team-form.json'), 'utf8'));

  // Build Elo map
  var eloMap = {};
  Object.keys(rankings).forEach(function(t) { eloMap[t] = rankings[t].elo; });

  // Update Elo based on WC results
  var eloChanges = {};
  events.forEach(function(e) {
    var comp = e.competitions[0];
    if (!comp) return;
    var t = comp.competitors;
    if (!t || t.length < 2) return;
    var st = e.status.type.name;
    if (st === 'STATUS_SCHEDULED' || st === 'STATUS_FIRST_HALF' || st === 'STATUS_SECOND_HALF' || st === 'STATUS_HALF_TIME') return;

    var t1 = mapName(t[0].team.displayName);
    var t2 = mapName(t[1].team.displayName);
    var s1 = parseInt(t[0].score) || 0;
    var s2 = parseInt(t[1].score) || 0;

    var e1 = eloMap[t1] || 1400;
    var e2 = eloMap[t2] || 1400;
    var exp1 = eloExpected(e1, e2);
    var exp2 = 1 - exp1;

    var actual1 = s1 > s2 ? 1 : s1 < s2 ? 0 : 0.5;
    var actual2 = 1 - actual1;

    var k = 30;
    // Bigger K for knockout
    var round = (comp.slug || '').indexOf('round-of') >= 0 ? 35 : 30;

    eloMap[t1] = Math.round(e1 + k * (actual1 - exp1));
    eloMap[t2] = Math.round(e2 + k * (actual2 - exp2));
  });

  // Update rankings Elo
  Object.keys(rankings).forEach(function(t) {
    if (eloMap[t]) rankings[t].elo = eloMap[t];
  });

  // Update form scores - prepend WC results to recent
  var updatedCount = 0;
  Object.keys(form).forEach(function(team) {
    var wcResults = results[team];
    if (!wcResults || wcResults.length === 0) return;

    // Merge WC results with existing recent, keep last 12
    var existing = form[team].recent || [];
    var existingDates = {};
    existing.forEach(function(r) { existingDates[r.date] = true; });

    // Add WC results that aren't already in recent
    wcResults.forEach(function(r) {
      if (!existingDates[r.date]) {
        existing.unshift(r); // prepend
        existingDates[r.date] = true;
      }
    });

    // Sort by date desc, keep 12
    existing.sort(function(a, b) { return b.date.localeCompare(a.date); });
    existing = existing.slice(0, 12);

    form[team].recent = existing;
    form[team].formScore = calcFormScore(existing, eloMap);
    updatedCount++;
  });

  // Also create entries for teams not yet in form.json
  Object.keys(results).forEach(function(team) {
    if (!form[team]) {
      var wcResults = results[team];
      wcResults.sort(function(a, b) { return b.date.localeCompare(a.date); });
      form[team] = {
        formScore: calcFormScore(wcResults, eloMap),
        recent: wcResults.slice(0, 12)
      };
      console.log('Added new team: ' + team + ' (score=' + form[team].formScore + ')');
    }
  });

  // Write updated files
  fs.writeFileSync(path.join(DATA_DIR, 'fifa-rankings.json'), JSON.stringify(rankings, null, '\t') + '\n');
  fs.writeFileSync(path.join(DATA_DIR, 'team-form.json'), JSON.stringify(form, null, '\t') + '\n');

  console.log('Updated ' + updatedCount + ' teams');
  console.log('Files written: fifa-rankings.json, team-form.json');

  // Show some notable changes
  var teams = Object.keys(form).sort(function(a, b) { return form[b].formScore - form[a].formScore; });
  console.log('\nTop 10 form scores:');
  teams.slice(0, 10).forEach(function(t) {
    console.log('  ' + t + ': ' + form[t].formScore);
  });
  console.log('\nBottom 5 form scores:');
  teams.slice(-5).forEach(function(t) {
    console.log('  ' + t + ': ' + form[t].formScore);
  });
}

main().catch(function(err) { console.error(err); process.exit(1); });
