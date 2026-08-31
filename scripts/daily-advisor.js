// scripts/daily-advisor.js  —  每日投注推荐引擎（零依赖）
// usage: node scripts/daily-advisor.js            完整运行(回收+出票)
//        node scripts/daily-advisor.js --regen    重新出票(覆盖今日，当日已有结算腿需加 --force)
//        node scripts/daily-advisor.js --selftest 纯函数自检
'use strict';

var https = require('https'), zlib = require('zlib'), fs = require('fs'), path = require('path');
var BASE = process.env.ODDS_PROXY_URL ? process.env.ODDS_PROXY_URL.replace(/\/$/,'') : 'https://webapi.sporttery.cn';
var DATA_FILE = path.join(__dirname, '..', 'data', 'daily-advice.json');

var WHITELIST = { '英超':1,'西甲':1,'意甲':1,'德甲':1,'法甲':1,'欧冠':1,'欧罗巴':1 };
var GOLDEN_LO = 1.30, GOLDEN_HI = 1.60, EDGE_HI = 1.35, MID = 1.47;
var BONUS_LO = 1.6, BONUS_HI = 2.6, BONUS_MID = 2.1;
var DAILY_BUDGET = 20;

function parseKickoff(m) { return new Date(m.matchDate + 'T' + m.matchTime + '+08:00'); }

function normalizeMatch(m) {
  var ko = parseKickoff(m);
  var pools = m.poolList || [];
  var hadOn = pools.some(function(p){ return p.poolCode==='HAD' && p.poolStatus==='Selling'; });
  var hhadOn = pools.some(function(p){ return p.poolCode==='HHAD' && p.poolStatus==='Selling'; });
  var single = pools.filter(function(p){ return p.poolCode==='HAD'; })[0] || {};
  return {
    matchId: m.matchId, matchNumStr: m.matchNumStr, league: m.leagueAbbName || '',
    home: m.homeTeamAllName, away: m.awayTeamAllName,
    kickoff: ko, matchDate: m.matchDate,
    had: hadOn ? m.had : null, hhad: hhadOn ? m.hhad : null,
    hadSingle: single.bettingSingle === 1
  };
}

function inWindow(m, nowIso) {
  var t = m.kickoff.getTime(), now = new Date(nowIso).getTime();
  return t >= now + 3*3600e3 && t <= now + 36*3600e3;
}

function findGoldenCandidates(ms) {
  var out = [];
  ms.forEach(function(m){
    if (!m.had) return;
    var h = parseFloat(m.had.h), d = parseFloat(m.had.d), a = parseFloat(m.had.a);
    if (!h || !d || !a) return;
    var min = Math.min(h, d, a);
    if (min >= GOLDEN_LO && min <= GOLDEN_HI) {
      var pick = min===h?'h':(min===d?'d':'a');
      out.push({ m:m, pick:pick, odds:min, edge:min < EDGE_HI });
    }
  });
  return out;
}

function findBonusCandidates(ms) {
  var out = [];
  ms.forEach(function(m){
    if (m.had || !m.hhad) return;
    var gl = m.hhad.goalLine;
    if (gl !== '-2' && gl !== '+2') return;
    var pick = gl === '-2' ? 'h' : 'a';
    var odds = parseFloat(m.hhad[pick]);
    if (odds >= BONUS_LO && odds <= BONUS_HI) out.push({ m:m, pick:pick, odds:odds, gl:gl });
  });
  return out;
}

function ticketId(date, n) { return date.replace(/-/g,'') + '-T' + n; }
function fmtDate(d) { var p=function(x){return (x<10?'0':'')+x;}; return d.getUTCFullYear()+'-'+p(d.getUTCMonth()+1)+'-'+p(d.getUTCDate()); }
function round2(x){ return Math.round(x*100)/100; }
function bjHM(d) { return new Date(d.getTime()+8*3600e3).toISOString().slice(11,16); }

function generateTickets(goldens, bonuses, existingKeys) {
  var tickets = [];
  function legOf(c, pool) {
    return { matchId:c.m.matchId, matchNumStr:c.m.matchNumStr, league:c.m.league,
      match:c.m.home+' vs '+c.m.away, kickoff:c.m.matchDate+' '+bjHM(c.m.kickoff),
      pool:pool, goalLine:c.gl||null, pick:c.pick, pickLabel:{h:'主胜',d:'平',a:'客胜'}[c.pick]+(pool==='HHAD'?'(让'+c.gl+')':''),
      odds:c.odds, score:null, result:'pending' };
  }
  function keySet() { var s={}; (existingKeys||[]).forEach(function(k){s[k]=1;}); tickets.forEach(function(t){t.legs.forEach(function(l){s[l.matchId+'|'+l.pool]=1;});}); return s; }
  function fresh(cs) { var s=keySet(); return cs.filter(function(c){ return !s[c.m.matchId+'|'+(c.m.had?'HAD':'HHAD')]; }); }

  var nonEdge = fresh(goldens.filter(function(c){return !c.edge;}))
    .sort(function(x,y){ return Math.abs(x.odds-MID)-Math.abs(y.odds-MID); });
  for (var i=0; i+1<nonEdge.length && tickets.filter(function(t){return t.kind==='parlay2';}).length<2; i+=2) {
    var pair = [nonEdge[i], nonEdge[i+1]];
    var co = round2(pair[0].odds*pair[1].odds);
    tickets.push({ kind:'parlay2', rule:'两场赔率都在黄金区间中段·配成一票', stake:4, combinedOdds:co, legs:pair.map(function(c){return legOf(c,'HAD');}), date:pair[0].m.matchDate, result:'pending', payout:null, void:false });
  }
  var paired = {}; tickets.forEach(function(t){t.legs.forEach(function(l){paired[l.matchId]=1;});});
  nonEdge.concat(fresh(goldens.filter(function(c){return c.edge;}))).forEach(function(c){
    if (paired[c.m.matchId] || !c.m.hadSingle) return;
    var stake = c.edge ? 2 : 4;
    tickets.push({ kind:'single', rule:c.edge?'赔率接近黄金区间下限·只买最小一注':'可单关场次·黄金中段', stake:stake, combinedOdds:c.odds, legs:[legOf(c,'HAD')], date:c.m.matchDate, result:'pending', payout:null, void:false });
  });
  var bs = fresh(bonuses).sort(function(x,y){return Math.abs(x.odds-BONUS_MID)-Math.abs(y.odds-BONUS_MID);});
  if (bs.length >= 2) {
    var bp = [bs[0], bs[1]];
    tickets.push({ kind:'bonus', rule:'此场只开让球玩法·赔率1.6~2.6之间·需净胜3球以上', stake:2, combinedOdds:round2(bp[0].odds*bp[1].odds), legs:bp.map(function(c){return legOf(c,'HHAD');}), date:bp[0].m.matchDate, result:'pending', payout:null, void:false });
  }
  var trimmed = [], acc = 0;
  for (var j = 0; j < tickets.length; j++) {
    var t = tickets[j];
    if (acc + t.stake > DAILY_BUDGET) continue;
    acc += t.stake;
    trimmed.push(t);
  }
  trimmed.forEach(function(t,i){ t.id = ticketId(t.date, i+1); });
  return trimmed;
}

function indexResults(list) {
  var byId = {}, byKey = {};
  list.forEach(function(r){ byId[r.matchId] = r; byKey[r.matchNumStr+'|'+r.matchDate] = r; });
  return { byId: byId, byKey: byKey };
}
function findResult(idx, leg) {
  return idx.byId[leg.matchId] || idx.byKey[leg.matchNumStr+'|'+leg.kickoff.slice(0,10)] || null;
}
function judgeLeg(leg, r) {
  if (!r || r.poolStatus !== 'Payout') return;
  var sc = (r.sectionsNo999 || '').split(':');
  if (sc.length !== 2) return;
  var hs = parseInt(sc[0],10), as = parseInt(sc[1],10);
  leg.score = r.sectionsNo999;
  var win;
  if (leg.pool === 'HAD') {
    if (r.winFlag) win = {H:'h',D:'d',A:'a'}[r.winFlag];
    else win = hs>as?'h':(hs===as?'d':'a');
  } else {
    var gl = parseFloat(leg.goalLine !== undefined && leg.goalLine !== null ? leg.goalLine : r.goalLine);
    var adj = hs - as + gl;
    win = adj>0?'h':(adj===0?'d':'a');
  }
  leg.result = win === leg.pick ? 'hit' : 'miss';
}
function evaluateTickets(data, idx, nowMs) {
  data.days.forEach(function(day){
    day.tickets.forEach(function(t){
      var allSettled = true;
      t.legs.forEach(function(l){
        if (l.result === 'pending') {
          judgeLeg(l, findResult(idx, l));
          if (l.result === 'pending') {
            var ageDays = (nowMs - new Date(l.kickoff.replace(' ','T')+'+08:00').getTime()) / 86400e3;
            if (ageDays > 7) { l.result = 'void'; } else allSettled = false;
          }
        }
      });
      var voided = t.legs.some(function(l){return l.result==='void';});
      if (voided) { t.void = true; t.result='void'; t.payout=t.stake; return; }
      if (!allSettled) { t.result = 'pending'; return; }
      var hit = t.legs.every(function(l){return l.result==='hit';});
      t.result = hit ? 'hit' : 'miss';
      t.payout = hit ? round2(t.stake * t.combinedOdds) : 0;
    });
  });
}
function recomputeSummary(data) {
  var s = { days:0, tickets:0, legsHit:0, legsTotal:0, legHitRate:0, ticketsHit:0, ticketHitRate:0, staked:0, returned:0, roi:0, curWinStreak:0 };
  data.days.forEach(function(d){
    s.days++;
    d.tickets.forEach(function(t){
      s.tickets++;
      t.legs.forEach(function(l){ if(l.result==='hit'||l.result==='miss'){ s.legsTotal++; if(l.result==='hit') s.legsHit++; } });
      if (!t.void && t.result !== 'pending') { s.staked += t.stake; s.returned += t.payout; }
      if (!t.void && t.result === 'hit') s.ticketsHit++;
    });
  });
  s.legHitRate = s.legsTotal ? Math.round(s.legsHit/s.legsTotal*1000)/1000 : 0;
  var voids = data.days.reduce(function(a,d){return a+d.tickets.filter(function(t){return t.void;}).length;},0);
  var denom = s.tickets - voids;
  s.ticketHitRate = denom ? Math.round(s.ticketsHit/denom*1000)/1000 : 0;
  s.roi = s.staked ? Math.round((s.returned-s.staked)/s.staked*10000)/10000 : 0;
  var ordered = data.days.slice().sort(function(a,b){return a.date<b.date?-1:1;});
  for (var i=ordered.length-1;i>=0;i--){
    var ts = ordered[i].tickets.filter(function(t){return !t.void;});
    if (!ts.length) continue;
    if (!ts.some(function(t){return t.result!=='pending';})) continue;
    if (ts.some(function(t){return t.result==='hit';})) s.curWinStreak++;
    else break;
  }
  return s;
}

// ---------- 以下为测试夹具与用例（Task 3 会在 runSelftests 末尾追加回收用例） ----------

function fxMatch(o) {
  return Object.assign({ matchId:1, matchNumStr:'周一001', leagueAbbName:'英超',
    homeTeamAllName:'主队', awayTeamAllName:'客队', matchDate:'2026-09-01', matchTime:'02:00:00',
    had:{h:'2.00',d:'3.30',a:'3.40'}, hhad:{h:'3.00',d:'3.30',a:'2.10',goalLine:'-1'},
    poolList:[{poolCode:'HAD',poolStatus:'Selling',bettingSingle:1},{poolCode:'HHAD',poolStatus:'Selling',bettingSingle:0}] }, o);
}
function hadMatch(id, h, d, a, single) {
  return fxMatch({ matchId:id, had:{h:String(h),d:String(d),a:String(a)}, poolList:[{poolCode:'HAD',poolStatus:'Selling',bettingSingle:single===undefined?1:single},{poolCode:'HHAD',poolStatus:'Selling',bettingSingle:0}] });
}

function runSelftests() {
  var fails = 0;
  function ok(cond, name){ if(!cond){ console.log('FAIL '+name); fails++; } else console.log('PASS '+name); }
  var NOW = '2026-08-31T03:30:00Z';
  var norm = [hadMatch(1,1.40,4.2,6.0,0), hadMatch(2,1.55,3.6,4.8,1), hadMatch(3,1.68,3.5,4.0,1), hadMatch(4,1.32,4.8,7.2,1)].map(function(m){return normalizeMatch(m);});

  var golds = findGoldenCandidates(norm);
  ok(golds.length===3, 'golden 命中3场(1.68排除,1.32边缘)');
  ok(golds.filter(function(c){return c.edge;}).length===1, '边缘标记 1 场');

  var tickets = generateTickets(golds, [], []);
  var p = tickets.filter(function(t){return t.kind==='parlay2';});
  var s = tickets.filter(function(t){return t.kind==='single';});
  ok(p.length===1 && p[0].stake===4 && p[0].combinedOdds===2.17, 'A 2串1 一张 1.40×1.55=2.17 ¥4');
  ok(s.length===1 && s[0].legs[0].odds===1.32 && s[0].stake===2, 'A 边缘 1.32 仅 ¥2 单关');
  ok(!s.some(function(t){return t.legs[0].matchId===1 && t.kind==='single';}), 'A 必串候选不单独出票');

  var g2 = findGoldenCandidates([hadMatch(5,1.31,5,8,1), hadMatch(6,1.33,5,7,1)].map(normalizeMatch));
  var t2 = generateTickets(g2, [], []);
  ok(t2.filter(function(t){return t.kind==='parlay2';}).length===0 && t2.length===2, 'B 全边缘不出串');

  ok(generateTickets(findGoldenCandidates([hadMatch(7,1.8,3.5,4.0,1)].map(normalizeMatch)), [], []).length===0, 'C 零候选空集');

  var bonusRaw = [
    fxMatch({ matchId:8, leagueAbbName:'德甲', poolList:[{poolCode:'HHAD',poolStatus:'Selling',bettingSingle:0}], hhad:{h:'2.15',d:'4.15',a:'2.36',goalLine:'-2'} }),
    fxMatch({ matchId:9, leagueAbbName:'法甲', poolList:[{poolCode:'HHAD',poolStatus:'Selling',bettingSingle:0}], hhad:{h:'1.80',d:'4.30',a:'2.93',goalLine:'-2'} }),
    fxMatch({ matchId:10, leagueAbbName:'西甲', poolList:[{poolCode:'HHAD',poolStatus:'Selling',bettingSingle:0}], hhad:{h:'3.10',d:'4.00',a:'2.05',goalLine:'-2'} })
  ].map(normalizeMatch);
  var bon = findBonusCandidates(bonusRaw);
  ok(bon.length===2, 'D 彩蛋: 2.15/1.80 入围, 3.10 超界滤除');
  var t3 = generateTickets([], bon, []);
  ok(t3.length===1 && t3[0].kind==='bonus' && t3[0].legs.length===2, 'D 彩蛋 ≥2 场成串一张');

  var t4 = generateTickets(golds, [], ['1|HAD','2|HAD']);
  ok(t4.filter(function(t){return t.kind==='parlay2';}).length===0 && t4.filter(function(t){return t.kind==='single';}).length===1, 'E 已出腿被剔除');

  var t6 = generateTickets(golds, [], ['4|HAD']);
  ok(t6.filter(function(t){return t.kind==='single';}).length===0, 'E2 边缘候选被existingKeys剔除 不出单关');

  var solo = findGoldenCandidates([hadMatch(20,1.45,4.0,6.0,0)].map(normalizeMatch));
  ok(generateTickets(solo, [], []).length===0, '必串单场落单 无法成串且必串 放弃');

  var many = []; for (var k=0;k<8;k++) many.push(hadMatch(100+k, 1.41+k*0.01, 4, 6, 1));
  var t5 = generateTickets(findGoldenCandidates(many.map(normalizeMatch)), [], []);
  var sum = t5.reduce(function(a,t){return a+t.stake;},0);
  ok(sum<=20 && t5.filter(function(t){return t.kind==='parlay2';}).length===2, 'F 预算≤20 且串最多2张');

  ok(inWindow(normalizeMatch(fxMatch({matchDate:'2026-08-31', matchTime:'14:30:00'})), NOW)===true, 'B5 inWindow NOW+3h 边界 true');
  ok(inWindow(normalizeMatch(fxMatch({matchDate:'2026-08-31', matchTime:'14:29:00'})), NOW)===false, 'B5 inWindow NOW+2h59m false');
  ok(inWindow(normalizeMatch(fxMatch({matchDate:'2026-09-01', matchTime:'23:30:00'})), NOW)===true, 'B5 inWindow NOW+36h 边界 true');
  ok(inWindow(normalizeMatch(fxMatch({matchDate:'2026-09-01', matchTime:'23:31:00'})), NOW)===false, 'B5 inWindow NOW+36h1m false');
  ok(bjHM(new Date('2026-08-31T17:00:00Z'))==='01:00', 'B5 bjHM 17Z→01:00');
  ok(bjHM(new Date('2026-09-01T16:00:00Z'))==='00:00', 'B5 bjHM 16Z→00:00');
  ok(t5.map(function(t,i){return t.id;}).join(',')==='20260901-T1,20260901-T2,20260901-T3,20260901-T4,20260901-T5', 'B5 裁剪后 id 连续 T1..T5');

  var data = { days:[{ date:'2026-09-01', tickets:[
    { id:'X1', kind:'parlay2', stake:4, combinedOdds:2.17, void:false, result:'pending', payout:null,
      legs:[ {matchId:1, matchNumStr:'周一004', kickoff:'2026-09-01 01:00', pool:'HAD', pick:'h', goalLine:null, result:'pending', score:null},
             {matchId:2, matchNumStr:'周一005', kickoff:'2026-09-01 03:00', pool:'HAD', pick:'a', goalLine:null, result:'pending', score:null} ]},
    { id:'X2', kind:'bonus', stake:2, combinedOdds:3.87, void:false, result:'pending', payout:null,
      legs:[ {matchId:8, matchNumStr:'周一008', kickoff:'2026-09-01 00:30', pool:'HHAD', pick:'h', goalLine:'-2', result:'pending', score:null},
             {matchId:9, matchNumStr:'周一009', kickoff:'2026-09-01 02:00', pool:'HHAD', pick:'h', goalLine:'-2', result:'pending', score:null} ]}
  ]}]};
  var idx = indexResults([
    { matchId:1, matchNumStr:'周一004', matchDate:'2026-09-01', sectionsNo999:'2:0', winFlag:'H', poolStatus:'Payout', goalLine:'-1' },
    { matchId:2, matchNumStr:'周一005', matchDate:'2026-09-01', sectionsNo999:'1:1', winFlag:'D', poolStatus:'Payout', goalLine:'0' },
    { matchId:8, matchNumStr:'周一008', matchDate:'2026-09-01', sectionsNo999:'3:0', winFlag:'', poolStatus:'Payout', goalLine:'-2' },
    { matchId:9, matchNumStr:'周一009', matchDate:'2026-09-01', sectionsNo999:'2:1', winFlag:'', poolStatus:'Payout', goalLine:'-2' }
  ]);
  evaluateTickets(data, idx, new Date('2026-09-01T12:00:00Z').getTime());
  var x1 = data.days[0].tickets[0], x2 = data.days[0].tickets[1];
  ok(x1.result==='miss' && x1.payout===0, 'G 腿1中腿2错 → 票miss');
  ok(x2.legs[0].result==='hit' && x2.legs[1].result==='miss', 'G ±2判定: 3:0净胜3中, 2:1净胜2未过-2');
  ok(x2.result==='miss', 'G 彩蛋全票miss');
  var sm = recomputeSummary(data);
  ok(sm.staked===6 && sm.returned===0 && sm.ticketHitRate===0, 'G summary 投入6 返还0');
  // G2: 全待赛日不断连红
  var d2 = { days:[ {date:'2026-08-30', tickets:[{stake:2, void:false, result:'hit', payout:4, legs:[]}]},
                    {date:'2026-09-01', tickets:[{stake:2, void:false, result:'pending', payout:null, legs:[]}]} ]};
  ok(recomputeSummary(d2).curWinStreak===1, 'G2 未出结果日不打断连红');
  // G3: void 票退回不计统计
  var d3 = { days:[ {date:'2026-09-01', tickets:[{stake:4, void:true, result:'void', payout:4, legs:[{result:'void'}]}]} ]};
  var s3 = recomputeSummary(d3);
  ok(s3.staked===0 && s3.returned===0 && s3.ticketHitRate===0, 'G3 void 不进分母');
  return fails;
}

function httpJson(url) {
  return new Promise(function(resolve, reject){
    var req = https.get(url, { timeout: 15000, headers: {
      'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept':'application/json','Accept-Language':'zh-CN,zh;q=0.9','Accept-Encoding':'gzip, deflate',
      'Referer':'https://www.sporttery.cn/jc/zqsgkj/','Origin':'https://www.sporttery.cn'
    }}, function(res){
      var s = res, chunks=[];
      if (res.headers['content-encoding']==='gzip') s = res.pipe(zlib.createGunzip());
      else if (res.headers['content-encoding']==='deflate') s = res.pipe(zlib.createInflate());
      s.on('data', function(c){chunks.push(c);});
      s.on('end', function(){
        var b = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 400) return reject(new Error('HTTP '+res.statusCode+' '+b.slice(0,120)));
        try { resolve(JSON.parse(b)); } catch(e){ reject(new Error('非JSON: '+b.slice(0,120))); }
      });
      s.on('error', reject);
    });
    req.on('timeout', function(){ req.destroy(); reject(new Error('超时 '+url.slice(0,80))); });
    req.on('error', reject);
  });
}
function fetchOdds() {
  return httpJson(BASE + '/gateway/jc/football/getMatchCalculatorV1.qry?poolCode=hhad,had&channel=c')
    .then(function(j){
      if (!j.success) throw new Error('赔率API错误: '+(j.errorMessage||''));
      var out = [];
      (j.value.matchInfoList||[]).forEach(function(d){ (d.subMatchList||[]).forEach(function(m){ if (m.matchStatus==='Selling') out.push(m); }); });
      return out;
    });
}
function fetchResults(fromDate, toDate) {
  var all = [], pageNo = 1;
  function step(){
    var url = BASE + '/gateway/uniform/football/getUniformMatchResultV1.qry?matchBeginDate='+fromDate+'&matchEndDate='+toDate+'&leagueId=&pageSize=30&pageNo='+pageNo+'&isFix=0&matchPage=1&pcOrWap=1';
    return httpJson(url).then(function(j){
      var v = j.value || {};
      all = all.concat(v.matchResult || []);
      if (pageNo < Math.min(v.pages||1, 20)) { pageNo++; return step(); }
      return all;
    });
  }
  return step();
}
function readData() {
  var raw;
  try { raw = fs.readFileSync(DATA_FILE, 'utf8'); }
  catch(e) { return { updateTime:'1970-01-01T00:00:00Z', summary:{}, days:[] }; } // 仅文件不存在时初始化
  var j = JSON.parse(raw); // 损坏即抛错终止运行，绝不静默清空历史
  if (!j || !Array.isArray(j.days) || !j.summary) throw new Error('数据文件结构异常: days/summary 缺失');
  return j;
}
function writeDataAtomic(data) {
  var tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE); // 原子替换，硬杀不留半截 JSON
}
function todayKey(iso) { return fmtDate(new Date(new Date(iso).getTime()+8*3600e3)); } // 北京日历日=批次日
function legKeys(data, exceptDate) {
  var ks = [];
  data.days.forEach(function(d){ if (d.date===exceptDate) return; d.tickets.forEach(function(t){ t.legs.forEach(function(l){ ks.push(l.matchId+'|'+l.pool); }); }); });
  return ks;
}

function runMain(regen, force) {
  var now = new Date(), nowIso = now.toISOString();
  var data = readData();
  var beforeSig = JSON.stringify({ summary:data.summary, days:data.days });
  var pending = [];
  data.days.forEach(function(d){ d.tickets.forEach(function(t){ t.legs.forEach(function(l){ if (l.result==='pending') pending.push(l); }); }); });
  return (pending.length
    ? (function(){
        var dates = pending.map(function(l){return l.kickoff.slice(0,10);}).sort();
        return fetchResults(dates[0], dates[dates.length-1]).then(function(results){
          evaluateTickets(data, indexResults(results), now.getTime());
          console.log('回收检查 '+pending.length+' 腿');
        });
      })()
    : Promise.resolve()).then(function(){
    var today = todayKey(nowIso);
    var exists = data.days.filter(function(d){ return d.date===today; })[0];
    if (exists && !regen) { console.log('今日已有票，跳过出票(--regen 可覆盖)'); return null; }
    if (exists && regen && !force) {
      var settled = exists.tickets.some(function(t){ return t.legs.some(function(l){ return l.result!=='pending'; }); });
      if (settled) throw new Error('当日票已有结算腿，regen 会丢历史盈亏；确需覆盖请加 --force');
    }
    return fetchOdds().then(function(raw){
      var norm = raw.map(function(m){ return normalizeMatch(m); })
                    .filter(function(m){ return WHITELIST[m.league] && inWindow(m, nowIso); });
      var tickets = generateTickets(findGoldenCandidates(norm), findBonusCandidates(norm), legKeys(data, regen ? today : null));
      if (exists && regen) data.days = data.days.filter(function(d){ return d.date!==today; });
      var day = { date: today, generatedAt: nowIso, rest: tickets.length===0, tickets: tickets };
      data.days.push(day);
      console.log(day.rest ? '今日休战' : ('今日出票 '+tickets.length+' 张: '+tickets.map(function(t){return t.kind+'/'+t.stake+'元/'+t.legs.map(function(l){return l.match+' '+l.pickLabel+'@'+l.odds;}).join(' + ');}).join(' | ')));
      return day;
    });
  }).then(function(){
    data.days.sort(function(a,b){ return a.date<b.date?-1:1; });
    data.summary = recomputeSummary(data);
    if (JSON.stringify({ summary:data.summary, days:data.days }) === beforeSig) {
      console.log('数据无变化，跳过写盘'); return;
    }
    data.updateTime = new Date().toISOString();
    writeDataAtomic(data);
    console.log('已写入 '+DATA_FILE);
  });
}

function selftest() { var fails = runSelftests(); if (fails) { console.error(fails+' FAIL'); process.exit(1);} console.log('ALL PASS'); }

if (process.argv.indexOf('--selftest') >= 0) selftest();
else runMain(process.argv.indexOf('--regen') >= 0, process.argv.indexOf('--force') >= 0).catch(function(e){ console.error('RUN FAIL:', e.message); process.exit(1); });