# 每日投注推荐系统 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每日 11:30（北京时间）自动回收赛果、判定命中、按五条黄金法则出模拟票，经 GitHub Actions 沉淀到 `data/daily-advice.json`，由新「每日推荐」页签展示。

**Architecture:** 零依赖 Node 脚本（规则引擎+回收+编排三合一）→ 定时任务 commit JSON → 纯前端 fetch 渲染。**通道策略（总司令定调：两个都要，本机先跑）**：本机计划任务为主通道（直连已实测通畅）；CF Worker + GitHub Actions 为二期云端升级，Worker 出口 IP 是否被体彩 WAF 放行需部署后实测验证；两条通道脚本完全同一份，引擎幂等（当日已有 day 则只回收不出新票），并行运行无冲突。

**Tech Stack:** Node 20 内置模块（https/zlib/fs）、GitHub Actions cron、Cloudflare Workers、Vanilla JS（项目无框架无构建）。

**Spec:** `docs/superpowers/specs/2026-08-31-daily-betting-advisor-design.md`

> ## 📌 执行进度（2026-08-31 记录，提交 cae94eb 已 push）
> - ✅ Task 1/2/3/4（骨架、引擎 26 selftest、回收、网络层+本机真数据首跑+幂等验证）
> - ✅ Task 7 前端页签（浏览器实测：正常/无数据/中英切换/页签回归四态）
> - ✅ Task 8 脚本落地；⬜ schtasks 注册待总司令执行（ps1 头注释有命令）
> - ⬜ Task 5/6（CF Worker + Actions）二期；⬜ Task 9 停用 fetch-odds cron 待批；⬜ Task 10 验收随注册后首跑观察
> - 审查期修复：夹具 bettingSingle 映射、边缘候选去重绕行、roi/命中率精度、UTC/北京日期键幂等、regen 结算守卫、原子写+损坏即停、无变化不写盘
> - 下方步骤复选框未逐项勾选，以本进度块为准
**已实测事实（2026-08-31）：** 两个上游接口 Node 本机直连均 200；赛果端点为 `getUniformMatchResultV1.qry`（旧名 403）。联赛简称值样例：`英超/西甲/意甲/德甲/法甲/欧冠/欧罗巴`（白名单用 `leagueAbbName` 全等匹配）。

> ⚠️ 本项目铁律：**所有 commit 步骤仅在总司令明确说"提交"后执行**。计划中的 commit 命令是给用户看的建议，不是自动执行。

---

## 文件结构

| 动作 | 路径 | 职责 |
|---|---|---|
| Create | `scripts/daily-advisor.js` | 引擎+回收+编排+`--selftest`（唯一新后端脚本，~300 行） |
| Create | `data/daily-advice.json` | 唯一数据产物（前端只读） |
| Create | `workers/odds-proxy.js` | CF Worker：两个路径白名单的通用反代 |
| Create | `.github/workflows/daily-advice.yml` | cron 03:30 UTC 自动运行 |
| Create | `scripts/run-daily-advisor.ps1` | 本机备用通道（含 schtasks 注册命令注释） |
| Create | `js/daily-advice.js` | 前端渲染（功能版，样式待 Figma） |
| Modify | `index.html:61` 前插页签、`:92-103` 插 script、容器区插 `#advice-content` | |
| Modify | `js/app.js:43,80,182` | currentTab/switchTab 分支/默认页签 |
| Modify | `js/i18n.js:2-64(zh),168+(en)` | 新键 |
| Modify | `css/style.css` 末尾 | 新页签样式 |
| Modify(待批) | `.github/workflows/fetch-odds.yml:4-6` | 注释其 cron |

---

### Task 1: 数据文件骨架

**Files:**
- Create: `data/daily-advice.json`

- [ ] **Step 1: 写入初始结构**

```json
{
  "updateTime": "2026-08-31T00:00:00Z",
  "summary": { "days": 0, "tickets": 0, "legsHit": 0, "legsTotal": 0, "legHitRate": 0, "ticketsHit": 0, "ticketHitRate": 0, "staked": 0, "returned": 0, "roi": 0, "curWinStreak": 0 },
  "days": []
}
```

- [ ] **Step 2: 验证 JSON 可解析**

Run: `node -e "JSON.parse(require('fs').readFileSync('data/daily-advice.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: 提交（待总司令确认）** `git add data/daily-advice.json && git commit -m "chore: 每日推荐数据骨架"`

---

### Task 2: 规则引擎纯函数 + selftest（TDD）

**Files:**
- Create: `scripts/daily-advisor.js`（本任务只写纯函数+selftest 桩，网络层在 Task 4）

- [ ] **Step 1: 写引擎骨架与失败的 selftest**

创建 `scripts/daily-advisor.js`，先贴 selftest 框架与纯函数签名（内部 `// TODO` 允许，因为函数体在 Step 3 给出完整实现——若按 TDD 顺序，此处函数体留空即会失败）：

```js
// scripts/daily-advisor.js  —  每日投注推荐引擎（零依赖）
// usage: node scripts/daily-advisor.js            完整运行(回收+出票)
//        node scripts/daily-advisor.js --selftest 纯函数自检
'use strict';

var WHITELIST = { '英超':1,'西甲':1,'意甲':1,'德甲':1,'法甲':1,'欧冠':1,'欧罗巴':1 };
var GOLDEN_LO = 1.30, GOLDEN_HI = 1.60, EDGE_HI = 1.35, MID = 1.47;
var BONUS_LO = 1.6, BONUS_HI = 2.6, BONUS_MID = 2.1;
var DAILY_BUDGET = 20;

function parseKickoff(m) { return new Date(m.matchDate + 'T' + m.matchTime + '+08:00'); }

function normalizeMatch(m, nowMs) {
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
    var pick = min===h?'h':(min===d?'d':'a');
    var odds = { h:h, d:d, a:a }[pick];
    if (min >= GOLDEN_LO && min <= GOLDEN_HI) out.push({ m:m, pick:pick, odds:min, edge:min < EDGE_HI });
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

// 核心出票：纯函数，可测
function generateTickets(goldens, bonuses, nowIso, existingKeys) {
  var tickets = [], used = 0;
  function bjHM(d) { return new Date(d.getTime()+8*3600e3).toISOString().slice(11,16); } // 北京时:分
  function legOf(c, pool) {
    return { matchId:c.m.matchId, matchNumStr:c.m.matchNumStr, league:c.m.league,
      match:c.m.home+' vs '+c.m.away, kickoff:c.m.matchDate+' '+bjHM(c.m.kickoff),
      pool:pool, goalLine:c.gl||null, pick:c.pick, pickLabel:{h:'主胜',d:'平',a:'客胜'}[c.pick]+(pool==='HHAD'?'(让'+c.gl+')':''),
      odds:c.odds, score:null, result:'pending' };
  }
  function keySet() { var s={}; (existingKeys||[]).forEach(function(k){s[k]=1;}); tickets.forEach(function(t){t.legs.forEach(function(l){s[l.matchId+'|'+l.pool]=1;});}); return s; }
  function fresh(cs) { var s=keySet(); return cs.filter(function(c){ return !s[c.m.matchId+'|'+(c.had?'HAD':'HHAD')]; }); }

  var nonEdge = fresh(goldens.filter(function(c){return !c.edge;}))
    .sort(function(x,y){ return Math.abs(x.odds-MID)-Math.abs(y.odds-MID); });
  for (var i=0; i+1<nonEdge.length && tickets.filter(function(t){return t.kind==='parlay2';}).length<2; i+=2) {
    var pair = [nonEdge[i], nonEdge[i+1]];
    var co = round2(pair[0].odds*pair[1].odds);
    tickets.push({ id:ticketId(pair[0].m.matchDate, used+1), kind:'parlay2', rule:'两场赔率都在黄金区间中段·配成一票', stake:4, combinedOdds:co, legs:pair.map(function(c){return legOf(c,'HAD');}), result:'pending', payout:null, void:false });
    used++;
  }
  var paired = {}; tickets.forEach(function(t){t.legs.forEach(function(l){paired[l.matchId]=1;});});
  nonEdge.concat(goldens.filter(function(c){return c.edge;})).forEach(function(c){
    if (paired[c.m.matchId] || !c.m.hadSingle) return;
    var stake = c.edge ? 2 : 4;
    tickets.push({ id:ticketId(c.m.matchDate, used+1), kind:'single', rule:c.edge?'赔率接近黄金区间下限·只买最小一注':'可单关场次·黄金中段', stake:stake, combinedOdds:c.odds, legs:[legOf(c,'HAD')], result:'pending', payout:null, void:false });
    used++;
  });
  var bs = fresh(bonuses).sort(function(x,y){return Math.abs(x.odds-BONUS_MID)-Math.abs(y.odds-BONUS_MID);});
  if (bs.length >= 2) {
    var bp = [bs[0], bs[1]];
    tickets.push({ id:ticketId(bp[0].m.matchDate, used+1), kind:'bonus', rule:'此场只开让球玩法·赔率1.6~2.6之间·需净胜3球以上', stake:2, combinedOdds:round2(bp[0].odds*bp[1].odds), legs:bp.map(function(c){return legOf(c,'HHAD');}), result:'pending', payout:null, void:false });
  }
  // 预算裁剪：按加入顺序保留，超限整张弃
  var acc = 0; tickets = tickets.filter(function(t){ if (acc + t.stake > DAILY_BUDGET) return false; acc += t.stake; return true; });
  tickets.forEach(function(t,i){ t.id = ticketId(t.legs[0].kickoff.slice(0,10), i+1); });
  return tickets;
}

function selftest() { var fails = runSelftests(); if (fails) { console.error(fails+' FAIL'); process.exit(1);} console.log('ALL PASS'); }
function runSelftests() { /* Task2 Step3 填充 */ return 0; }

if (process.argv.indexOf('--selftest') >= 0) selftest();
```

- [ ] **Step 2: 运行确认当前可加载且空跑通过**

Run: `node scripts/daily-advisor.js --selftest`
Expected: `ALL PASS`（0 用例）——随后在 Step 3 追加真实用例（用例先断言后补，若函数改动则用例守护）

- [ ] **Step 3: 填充真实用例与修正实现**

将 `runSelftests` 替换为：

```js
function fxMatch(o) {
  return Object.assign({ matchId:1, matchNumStr:'周一001', leagueAbbName:'英超',
    homeTeamAllName:'主队', awayTeamAllName:'客队', matchDate:'2026-09-01', matchTime:'02:00:00',
    had:{h:'2.00',d:'3.30',a:'3.40'}, hhad:{h:'3.00',d:'3.30',a:'2.10',goalLine:'-1'},
    poolList:[{poolCode:'HAD',poolStatus:'Selling',bettingSingle:1},{poolCode:'HHAD',poolStatus:'Selling',bettingSingle:0}] }, o);
}
function hadMatch(id, h, d, a, single) {
  return fxMatch({ matchId:id, had:{h:String(h),d:String(d),a:String(a)}, poolList:[{poolCode:'HAD',poolStatus:'Selling',bettingSingle:single===undefined?1:0},{poolCode:'HHAD',poolStatus:'Selling',bettingSingle:0}] });
}
function noHadHhad2(id, ho, ao) {
  return fxMatch({ matchId:id, poolList:[{poolCode:'HHAD',poolStatus:'Selling',bettingSingle:0}] });
}
function runSelftests() {
  var fails = 0;
  function ok(cond, name){ if(!cond){ console.log('FAIL '+name); fails++; } else console.log('PASS '+name); }
  var NOW = '2026-08-31T03:30:00Z'; // 北京 11:30
  var norm = [hadMatch(1,1.40,4.2,6.0,0), hadMatch(2,1.55,3.6,4.8,1), hadMatch(3,1.68,3.5,4.0,1), hadMatch(4,1.32,4.8,7.2,1)];

  var golds = findGoldenCandidates(norm);
  ok(golds.length===3, 'golden 命中3场(1.68排除,1.32边缘)');
  ok(golds.filter(function(c){return c.edge;}).length===1, '边缘标记 1 场');

  // 用例A：配对+边缘单+必串落单
  var tickets = generateTickets(golds, [], NOW, []);
  var p = tickets.filter(function(t){return t.kind==='parlay2';});
  var s = tickets.filter(function(t){return t.kind==='single';});
  ok(p.length===1 && p[0].stake===4 && p[0].combinedOdds===2.17, 'A 2串1 一张 1.40×1.55=2.17 ¥4');
  ok(s.length===1 && s[0].legs[0].odds===1.32 && s[0].stake===2, 'A 边缘 1.32 仅 ¥2 单关');
  // matchId1(1.40) 已入串且 bettingSingle=0，不应再出单关
  ok(!s.some(function(t){return t.legs[0].matchId===1 && t.kind==='single';}), 'A 必串候选不单独出票');

  // 用例B：全边缘 → 无串
  var g2 = findGoldenCandidates([hadMatch(5,1.31,5,8,1), hadMatch(6,1.33,5,7,1)]);
  var t2 = generateTickets(g2, [], NOW, []);
  ok(t2.filter(function(t){return t.kind==='parlay2';}).length===0 && t2.length===2, 'B 全边缘不出串');

  // 用例C：零候选
  ok(generateTickets(findGoldenCandidates([hadMatch(7,1.8,3.5,4.0,1)]), [], NOW, []).length===0, 'C 零候选空集');

  // 用例D：彩蛋成串
  var bon = findBonusCandidates([
    Object.assign(noHadHhad2(8,2.15,2.36), {leagueAbbName:'德甲', hhad:{h:'2.15',d:'4.15',a:'2.36',goalLine:'-2'}}),
    Object.assign(noHadHhad2(9,1.80,2.93), {leagueAbbName:'法甲', hhad:{h:'1.80',d:'4.30',a:'2.93',goalLine:'-2'}}),
    Object.assign(noHadHhad2(10,3.10,2.05), {leagueAbbName:'西甲', hhad:{h:'3.10',d:'4.00',a:'2.05',goalLine:'-2'}})
  ]);
  ok(bon.length===3, 'D 彩蛋 3 场(含1.80/2.15/2.05) 注:3.10 在范围外?否-3.10>2.6');
  var t3 = generateTickets([], bon, NOW, []);
  ok(t3.length===1 && t3[0].kind==='bonus' && t3[0].legs.length===2, 'D 彩蛋 ≥2 场成串一张');

  // 用例E：去重
  var t4 = generateTickets(golds, [], NOW, [1+'|HAD', 2+'|HAD']);
  ok(t4.filter(function(t){return t.kind==='parlay2';}).length===0 && t4.filter(function(t){return t.kind==='single';}).length===1, 'E 已出腿被剔除');

  // 用例F：预算裁剪 ≤¥20
  var many = []; for (var k=0;k<8;k++) many.push(hadMatch(100+k, 1.41+k*0.01, 4, 6, 1));
  var t5 = generateTickets(findGoldenCandidates(many), [], NOW, []);
  var sum = t5.reduce(function(a,t){return a+t.stake;},0);
  ok(sum<=DAILY_BUDGET && t5.filter(function(t){return t.kind==='parlay2';}).length===2, 'F 预算≤20 且串最多2张');
  return fails;
}
```

注：`noHadHhad2` 的 `poolList` 只有 HHAD，故 `had:null`。用例D 中 2.05（matchId10 的 a 赔率…注意 goalLine -2 时取 h 侧，10 号 h=3.10 超界被滤，实际通过的是 8(2.15) 与 9(1.80) 中距 2.1 最近的两场——实现按 pick=gl==='-2'?'h':'a' 取 h 侧 2.15/1.80/3.10，3.10>2.6 滤除，剩 2 场成串 ✓）

- [ ] **Step 4: 运行 selftest 全绿**

Run: `node scripts/daily-advisor.js --selftest`
Expected: 12 行 PASS，`ALL PASS`

- [ ] **Step 5: 提交（待总司令确认）** `git add scripts/daily-advisor.js && git commit -m "feat: 每日推荐规则引擎核心与自检"`

---

### Task 3: 赛果回收纯函数 + selftest

**Files:**
- Modify: `scripts/daily-advisor.js`（在 `selftest` 定义之前追加）

- [ ] **Step 1: 实现回收与 summary 纯函数**

```js
// 结果索引: 以 matchId 为主键, 'matchNumStr|matchDate' 为备键
function indexResults(list) {
  var byId = {}, byKey = {};
  list.forEach(function(r){ byId[r.matchId] = r; byKey[r.matchNumStr+'|'+r.matchDate] = r; });
  return { byId: byId, byKey: byKey };
}
function findResult(idx, leg) {
  return idx.byId[leg.matchId] || idx.byKey[leg.matchNumStr+'|'+leg.kickoff.slice(0,10)] || null;
}
function judgeLeg(leg, r) {
  if (!r || r.poolStatus !== 'Payout') return; // 未结算保持 pending；winFlag 为空的已结算场次也可判
  var sc = (r.sectionsNo999 || '').split(':');
  if (sc.length !== 2) return;
  var hs = parseInt(sc[0],10), as = parseInt(sc[1],10);
  leg.score = r.sectionsNo999;
  var win;
  if (leg.pool === 'HAD') {
    if (r.winFlag) win = {H:'h',D:'d',A:'a'}[r.winFlag];
    else win = hs>as?'h':(hs===as?'d':'a');
  } else {
    var gl = parseFloat(leg.goalLine !== undefined ? leg.goalLine : r.goalLine);
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
  s.legHitRate = s.legsTotal ? round2(s.legsHit/s.legsTotal*1000)/1000 : 0;
  var denom = s.tickets - data.days.reduce(function(a,d){return a+d.tickets.filter(function(t){return t.void;}).length;},0);
  s.ticketHitRate = denom ? round2(s.ticketsHit/denom*1000)/1000 : 0;
  s.roi = s.staked ? round2((s.returned-s.staked)/s.staked*10000)/10000 : 0;
  // 连红：按日期升序找最近红日（未出结果的日子整体跳过，不断连红）
  var ordered = data.days.slice().sort(function(a,b){return a.date<b.date?-1:1;});
  for (var i=ordered.length-1;i>=0;i--){
    var ts = ordered[i].tickets.filter(function(t){return !t.void;});
    if (!ts.length) continue; // 休战不打断
    if (!ts.some(function(t){return t.result!=='pending';})) continue; // 全待赛不打断
    if (ts.some(function(t){return t.result==='hit';})) s.curWinStreak++;
    else break;
  }
  return s;
}
```

- [ ] **Step 2: 追加回收用例**（进 `runSelftests` return 前）

```js
  // 用例G：回收判定
  var data = { days:[{ date:'2026-09-01', tickets:[
    { id:'X1', kind:'parlay2', stake:4, combinedOdds:2.17, void:false, result:'pending', payout:null,
      legs:[ {matchId:1, matchNumStr:'周一004', kickoff:'2026-09-01 01:00', pool:'HAD', pick:'h', result:'pending', score:null},
             {matchId:2, matchNumStr:'周一005', kickoff:'2026-09-01 03:00', pool:'HAD', pick:'a', result:'pending', score:null} ]},
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
```

- [ ] **Step 3: 运行全绿**

Run: `node scripts/daily-advisor.js --selftest`
Expected: `ALL PASS`

- [ ] **Step 4: 提交（待总司令确认）** `git commit -am "feat: 赛果回收与统计纯函数"`

---

### Task 4: 网络层 + 编排 main + 本机真数据试运行

**Files:**
- Modify: `scripts/daily-advisor.js`（顶部追加 https/zlib/fs；文件尾替换 selftest 触发块）

- [ ] **Step 1: 网络层与主流程**

在 `'use strict';` 下追加：

```js
var https = require('https'), zlib = require('zlib'), fs = require('fs'), path = require('path');
var BASE = process.env.ODDS_PROXY_URL ? process.env.ODDS_PROXY_URL.replace(/\/$/,'') : 'https://webapi.sporttery.cn';
var DATA_FILE = path.join(__dirname, '..', 'data', 'daily-advice.json');

function httpJson(url) {
  return new Promise(function(resolve, reject){
    https.get(url, { timeout: 15000, headers: {
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
    }).on('timeout', function(){ this.destroy(); reject(new Error('超时 '+url.slice(0,80))); }).on('error', reject);
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
      if (pageNo < (v.pages||1)) { pageNo++; return step(); }
      return all;
    });
  }
  return step();
}
function readData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch(e) { return { updateTime:'1970-01-01T00:00:00Z', summary:{}, days:[] }; }
}
function todayKey(nowIso) { return fmtDate(new Date(nowIso)); }
function legKeys(data, exceptDate) {
  var ks = [];
  data.days.forEach(function(d){ if (d.date===exceptDate) return; d.tickets.forEach(function(t){ t.legs.forEach(function(l){ ks.push(l.matchId+'|'+l.pool); }); }); });
  return ks;
}
function koStr(m) { var b=new Date(m.kickoff.getTime()+8*3600e3); return b.toISOString().slice(0,10); }

async function main(regen) {
  var now = new Date();
  var data = readData();
  // ① 回收
  var pending = [];
  data.days.forEach(function(d){ d.tickets.forEach(function(t){ t.legs.forEach(function(l){ if (l.result==='pending') pending.push(l); }); }); });
  if (pending.length) {
    var minD = pending.map(function(l){return l.kickoff.slice(0,10);}).sort()[0];
    var maxD = pending.map(function(l){return l.kickoff.slice(0,10);}).sort().slice(-1)[0];
    var results = await fetchResults(minD, maxD);
    evaluateTickets(data, indexResults(results), now.getTime());
  }
  // ② summary
  data.summary = recomputeSummary(data);
  // ③ 出票(当日无 day 或 regen 才出)
  var today = todayKey(now.toISOString());
  var exists = data.days.filter(function(d){ return d.date===today; })[0];
  if (!exists || regen) {
    var ms = fetchOdds().then(function(raw){
      var norm = raw.map(function(m){ return normalizeMatch(m); })
                    .filter(function(m){ return WHITELIST[m.league] && inWindow(m, now.toISOString()); });
      var tickets = generateTickets(findGoldenCandidates(norm), findBonusCandidates(norm), now.toISOString(), legKeys(data, regen?today:null));
      var day = { date: tickets.length ? tickets[0].legs[0].kickoff.slice(0,10) : today, generatedAt: now.toISOString(), rest: tickets.length===0, tickets: tickets };
      if (exists && regen) { data.days = data.days.filter(function(d){return d.date!==today;}); }
      if (!exists || regen) { data.days.push(day); }
      return day;
    });
    var done = await ms;
    console.log(done.rest ? '今日休战' : '今日出票 '+done.tickets.length+' 张');
  } else { console.log('今日已有票，跳过出票(可用 --regen 覆盖)'); }
  // ④ 写盘
  data.days.sort(function(a,b){return a.date<b.date?-1:1;});
  data.updateTime = new Date().toISOString();
  data.summary = recomputeSummary(data);
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  console.log('已写入 '+DATA_FILE);
}
```

- [ ] **Step 2: 接上入口分发**（替换文件末行触发块）

```js
if (process.argv.indexOf('--selftest') >= 0) { selftest(); }
else { main(process.argv.indexOf('--regen') >= 0).catch(function(e){ console.error('RUN FAIL:', e.message); process.exit(1); }); }
```

- [ ] **Step 3: selftest 回归** Run: `node scripts/daily-advisor.js --selftest` → `ALL PASS`

- [ ] **Step 4: 本机直连真数据试运行**（今日 11:30 批次若已过仍可对次日场次出票）

Run: `node scripts/daily-advisor.js`
Expected: 打印 `今日出票 N 张` 或 `今日休战`，`data/daily-advice.json` 的 days 追加当天条目；人工核对票面符合五条法则

- [ ] **Step 5: 提交（待总司令确认）** `git add scripts/daily-advisor.js data/daily-advice.json && git commit -m "feat: 每日推荐引擎主流程与本机首跑数据"`

---

### Task 5: CF Worker 反代（二期云端化，可在本机通道跑稳后再做）

**Files:**
- Create: `workers/odds-proxy.js`

- [ ] **Step 1: 写 Worker**

```js
// workers/odds-proxy.js — 体彩 API 通用反代（仅两个路径白名单，防开放代理滥用）
const ALLOW = new Set([
  '/gateway/jc/football/getMatchCalculatorV1.qry',
  '/gateway/uniform/football/getUniformMatchResultV1.qry',
]);
export default {
  async fetch(request) {
    const u = new URL(request.url);
    if (!ALLOW.has(u.pathname)) return new Response('forbidden', { status: 403 });
    const upstream = await fetch('https://webapi.sporttery.cn' + u.pathname + u.search, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'application/json', 'Referer': 'https://www.sporttery.cn/jc/zqsgkj/',
      },
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' },
    });
  },
};
```

- [ ] **Step 2: 人工部署（总司令操作，5 分钟）**
1. 打开 https://dash.cloudflare.com → 免费账号注册/登录
2. Workers & Pages → **Create application** → **Create Worker** → 命名 `odds-proxy` → 粘贴上面代码 → Deploy
3. 访问 `https://odds-proxy.<子域>.workers.dev/gateway/jc/football/getMatchCalculatorV1.qry?poolCode=had&channel=c`，浏览器看到 JSON 即成功
4. GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret：`ODDS_PROXY_URL` = `https://odds-proxy.<子域>.workers.dev`

- [ ] **Step 3: 营长验证代理**（部署后由营长执行）

Run: `curl -s "$ODDS_PROXY_URL替换/gateway/uniform/football/getUniformMatchResultV1.qry?matchBeginDate=2026-08-30&matchEndDate=2026-08-31&pageSize=2&pageNo=1&isFix=0&matchPage=1&pcOrWap=1&leagueId=" | head -c 200`
Expected: 以 `{"dataFrom"` 开头的 JSON；用非白名单路径访问应返回 `forbidden`

- [ ] **Step 4: 提交（待总司令确认）** `git add workers/odds-proxy.js && git commit -m "feat: 体彩反代 Cloudflare Worker"`

---

### Task 6: 每日 Action 工作流

**Files:**
- Create: `.github/workflows/daily-advice.yml`

- [ ] **Step 1: 写 workflow**

```yaml
name: 每日投注推荐
on:
  schedule:
    - cron: '30 3 * * *'   # UTC 03:30 = 北京 11:30
  workflow_dispatch:
    inputs:
      regen: { description: '覆盖重出当日票', type: boolean, default: false }
jobs:
  advice:
    runs-on: ubuntu-latest
    permissions: { contents: write }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - name: 回收+出票
        env: { ODDS_PROXY_URL: '${{ secrets.ODDS_PROXY_URL }}' }
        run: node scripts/daily-advisor.js ${{ github.event.inputs.regen == 'true' && '--regen' || '' }}
      - name: 有变化则提交
        run: |
          if git diff --quiet data/daily-advice.json; then echo "无变化"; else
            git config user.name "github-actions[bot]"; git config user.email "github-actions[bot]@users.noreply.github.com"
            git add data/daily-advice.json
            git commit -m "chore: 每日投注推荐 [skip ci]"
            git push
          fi
```

- [ ] **Step 2: 语法自检** Run: `node -e "console.log(require('fs').readFileSync('.github/workflows/daily-advice.yml','utf8').split('\n').length)"` 预期 27 行；YAML 校验靠 push 后 Actions 页（提交由总司令确认后执行，push 走 SSH）

- [ ] **Step 3: 部署演练**（Task 5 完成后）手动 workflow_dispatch 一次，确认：① Node 步骤成功退出 0 ② `last commit` 出现 `chore: 每日投注推荐 [skip ci]` ③ 次日定时首跑验证回收判定

---

### Task 7: 前端「每日推荐」页签（功能版，样式待 Figma）

**Files:**
- Create: `js/daily-advice.js`
- Modify: `index.html:61` 前、容器区、`:103` 前
- Modify: `js/app.js:43、80 后、182`
- Modify: `js/i18n.js` zh/en 各加键、`css/style.css` 末尾追加

- [ ] **Step 1: index.html 插桩**

`<div class="tab active" id="tab-schedule" ...>赛程</div>` 之前插入：
```html
<div class="tab active" id="tab-advice" data-i18n="advice" onclick="switchTab('advice')">每日推荐</div>
```
并把 schedule 那个 div 的 `class="tab active"` 改为 `class="tab"`；在 `<div class="tab-content active" id="schedule-content">` 之前插入：
```html
<div class="tab-content active" id="advice-content"><div class="spinner"></div></div>
```
（同样去掉 schedule-content 的 `active`）；`app.js` script 标签前插入 `<script src="js/daily-advice.js"></script>`

- [ ] **Step 2: app.js 三处**

`:43` → `var currentTab = 'advice';`；`switchTab` 的 else-if 链加：
```js
  } else if (tab === 'advice') {
    renderAdvice();
```
`:182` → `switchTab('advice');`

- [ ] **Step 3: i18n.js 加键**（zh 对象 `schedule:` 键旁，en 同位）

```js
    advice: '每日推荐', adviceRest: '今日休战·无黄金区间场次', adviceFresh: '引擎正常 · 最后更新',
    adviceStale: '昨日引擎未跑成', adviceDead: '断更超两天 · 请检查 Actions', adviceNoData: '暂无推荐数据',
    adviceToday: '今日出票', adviceHistory: '战绩档案', adviceBudget: '日预算',
```
en 对应：`advice:'Daily Picks', adviceRest:'Rest day — no golden-zone matches', adviceFresh:'Engine OK · last update', adviceStale:'Engine missed yesterday', adviceDead:'Stale >2 days — check Actions', adviceNoData:'No data yet', adviceToday:"Today's Tickets", adviceHistory:'Track Record', adviceBudget:'Daily budget',`

- [ ] **Step 4: 写 `js/daily-advice.js`**

```js
// js/daily-advice.js — 每日推荐页签(功能版, 视觉等 Figma)
var adviceData = null;
function adviceFetch() {
  return fetch('data/daily-advice.json?_=' + Date.now()).then(function(r){ if(!r.ok) throw new Error(r.status); return r.json(); });
}
function fmtBeijing(iso) {
  return new Date(iso).toLocaleString('zh-CN', { timeZone:'Asia/Shanghai', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
}
function freshnessHtml(d) {
  if (!d || !d.updateTime) return '<span class="advice-badge red">'+t('adviceNoData')+'</span>';
  var h = (Date.now() - new Date(d.updateTime).getTime()) / 3600e3;
  var cls = h <= 26 ? 'green' : (h <= 48 ? 'amber' : 'red');
  var label = cls==='green' ? t('adviceFresh') : (cls==='amber' ? t('adviceStale') : t('adviceDead'));
  return '<span class="advice-badge '+cls+'">'+label+' '+fmtBeijing(d.updateTime)+'（北京）</span>';
}
function pct(x){ return Math.round(x*1000)/10 + '%'; }
function legHtml(l) {
  var res = l.result==='hit' ? '✓ '+(l.score||'') : (l.result==='miss' ? '✗ '+(l.score||'') : (l.result==='void' ? '作废' : '待赛'));
  return '<div class="advice-leg"><span class="advice-leg-lg">'+l.league+'</span>'+
    '<span class="advice-leg-vs">'+l.match+' · '+l.pickLabel+' <em>'+l.kickoff+'</em></span>'+
    '<span class="advice-leg-odds">'+l.odds+'</span><span class="advice-leg-res '+l.result+'">'+res+'</span></div>';
}
function ticketHtml(tk) {
  return '<div class="advice-ticket '+tk.kind+'"><div class="advice-tk-head"><b>'+
    ({parlay2:'2串1', single:'单关', bonus:'±2彩蛋'})[tk.kind]+'</b><span class="advice-tk-rule"> '+tk.rule+'</span>'+
    '<span class="advice-tk-money">投入 ¥'+tk.stake+' · 赔率积 '+tk.combinedOdds+' · 命中返 ¥'+round2(tk.stake*tk.combinedOdds).toFixed(2)+' → '+
    (tk.result==='hit'?'✓中':(tk.result==='miss'?'✗错':(tk.result==='void'?'作废':'待赛')))+'</span></div>'+
    tk.legs.map(legHtml).join('')+'</div>';
}
function historyHtml(days) {
  var rows = days.slice().sort(function(a,b){return a.date<b.date?1:-1;}).map(function(d){
    if (d.rest) return '<tr class="rest"><td>'+d.date+'</td><td colspan="3">休战</td></tr>';
    var stake = d.tickets.reduce(function(a,t){return a+(t.void?0:t.stake);},0);
    var ret = d.tickets.reduce(function(a,t){return a+(t.payout||0);},0);
    var net = round2(ret-stake);
    return '<tr><td>'+d.date+'</td><td>'+d.tickets.length+'张</td><td>¥'+stake+'</td>'+
      '<td class="'+(net>=0?'pos':'neg')+'">'+(net>=0?'+':'')+net+'</td></tr>';
  });
  return '<table class="advice-hist"><tr><th>日期</th><th>票</th><th>投入</th><th>盈亏</th></tr>'+rows.join('')+'</table>';
}
function curveSvg(days) {
  var pts = [], acc = 0;
  days.slice().sort(function(a,b){return a.date<b.date?-1:1;}).forEach(function(d){
    d.tickets.forEach(function(t){ if(!t.void && t.result!=='pending') acc += (t.payout||0) - t.stake; });
    pts.push(round2(acc));
  });
  if (pts.length < 2) return '';
  var min = Math.min.apply(null, pts.concat([0])), max = Math.max.apply(null, pts.concat([0]));
  var span = (max-min)||1, W=900, H=120;
  var coords = pts.map(function(v,i){ return (i/(pts.length-1)*W).toFixed(1)+','+(H-(v-min)/span*H).toFixed(1); });
  return '<svg viewBox="0 0 '+W+' '+H+'" class="advice-curve"><polyline fill="none" stroke="#ffd700" stroke-width="2" points="'+coords.join(' ')+'"/></svg>';
}
async function renderAdvice() {
  var el = document.getElementById('advice-content');
  el.innerHTML = '<div class="spinner"></div>';
  try { adviceData = await adviceFetch(); }
  catch(e) { el.innerHTML = '<div class="advice-empty">'+t('adviceNoData')+'</div>'; return; }
  var d = adviceData, s = d.summary, latest = d.days[d.days.length-1];
  var html = '<div class="advice-wrap">' + freshnessHtml(d) +
    '<div class="advice-stats"><span>累计收益率 <b class="'+(s.roi>=0?'pos':'neg')+'">'+pct(s.roi)+'</b></span>'+
    '<span>单场命中率 <b>'+pct(s.legHitRate)+'</b></span><span>整票命中率 <b>'+pct(s.ticketHitRate)+'</b></span>'+
    '<span>连红 <b>'+s.curWinStreak+'</b></span><span>累计盈亏 <b class="'+(s.returned-s.staked>=0?'pos':'neg')+'">¥'+round2(s.returned-s.staked).toFixed(2)+'</b></span></div>';
  if (latest) {
    html += '<h2 class="advice-h">'+t('adviceToday')+' · '+latest.date+'</h2>';
    html += latest.rest ? '<div class="advice-rest">'+t('adviceRest')+'</div>' : latest.tickets.map(ticketHtml).join('');
    var stake = latest.tickets.reduce(function(a,t){return a+t.stake;},0);
    html += '<div class="advice-budget">'+t('adviceBudget')+' ¥'+stake+' / ¥20</div>';
  }
  html += '<h2 class="advice-h">'+t('adviceHistory')+'</h2>'+historyHtml(d.days)+
    '<h2 class="advice-h">资金曲线</h2><div class="advice-curvebox">'+curveSvg(d.days)+'</div>'+
    '<div class="advice-disc">系统仅按五条黄金法则生成模拟票 · 不构成投注建议 · 亏¥30停手/赚¥50收手</div></div>';
  el.innerHTML = html;
}
```

注：`round2` 在 advisor 脚本里是 Node 私有；浏览器端此文件自带定义——在 `renderAdvice` 前加一行 `function round2(x){return Math.round(x*100)/100;}`（避免与全局冲突用本文件内局部函数亦可，此站点全 var 全局，round2 未被他处占用，已确认）。

- [ ] **Step 5: css/style.css 末尾追加**

```css
/* === Advice tab === */
.advice-wrap{max-width:900px;margin:0 auto;padding:8px 2px}
.advice-badge{display:inline-block;padding:4px 14px;border-radius:16px;font-size:.8rem;margin-bottom:12px}
.advice-badge.green{background:rgba(46,160,67,.15);color:#4ade80;border:1px solid rgba(74,222,128,.4)}
.advice-badge.amber{background:rgba(245,158,11,.12);color:#fbbf24;border:1px solid rgba(251,191,36,.4)}
.advice-badge.red,.advice-empty{background:rgba(239,68,68,.12);color:#f87171;border:1px solid rgba(248,113,113,.4);padding:4px 14px;border-radius:16px;font-size:.8rem;display:inline-block}
.advice-stats{display:flex;gap:18px;flex-wrap:wrap;font-size:.85rem;color:#a3b8a3;margin-bottom:16px}
.advice-stats b{color:#ffd700;font-size:1rem}
.advice-stats .neg,.advice-hist .neg{color:#f87171} .advice-stats .pos,.advice-hist .pos{color:#4ade80}
.advice-h{font-size:1.1rem;color:#ffd700;margin:20px 0 10px;border-left:3px solid #ffd700;padding-left:10px}
.advice-ticket{background:#122512;border:1px solid #2a4a2a;border-radius:10px;padding:12px 14px;margin-bottom:12px}
.advice-ticket.bonus{border-color:#5b3a14}
.advice-tk-head{display:flex;flex-wrap:wrap;gap:10px;align-items:baseline;font-size:.85rem}
.advice-tk-head b{color:#ffd700}
.advice-tk-rule{color:#7a8b7a;font-size:.75rem}
.advice-tk-money{margin-left:auto;color:#a3b8a3;font-size:.8rem}
.advice-leg{display:grid;grid-template-columns:52px 1fr 48px 70px;gap:10px;font-size:.85rem;padding:7px 0;border-top:1px dashed #1f3d1f;align-items:center}
.advice-leg-lg{color:#8fa38f;font-size:.72rem} .advice-leg-vs em{font-style:normal;color:#6b7d6b;font-size:.72rem;margin-left:6px}
.advice-leg-odds{color:#ffd700;font-weight:700} .advice-leg-res{font-size:.78rem;text-align:center}
.advice-leg-res.hit{color:#4ade80} .advice-leg-res.miss{color:#f87171}
.advice-budget{font-size:.8rem;color:#a3b8a3;text-align:right}
.advice-rest{background:#122512;border:1px dashed #2a4a2a;border-radius:10px;padding:20px;text-align:center;color:#8fa38f}
.advice-hist{width:100%;border-collapse:collapse;font-size:.82rem}
.advice-hist th,.advice-hist td{padding:7px 10px;border-bottom:1px solid #1c351c;text-align:left}
.advice-hist th{color:#8fa38f}
.advice-curvebox{background:#122512;border:1px solid #2a4a2a;border-radius:10px;padding:12px}
.advice-curve{width:100%;height:120px;display:block}
.advice-disc{margin-top:24px;font-size:.7rem;color:#5a6b5a;text-align:center}
```

- [ ] **Step 6: 浏览器实测（npx serve . -p 3000）**

① 打开 http://localhost:3000 默认落在「每日推荐」，Task 4 首跑有数据则票卡渲染正确；② 临时改名 `data/daily-advice.json` 验证红色「暂无推荐数据」不炸其他页签；③ 各页签切换回归；④ 中英切换文案跟随

- [ ] **Step 7: 提交（待总司令确认）** `git add js/daily-advice.js index.html js/app.js js/i18n.js css/style.css && git commit -m "feat: 每日推荐页签"`

---

### Task 8: 本机计划任务（主通道，Task 4 跑通后立即注册）

**Files:**
- Create: `scripts/run-daily-advisor.ps1`

- [ ] **Step 1: 写脚本**

```powershell
# scripts/run-daily-advisor.ps1 — 本机备用通道(Worker挂掉时顶上)
# 注册(管理员 PowerShell, 每天北京 11:30):
#   schtasks /create /tn DailyBettingAdvisor /sc daily /st 11:30 /f ^
#     /tr "powershell -ExecutionPolicy Bypass -File E:\GitHub\WorldCup2026\scripts\run-daily-advisor.ps1"
cd E:\GitHub\WorldCup2026
git pull --rebase
node scripts/daily-advisor.js
if ($LASTEXITCODE -ne 0) { exit 1 }
git add data/daily-advice.json
git diff --cached --quiet -
if ($LASTEXITCODE -ne 0) { git commit -m "chore: 每日投注推荐(本机备用) [skip ci]"; git push origin main }
```

- [ ] **Step 2: 试运行**（本机无 `ODDS_PROXY_URL` 环境变量即自动直连）：`powershell -File scripts/run-daily-advisor.ps1` → 输出与 git 状态正常
- [ ] **Step 3: 注册计划任务**（脚本注释里的 `schtasks` 命令，管理员 PowerShell 执行一次）→ 次日核对自动出票+push 成功
- [ ] 与二期 Actions 并行安全性：引擎对"当日已有 day"只回收不出票，两条通道谁先跑谁出票，另一条自然跳过，无需互斥锁

---

### Task 9:（待批）停用 fetch-odds.yml 的 15 分钟定时

**Files:**
- Modify: `.github/workflows/fetch-odds.yml:4-6`

- [ ] **Step 1: 注释 cron 段**

```yaml
on:
  #  世界杯已结束且 WCC 场次为空，定时停用（手动 workflow_dispatch 仍可用）
  # schedule:
  #   - cron: '*/15 * * * *'
  workflow_dispatch:
```

- [ ] **Step 2: 总司令批准后随任一提交推送**

---

### Task 10: 全链路验收

- [ ] ① Actions 页 daily-advice 手动 dispatch 成功（走 Worker 代理）
- [ ] ② GitHub Pages 上「每日推荐」页签显示今日票与绿色徽章
- [ ] ③ 次观察自动 run：回收昨日票 → result 由 pending 变 hit/miss、`summary` 数字变化、页面曲线多一个点
- [ ] ④ 断更演练（可选）：等某日 Action 失败 → 页面徽章次日变橙——如实反映即达标

---

## Self-Review 结论（已执行）

1. **Spec 覆盖**：§3 数据流→Task4/6；§4 格式→Task1/3；§5 十条规则→Task2（规则1/2/3/4/5/6/7/8/9/10 分别对应 normalize过滤/golden/pairing/single/bonus/budget/dedup，白名单常量 WHITELIST）；§6 回收→Task3/4；§7 页签+徽章+文案口径→Task7；§8 错误处理→httpJson reject+exit1、徽章阈值、void；§9 测试→Task2/3 selftest、Task7 浏览器四态、Task10 演练；§10 交付物全部有任务映射；备用通道→Task8。
2. **占位符扫描**：无 TBD 步骤；Task2 Step1/3 是 TDD 骨架+完整实现的拆分，非占位。
3. **类型一致性**：`legs[].kickoff` 统一为 `'YYYY-MM-DD HH:MM'`（北京）；判定键统一 `matchId|pool`；`pick` 统一 h/d/a；`round2` 双端各自定义（Node 在 advisor、浏览器在 daily-advice.js）；`goalLine` 在 HHAD 腿生成时**未存入 leg**——Task2 `legOf` 需在实现时补 `goalLine: c.gl`（已在 Task3 judgeLeg 依赖 `leg.goalLine`）→ **修正：Task2 Step1 `legOf` 返回对象加 `goalLine: c.gl`**（执行时注意，selftest 用例G 依赖此字段）。
