// js/daily-advice.js — 每日推荐页签(功能版, 视觉待 Figma)
// 补出按钮：云端中继(Worker)尚未部署 → 点击显示「敬请期待」占位。
// 部署后：ADVICE_WORKER 回填真实 URL，并把 ADVICE_DISPATCH_READY 置 true。
// Worker 源码留档见 scripts/shadow-trigger-worker.js 头部说明。
var ADVICE_WORKER = 'https://shadow-trigger.REPLACE_ME.workers.dev';
var ADVICE_PASS_KEY = 'advice_dispatch_pass';
var ADVICE_DISPATCH_READY = false;
function adviceRound2(x){ return Math.round(x*100)/100; }
function adviceFetch() {
  return fetch('data/daily-advice.json?_=' + Date.now()).then(function(r){ if(!r.ok) throw new Error(r.status); return r.json(); });
}
function adviceBeijing(iso) {
  return new Date(iso).toLocaleString('zh-CN', { timeZone:'Asia/Shanghai', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
}
function freshnessHtml(d) {
  if (!d || !d.updateTime) return '<span class="advice-badge red">'+t('adviceNoData')+'</span>';
  var h = (Date.now() - new Date(d.updateTime).getTime()) / 3600e3;
  var cls = h <= 26 ? 'green' : (h <= 48 ? 'amber' : 'red');
  var label = cls==='green' ? t('adviceFresh') : (cls==='amber' ? t('adviceStale') : t('adviceDead'));
  return '<span class="advice-badge '+cls+'">'+label+' '+adviceBeijing(d.updateTime)+t('adviceTz')+'</span>';
}
function advicePct(x){ return (x==null?'0':(Math.round(x*1000)/10)) + '%'; }
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
var KIND_ZH = { parlay2:'2串1', single:'单关', bonus:'±2彩蛋' };
function ticketHtml(tk) {
  var resTxt = tk.result==='hit' ? '✓ 中' : (tk.result==='miss' ? '✗ 错' : (tk.result==='void' ? '不计'
    : (tk.legs.some(function(l){return l.result==='pending' && adviceStuckDays(l.kickoff)>7;}) ? '待判定' : '待赛')));
  return '<div class="advice-ticket '+tk.kind+'"><div class="advice-tk-head"><b>'+(KIND_ZH[tk.kind]||tk.kind)+'</b>'+
    '<span class="advice-tk-rule"> '+tk.rule+'</span>'+
    '<span class="advice-tk-money">投入 ¥'+tk.stake+' · 赔率积 '+tk.combinedOdds+' · 命中返 ¥'+adviceRound2(tk.stake*tk.combinedOdds).toFixed(2)+' → '+resTxt+'</span></div>'+
    tk.legs.map(legHtml).join('')+'</div>';
}
function historyHtml(days) {
  var rows = days.slice().sort(function(a,b){return a.date<b.date?1:-1;}).map(function(d){
    if (d.rest) return '<tr class="rest" data-date="'+d.date+'"><td>'+d.date+'</td><td>—</td><td>休战</td><td>—</td></tr>';
    var stake = d.tickets.reduce(function(a,t){return a+(t.void?0:t.stake);},0);
    var settled = d.tickets.every(function(t){return t.result!=='pending';});
    var ret = d.tickets.reduce(function(a,t){return a+(t.payout||0);},0);
    var net = adviceRound2(ret-stake);
    return '<tr data-date="'+d.date+'"><td>'+d.date+'</td><td>'+d.tickets.length+' 张</td><td>¥'+stake+'</td><td>'+
      (settled ? '<span class="'+(net>=0?'pos':'neg')+'">'+(net>=0?'+':'')+net.toFixed(2)+'</span>' : '待结算')+'</td></tr>';
  });
  return '<table class="advice-hist"><tr><th>批次日</th><th>票</th><th>投入</th><th>盈亏</th></tr>'+rows.join('')+'</table>';
}
function curveSvg(days) {
  var pts = [], acc = 0;
  days.slice().sort(function(a,b){return a.date<b.date?-1:1;}).forEach(function(d){
    d.tickets.forEach(function(tk){ if(!tk.void && tk.result!=='pending') acc += (tk.payout||0) - tk.stake; });
    pts.push(adviceRound2(acc));
  });
  if (pts.length < 2) return '<div style="color:#6b7d6b;font-size:.8rem">数据不足两天，曲线待次日生成</div>';
  var min = Math.min.apply(null, pts.concat([0])), max = Math.max.apply(null, pts.concat([0]));
  var span = (max-min)||1, W=900, H=120;
  var coords = pts.map(function(v,i){ return (i/(pts.length-1)*W).toFixed(1)+','+(H-(v-min)/span*H).toFixed(1); }).join(' ');
  var zeroY = (H-(0-min)/span*H).toFixed(1);
  return '<svg viewBox="0 0 '+W+' '+H+'" class="advice-curve" preserveAspectRatio="none">'+
    '<line x1="0" y1="'+zeroY+'" x2="'+W+'" y2="'+zeroY+'" stroke="#3a5a3a" stroke-dasharray="4 4"/>'+
    '<polyline fill="none" stroke="#ffd700" stroke-width="2" points="'+coords+'"/></svg>';
}
var adviceDaysCache = [], adviceHistBound = false, adviceModalEsc = null, adviceLatest = null;
function adviceTodayBJ(){ return new Date(Date.now()+8*3600e3).toISOString().slice(0,10); }
function adviceDispatchState(latest){
  if (!latest || latest.date !== adviceTodayBJ()) return { ok:true, label:'今日暂无批次 · 补出' };
  if (latest.rest) return { ok:true, label:'引擎判定休战 · 仍要补出' };
  if (latest.tickets && latest.tickets.length) return { ok:false, label:'今日已出 '+latest.tickets.length+' 张' };
  return { ok:true, label:'今日暂无票 · 补出' };
}
async function adviceDispatch(btn, latest){
  if (!ADVICE_DISPATCH_READY) {
    var hint = document.getElementById('advice-dispatch-msg');
    if (hint) hint.textContent = '人工补出敬请期待 · 云端中继尚未部署，当前靠云端 11:30 / 13:30 双窗口与本机 12:45 兜底';
    return;
  }
  var pass = localStorage.getItem(ADVICE_PASS_KEY) || '';
  if (!pass) { pass = (window.prompt('请输入补出口令')||'').trim(); if (!pass) return; }
  var oldText = btn.textContent;
  btn.disabled = true; btn.textContent = '已受理 · 云端处理中，约 5~10 分钟';
  try {
    var r = await fetch(ADVICE_WORKER + '/dispatch', {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({pass:pass})
    });
    var j = {}; try { j = await r.json(); } catch(e){}
    if (r.status === 401) { localStorage.removeItem(ADVICE_PASS_KEY); btn.disabled=false; btn.textContent='口令不正确 · 重试'; return; }
    if (!r.ok) { btn.disabled=false; btn.textContent=(j.error||'触发失败')+' · 重试'; return; }
    localStorage.setItem(ADVICE_PASS_KEY, pass);
    advicePollTicket(0);
  } catch(e) {
    btn.disabled = false; btn.textContent = '触发通道不可用 · 重试';
    window.setTimeout(function(){ btn.textContent = oldText; }, 4000);
  }
}
function advicePollTicket(tries){
  if (tries > 40) {                  // 30 秒 × 40 = 20 分钟窗口（实测起班排队最长约 9 分钟）
    var el = document.getElementById('advice-dispatch-msg');
    if (el) el.textContent = '未检测到新票 · 请稍后手动刷新，或查看哨兵/status 记录';
    return;
  }
  window.setTimeout(async function(){
    try {
      var d = await adviceFetch();
      adviceDaysCache = d.days || [];
      var last = adviceDaysCache[adviceDaysCache.length-1];
      if (last && last.date === adviceTodayBJ() && last.tickets && last.tickets.length) { renderAdvice(); return; }
    } catch(e) {}
    advicePollTicket(tries+1);
  }, 30000);
}
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
function closeAdviceDayModal(){
  var box = document.querySelector('.advice-modal-box');
  if (box) { box.parentNode.remove(); document.body.style.overflow=''; }
  if (adviceModalEsc) { document.removeEventListener('keydown', adviceModalEsc); adviceModalEsc = null; }
}
async function renderAdvice() {
  var el = document.getElementById('advice-content');
  if (!el) return;
  try {
    var d = await adviceFetch();
    adviceDaysCache = d.days || [];
    if (!adviceHistBound) {
      adviceHistBound = true;
      document.getElementById('advice-content').addEventListener('click', function(e){
        var btn = e.target.closest && e.target.closest('#advice-dispatch-btn');
        if (btn && !btn.disabled) { adviceDispatch(btn, adviceLatest); return; }
        var tr = e.target.closest && e.target.closest('tr[data-date]');
        if (tr) openAdviceDayModal(tr.getAttribute('data-date'));
      });
    }
    adviceLatest = (d.days||[])[(d.days||[]).length-1];
    var s = d.summary || {}, latest = (d.days||[])[(d.days||[]).length-1];
    var html = '<div class="advice-wrap">' + freshnessHtml(d) +
      '<div class="advice-stats"><span>累计收益率 <b class="'+((s.roi||0)>=0?'pos':'neg')+'">'+advicePct(s.roi)+'</b></span>'+
      '<span>单场命中率 <b>'+advicePct(s.legHitRate)+'</b></span><span>整票命中率 <b>'+advicePct(s.ticketHitRate)+'</b></span>'+
      '<span>连红 <b>'+(s.curWinStreak||0)+'</b></span><span>累计盈亏 <b class="'+((s.returned||0)-(s.staked||0)>=0?'pos':'neg')+'">¥'+adviceRound2((s.returned||0)-(s.staked||0)).toFixed(2)+'</b></span></div>';
    if (latest) {
      html += '<h2 class="advice-h">'+t('adviceToday')+' · '+latest.date+'</h2>';
      html += latest.rest ? '<div class="advice-rest">'+t('adviceRest')+'</div>' : latest.tickets.map(ticketHtml).join('');
      if (!latest.rest) {
        var stake = latest.tickets.reduce(function(a,x){return a+x.stake;},0);
        html += '<div class="advice-budget">'+t('adviceBudget')+' ¥'+stake+' / ¥20</div>';
      }
    }
    var ds = adviceDispatchState(latest);
    var noteTxt = ADVICE_DISPATCH_READY
      ? '补出仅在当日无票时生效；引擎判定休战则不会出票。云端排队 + 出票 + 站点构建共需 5~15 分钟，等得久 ≠ 没生效'
      : '人工补出功能开发中 · 当前由云端 11:30 / 13:30 双窗口与本机 12:45 兜底自动出票';
    html += '<div class="advice-dispatch"><button id="advice-dispatch-btn"'+(ds.ok?'':' disabled')+'>'+ds.label+'</button>'+
      '<span class="advice-dispatch-note" id="advice-dispatch-msg">'+noteTxt+'</span></div>';
    html += '<h2 class="advice-h">'+t('adviceHistory')+'</h2>'+historyHtml(d.days||[])+
      '<h2 class="advice-h">'+t('adviceCurve')+'</h2><div class="advice-curvebox">'+curveSvg(d.days||[])+'</div>'+
      '<div class="advice-disc">系统按五条黄金法则生成模拟票并如实记录 · 不构成投注建议 · 亏¥30停手/赚¥50收手</div></div>';
    el.innerHTML = html;
  } catch(e) {
    el.innerHTML = '<div class="advice-wrap"><span class="advice-badge red">'+t('adviceNoData')+'</span></div>';
  }
}