// js/daily-advice.js — 每日推荐页签(功能版, 视觉待 Figma)
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
function legHtml(l) {
  var res = l.result==='hit' ? '✓ '+(l.score||'') : (l.result==='miss' ? '✗ '+(l.score||'') : (l.result==='void' ? '作废' : '待赛'));
  return '<div class="advice-leg"><span class="advice-leg-lg">'+l.league+'</span>'+
    '<span class="advice-leg-vs">'+l.match+' · '+l.pickLabel+' <em>'+l.kickoff+'</em></span>'+
    '<span class="advice-leg-odds">'+l.odds+'</span><span class="advice-leg-res '+l.result+'">'+res+'</span></div>';
}
var KIND_ZH = { parlay2:'2串1', single:'单关', bonus:'±2彩蛋' };
function ticketHtml(tk) {
  var resTxt = tk.result==='hit' ? '✓ 中' : (tk.result==='miss' ? '✗ 错' : (tk.result==='void' ? '作废退本' : '待赛'));
  return '<div class="advice-ticket '+tk.kind+'"><div class="advice-tk-head"><b>'+(KIND_ZH[tk.kind]||tk.kind)+'</b>'+
    '<span class="advice-tk-rule"> '+tk.rule+'</span>'+
    '<span class="advice-tk-money">投入 ¥'+tk.stake+' · 赔率积 '+tk.combinedOdds+' · 命中返 ¥'+adviceRound2(tk.stake*tk.combinedOdds).toFixed(2)+' → '+resTxt+'</span></div>'+
    tk.legs.map(legHtml).join('')+'</div>';
}
function historyHtml(days) {
  var rows = days.slice().sort(function(a,b){return a.date<b.date?1:-1;}).map(function(d){
    if (d.rest) return '<tr class="rest"><td>'+d.date+'</td><td>—</td><td>休战</td><td>—</td></tr>';
    var stake = d.tickets.reduce(function(a,t){return a+(t.void?0:t.stake);},0);
    var settled = d.tickets.every(function(t){return t.result!=='pending';});
    var ret = d.tickets.reduce(function(a,t){return a+(t.payout||0);},0);
    var net = adviceRound2(ret-stake);
    return '<tr><td>'+d.date+'</td><td>'+d.tickets.length+' 张</td><td>¥'+stake+'</td><td>'+
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
async function renderAdvice() {
  var el = document.getElementById('advice-content');
  if (!el) return;
  try {
    var d = await adviceFetch();
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
    html += '<h2 class="advice-h">'+t('adviceHistory')+'</h2>'+historyHtml(d.days||[])+
      '<h2 class="advice-h">'+t('adviceCurve')+'</h2><div class="advice-curvebox">'+curveSvg(d.days||[])+'</div>'+
      '<div class="advice-disc">系统按五条黄金法则生成模拟票并如实记录 · 不构成投注建议 · 亏¥30停手/赚¥50收手</div></div>';
    el.innerHTML = html;
  } catch(e) {
    el.innerHTML = '<div class="advice-wrap"><span class="advice-badge red">'+t('adviceNoData')+'</span></div>';
  }
}