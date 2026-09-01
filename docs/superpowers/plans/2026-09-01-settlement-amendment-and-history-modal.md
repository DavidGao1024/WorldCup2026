# 回收口径修订 + 历史行弹窗 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ①废除"7 天自动作废退本"（长期未回收=保持 pending 不计统计，新增 `--settle` 人工判定入口，前端超 7 天待判定票显示"待判定"）；②每日推荐历史表任一行点击 → 弹窗展示当日全部模拟票。

**Architecture:** 引擎（`scripts/daily-advisor.js`，零依赖 Node，自检内置 `--selftest`）先行，纯前端（`js/daily-advice.js` + `css/style.css`）复用既有 `ticketHtml()` 与 match-modal 弹窗惯例。规格：`docs/superpowers/specs/2026-09-01-history-ticket-modal-design.md`。

**Tech Stack:** vanilla JS（全局 var，无构建）、Node 内置自检、CSS。

**提交纪律（覆盖技能默认）:** 总司令指令——**全程不 commit**，两工程全部完成并验收后，一次性做 2 个本地提交（口径/弹窗各一），**push 由总司令亲自执行**。

---

## Part A 回收口径修订

### Task A1: 先写失败自检（TDD 红）

**Files:**
- Modify: `scripts/daily-advisor.js:277-280`（G3 用例整段替换）

- [ ] **Step 1: 替换 G3 用例 + 新增 G4（人工判定）**

把 `// G3: void 票退回不计统计` 起至 `ok(s3.staked===0 ... 'G3 void 不进分母');` 止的三行用例替换为：

```js
  // G3(修订2026-09-01 总司令令): 长期未回收保持 pending, 不再自动作废
  var d3 = { days:[ {date:'2026-09-01', tickets:[{id:'Z1', kind:'single', stake:4, combinedOdds:1.5, void:false, result:'pending', payout:null,
      legs:[{matchId:77, matchNumStr:'周一077', kickoff:'2026-08-01 03:00', pool:'HAD', pick:'h', goalLine:null, result:'pending', score:null}]}]} ]};
  evaluateTickets(d3, indexResults([]), new Date('2026-09-01T12:00:00Z').getTime()); // 开球已过 31 天
  ok(d3.days[0].tickets[0].result==='pending' && !d3.days[0].tickets[0].void, 'G3 超30天无赛果仍 pending(自动作废已废除)');
  var s3 = recomputeSummary(d3);
  ok(s3.staked===0 && s3.returned===0 && s3.legsTotal===0, 'G3 pending 不进任何统计');
  // G4: 人工判定入口
  var n4 = applySettleDirectives(d3, ['77|HAD=hit']);
  evaluateTickets(d3, indexResults([]), Date.now());
  var t4 = d3.days[0].tickets[0];
  ok(n4===1 && t4.result==='hit' && t4.payout===6, 'G4 人工判 hit 即结算 4×1.5=6');
  var threw=0; try { applySettleDirectives(d3, ['77|HAD=miss']); } catch(e){ threw=1; }
  ok(threw===1, 'G4 已有判定不可重复人工覆盖');
  var threw2=0; try { applySettleDirectives({days:[]}, ['999|HAD=hit']); } catch(e){ threw2=1; }
  ok(threw2===1, 'G4 找不到目标场即抛错');
```

- [ ] **Step 2: 运行确认失败**

Run: `node scripts/daily-advisor.js --selftest`
Expected: `FAIL ...` 若干条 + 引用 `applySettleDirectives is not defined` 崩溃或失败计数 >0

### Task A2: 引擎实现（TDD 绿）

**Files:**
- Modify: `scripts/daily-advisor.js:136-157`（evaluateTickets 去 void）
- Modify: `scripts/daily-advisor.js:2`（usage 注释）
- Create fn: `applySettleDirectives`（放 `evaluateTickets` 之后）
- Modify: `scripts/daily-advisor.js:394-395`（CLI 分发）

- [ ] **Step 1: evaluateTickets 删自动作废**

```js
      t.legs.forEach(function(l){
        if (l.result === 'pending') {
          judgeLeg(l, findResult(idx, l));
          if (l.result === 'pending') allSettled = false;
        }
      });
      if (!allSettled) { t.result = 'pending'; return; }
      var hit = t.legs.every(function(l){return l.result==='hit';});
```

（即删除 `ageDays` 三行与 `var voided ... if (voided) {...}` 两行；`recomputeSummary` 的 `!t.void` 守卫保留——历史数据无 void，属无害保险）

- [ ] **Step 2: 新增人工判定函数（evaluateTickets 结尾大括号后）**

```js
// 人工判定: 总司令对长期未回收场次定输赢。directive 形如 "2041183|HAD=hit"
function applySettleDirectives(data, directives) {
  var applied = 0;
  (directives||[]).forEach(function(directive){
    var kv = String(directive).split('=');
    var key = kv[0], verdict = (kv[1]||'').trim();
    if (!/^(hit|miss)$/.test(verdict)) throw new Error('判定只接受 hit|miss: '+directive);
    var found = false;
    data.days.forEach(function(day){ day.tickets.forEach(function(t){ t.legs.forEach(function(l){
      if (l.matchId+'|'+l.pool === key) {
        found = true;
        if (l.result !== 'pending') throw new Error('该场已有判定, 人工不覆盖: '+key+' ('+l.result+')');
        l.result = verdict;
        if (l.score === null || l.score === undefined) l.score = '人工判定';
        applied++;
      }
    });});});
    if (!found) throw new Error('未找到待判定的场: '+key+' (键=比赛ID|玩法, 如 2041183|HAD)');
  });
  return applied;
}
```

- [ ] **Step 3: CLI 分发（替换文件末两行 if/else）**

```js
var settleIdx = process.argv.indexOf('--settle');
if (settleIdx >= 0) {
  var dirs = process.argv.slice(settleIdx+1).filter(function(a){ return a.indexOf('--')!==0; });
  try {
    var sData = readData();
    var n = applySettleDirectives(sData, dirs);
    evaluateTickets(sData, indexResults([]), Date.now());
    sData.days.sort(function(a,b){ return a.date<b.date?-1:1; });
    sData.summary = recomputeSummary(sData);
    sData.updateTime = new Date().toISOString();
    writeDataAtomic(sData);
    console.log('人工判定 '+n+' 场已落盘(关联票已即时结算)');
  } catch(e){ console.error('settle 失败: '+e.message); process.exit(1); }
} else if (process.argv.indexOf('--selftest') >= 0) selftest();
else runMain(process.argv.indexOf('--regen') >= 0, process.argv.indexOf('--force') >= 0).catch(function(e){ console.error('RUN FAIL:', e.message); process.exit(1); });
```

- [ ] **Step 4: usage 注释（文件头第 4 行下加一行）**

```
//        node scripts/daily-advisor.js --settle <matchId|pool>=<hit|miss> [更多...]  人工判定长期未回收场
```

- [ ] **Step 5: 自检全绿**

Run: `node scripts/daily-advisor.js --selftest`
Expected: `ALL PASS`（31 条：原 26 − G3 旧 3 + 新 6）

### Task A3: 前端"待判定"显示

**Files:**
- Modify: `js/daily-advice.js:17-22`（legHtml）、`:24-30`（ticketHtml）

- [ ] **Step 1: 判定文案改造（替换两个函数）**

```js
function adviceStuckDays(kickoff) { // 开球至今日数
  var t = new Date(String(kickoff||'').replace(' ','T')+'+08:00').getTime();
  return isNaN(t) ? 0 : (Date.now()-t)/86400e3;
}
function legHtml(l) {
  var res = l.result==='hit' ? '✓ '+(l.score||'') : (l.result==='miss' ? '✗ '+(l.score||'')
    : (adviceStuckDays(l.kickoff) > 7 ? '待判定' : '待赛'));
  return '<div class="advice-leg"><span class="advice-leg-lg">'+l.league+'</span>'+
    '<span class="advice-leg-vs">'+l.match+' · '+l.pickLabel+' <em>'+l.kickoff+'</em></span>'+
    '<span class="advice-leg-odds">'+l.odds+'</span><span class="advice-leg-res '+l.result+'">'+res+'</span></div>';
}
```

`ticketHtml` 内 `resTxt` 行替换为：

```js
  var resTxt = tk.result==='hit' ? '✓ 中' : (tk.result==='miss' ? '✗ 错' : (tk.result==='void' ? '不计'
    : (tk.legs.some(function(l){return l.result==='pending' && adviceStuckDays(l.kickoff)>7;}) ? '待判定' : '待赛')));
```

- [ ] **Step 2: 浏览器快验**（`npx serve . -p 3000`，每日推荐页签：现两日数据全已结算，文案应无变化、无 console 报错）

### Task A4: 旧规格加修订戳

**Files:**
- Modify: `docs/superpowers/specs/2026-08-31-daily-betting-advisor-design.md`（头部）

- [ ] **Step 1:** 在文件标题行下插入：

```markdown
> **2026-09-01 修订（总司令令）**：§回收 中"开球 7 天未回收自动作废退本"机制**废止**。长期未回收场保持 pending 不计统计，改由 `--settle` 人工判定；前端显示"待判定"。详见 `docs/superpowers/plans/2026-09-01-settlement-amendment-and-history-modal.md` Part A。
```

---

## Part B 历史行点击弹窗

**Files:**
- Modify: `js/daily-advice.js`（`historyHtml` 加 data-date；新增 3 函数 + 缓存/委托绑定；`renderAdvice` 成功分支存缓存）
- Modify: `css/style.css`（1624 行 advice 区追加 ~8 行）

- [ ] **Step 1: `historyHtml` 行输出加 `data-date`**

休战行：`'<tr class="rest" data-date="'+d.date+'">'`；有票行：`'<tr data-date="'+d.date+'">'`（表头 `<tr><th>` 不加）。

- [ ] **Step 2: 新增弹窗三函数 + 缓存（追加到 `curveSvg` 之后）**

```js
var adviceDaysCache = [], adviceHistBound = false;
function adviceDayByDate(dateStr){ for (var i=0;i<adviceDaysCache.length;i++){ if(adviceDaysCache[i].date===dateStr) return adviceDaysCache[i]; } return null; }
function adviceDayHeadHtml(d){
  if (d.rest || !d.tickets.length) return d.date+' · 休战';
  var stake=0, ret=0, settled=true;
  d.tickets.forEach(function(t){ if(!t.void) stake+=(t.stake||0); ret+=(t.payout||0); if(t.result==='pending') settled=false; });
  var net = adviceRound2(ret-stake);
  return d.date+' · '+d.tickets.length+'张票 · 投入¥'+stake+' · '+
    (settled ? ('盈亏'+(net>=0?'+':'')+net.toFixed(2)) : '待结算');
}
function openAdviceDayModal(dateStr){
  var d = adviceDayByDate(dateStr); if (!d) return;
  closeAdviceDayModal();
  var overlay = document.createElement('div');
  overlay.className = 'match-modal-overlay';
  overlay.innerHTML = '<div class="match-modal advice-modal-box">'+
    '<button class="match-modal-close" aria-label="close">✕</button>'+
    '<div class="advice-modal-head">'+adviceDayHeadHtml(d)+'</div>'+
    (d.rest || !d.tickets.length ? '<div class="advice-rest">'+t('adviceRest')+'</div>' : d.tickets.map(ticketHtml).join(''))+
    '</div>';
  overlay.addEventListener('click', function(e){ if (e.target===overlay) closeAdviceDayModal(); });
  overlay.querySelector('.match-modal-close').addEventListener('click', closeAdviceDayModal);
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  adviceModalEsc = function(e){ if (e.key==='Escape') closeAdviceDayModal(); };
  document.addEventListener('keydown', adviceModalEsc);
}
var adviceModalEsc = null;
function closeAdviceDayModal(){
  var boxes = document.querySelectorAll('.advice-modal-box');
  if (boxes.length) { boxes[boxes.length-1].parentNode.remove(); document.body.style.overflow=''; }
  if (adviceModalEsc) { document.removeEventListener('keydown', adviceModalEsc); adviceModalEsc = null; }
}
```

⚠️ 与 match-modal 共存：`closeAdviceDayModal` 只摘 `.advice-modal-box` 所在遮罩，**不得**用 `.match-modal-overlay` 选择器误关比赛弹窗。

- [ ] **Step 3: `renderAdvice()` 成功分支加缓存与一次性委托**

`var d = await adviceFetch();` 之后插入：

```js
    adviceDaysCache = d.days || [];
    if (!adviceHistBound) {
      adviceHistBound = true;
      document.getElementById('advice-content').addEventListener('click', function(e){
        var tr = e.target.closest && e.target.closest('tr[data-date]');
        if (tr) openAdviceDayModal(tr.getAttribute('data-date'));
      });
    }
```

- [ ] **Step 4: CSS（style.css advice 区末尾追加）**

```css
.advice-hist tr[data-date]{cursor:pointer}
.advice-hist tr[data-date]:hover td{background:rgba(255,215,0,.06)}
.advice-modal-box{max-height:85vh;overflow-y:auto;min-width:480px}
.advice-modal-head{color:#ffd700;font-weight:700;font-size:.95rem;padding:12px 14px;border-bottom:1px solid rgba(255,215,0,.15)}
@media (max-width:640px){ .advice-modal-box{min-width:0;width:94vw} }
```

- [ ] **Step 5: 浏览器验收（对照规格 §9 全 7 条）**

`npx serve . -p 3000` + 浏览器（chrome-devtools/playwright MCP）：
1. 点 2026-08-31 行 → 弹窗：头 `2026-08-31 · 2张票 · 投入¥6 · 盈亏+2.14`，两张票卡（阿斯顿维拉客胜✓0:1 等），与今日区同款
2. 点 2026-09-01 休战行 → 头"休战"+ 休战文案块
3. 待结算样本缺失 → 临时改 `data/daily-advice.json` 造一 pending 票验证"待结算"+（开球>7 天）"待判定"文案，验后 `git checkout -- data/daily-advice.json`
4. ✕/遮罩/ESC 三关都收、关闭后可滚动
5. 连点两行内容切换无叠加；开着弹窗再点行不重复堆叠
6. 中英切换 + 离开页签再回 → 行仍可点（委托存活）
7. console 零报错

---

## 收尾

- [ ] **自检复跑**: `node scripts/daily-advisor.js --selftest` → `ALL PASS`
- [ ] **本地提交 2 枚（不 push）**：
  - `fix: 回收口径修订——废除自动作废, 长期未回收待人工判定(--settle)`（daily-advisor.js / daily-advice.js / 旧 spec 戳 / 本 plan）
  - `feat: 每日推荐历史行点击弹窗(票卡+汇总头, 复用票卡渲染)`（daily-advice.js / style.css / 弹窗 spec）
- [ ] **向总司令汇报**，push 由总司令执行
- [ ] 提交获准后：更新记忆（作废口径裁决、待判定机制）与 CLAUDE.md 每日推荐小节（含 `--settle` 用法）

## 自审记录（写计划后复查）

- 规格覆盖：弹窗 spec §2-§9 逐条 ↔ Step 对应 ✓；口径裁决 4 点（废自动作废/不计统计/待判定显示/人工入口）↔ A1-A3 ✓
- 占位符扫描：无 TBD；待结算造数步骤给出还原命令 ✓
- 类型一致：`adviceStuckDays`/`adviceDayHeadHtml`/`openAdviceDayModal(dateStr)`/`applySettleDirectives(data,dirs)` 前后引用一致 ✓；G4 期望 `payout===6`（round2(4×1.5)）✓；自检计数 26−3+6=31 ✓
