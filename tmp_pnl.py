import json, re, sys
from datetime import datetime
sys.stdout.reconfigure(encoding='utf-8')

ESPN_MAP = {'Bosnia-Herzegovina':'Bosnia & Herzegovina','Congo DR':'DR Congo','Czechia':'Czech Republic','Türkiye':'Turkey','United States':'USA'}
def norm(n): return ESPN_MAP.get(n, n)

with open('espn_tmp.json', encoding='utf-8') as f: espn = json.load(f)
with open('data/lottery-odds-merged.json', encoding='utf-8') as f: odds = json.load(f)
with open('js/i18n.js', encoding='utf-8') as f: i18n = f.read()
m = re.search(r'TEAM_ZH\s*=\s*\{([^}]+)\}', i18n, re.DOTALL)
team_pairs = re.findall(r"""['"]([^'"]+)['"]\s*:\s*['"]([^'"]+)['"]""", m.group(1))
zh_to_en = {v:k for k,v in team_pairs}
zh_to_en.update({'库拉索':'Curaçao','佛得角':'Cape Verde','沙特阿拉伯':'Saudi Arabia'})

espn_post = []
for e in espn['events']:
    c = e['competitions'][0]
    if c.get('status',{}).get('type',{}).get('state') != 'post': continue
    comps = c.get('competitors', [])
    home = next((x for x in comps if x.get('homeAway')=='home'), comps[0])
    away = next((x for x in comps if x.get('homeAway')=='away'), comps[1])
    espn_post.append({
        'home': norm(home['team']['displayName']),
        'away': norm(away['team']['displayName']),
        'date': c.get('date','')[:10],
        'score': (int(home.get('score','0')), int(away.get('score','0'))),
    })

def find_match(he, ae, bd):
    base = datetime.strptime(bd, '%Y-%m-%d')
    cands = [m for m in espn_post if (m['home']==he and m['away']==ae) or (m['home']==ae and m['away']==he)]
    best, diff = None, 99
    for c in cands:
        d = abs((datetime.strptime(c['date'],'%Y-%m-%d')-base).days)
        if d < diff: diff=d; best=c
    return best if best and diff<=2 else None

details = []
for m in odds['matches']:
    he = zh_to_en.get(m['homeTeam']); ae = zh_to_en.get(m['awayTeam'])
    if not he or not ae: continue
    f = find_match(he, ae, m['matchDate'])
    if not f: continue
    if f['home']==he: s1,s2 = f['score']
    else: s2,s1 = f['score']
    details.append({'m':m,'s1':s1,'s2':s2})

def get_stage(date_str):
    d = datetime.strptime(date_str, '%Y-%m-%d')
    if d <= datetime(2026,6,29): return '小组赛'
    if d <= datetime(2026,7,3): return 'R32'
    if d <= datetime(2026,7,7): return 'R16'
    if d <= datetime(2026,7,11): return 'QF'
    return 'SF+'
for d in details:
    d['stage'] = get_stage(d['m']['matchDate'])

print(f"分析 {len(details)} 场")
print()

def had_data(m, s1, s2):
    p = m['pools']
    if 'HAD' not in p or not p['HAD'].get('h'): return None
    had = p['HAD']
    mn = min([('h',had['h']),('d',had['d']),('a',had['a'])], key=lambda x:x[1])
    actual = 'h' if s1>s2 else ('a' if s1<s2 else 'd')
    return (mn, actual)

def hhad_data(m, s1, s2):
    p = m['pools']
    if 'HHAD' not in p or not p['HHAD'].get('h'): return None
    hhad = p['HHAD']
    gl = int(hhad.get('goalLine',0))
    mn = min([('h',hhad['h']),('d',hhad['d']),('a',hhad['a'])], key=lambda x:x[1])
    adj = s1-s2-gl
    actual = 'h' if adj>0 else ('a' if adj<0 else 'd')
    return (mn, actual, gl)

def ttg_data(m, s1, s2):
    p = m['pools']
    if 'TTG' not in p or not p['TTG'].get('s0'): return None
    ttg = p['TTG']
    items = [(f's{i}', ttg[f's{i}']) for i in range(8) if ttg.get(f's{i}')]
    mn = min(items, key=lambda x:x[1])
    actual = f"s{min(s1+s2,7)}"
    return (mn, actual)

def section(title):
    print("="*70)
    print(title)
    print("="*70)

def analyze_play(name, get_data, extract_extra=None):
    total_bet = total_ret = 0; hit = total = 0
    odds_list = []; records = []
    for d in details:
        r = get_data(d['m'], d['s1'], d['s2'])
        if r is None: continue
        mn = r[0]; actual = r[1]
        extra = extract_extra(r) if extract_extra else None
        total += 1; total_bet += 2
        won = mn[0] == actual
        ret = 2*mn[1] if won else 0
        if won: hit += 1; total_ret += ret
        odds_list.append(mn[1])
        rec = {'date':d['m']['matchDate'],'stage':d['stage'],'home':d['m']['homeTeam'],'away':d['m']['awayTeam'],'min_odds':mn[1],'won':won,'ret':ret}
        if extra is not None: rec['extra'] = extra
        records.append(rec)
    if total == 0: return None
    net = total_ret - total_bet
    roi = net/total_bet*100
    hr = hit/total*100
    avg = sum(odds_list)/len(odds_list)
    be = 100/hr
    print(f"■ {name} — {total} 场")
    print(f"  投入 ¥{total_bet:.0f}  返还 ¥{total_ret:.2f}  净 {net:+.2f}  ROI {roi:+.1f}%")
    print(f"  命中 {hit}/{total} = {hr:.1f}%   平均最低赔率 {avg:.2f}   保本线 {be:.2f}")
    print(f"  {'→ 盈利：最低赔率 > 保本线' if net>0 else '→ 亏损：命中率不够 或 赔率太低'}")
    print()
    return {'records':records, 'total':total, 'bet':total_bet, 'ret':total_ret, 'net':net, 'roi':roi, 'hr':hr, 'avg':avg}

section("【单玩法策略】每场买该玩法最低赔率选项，¥2/注")
print()
had_r = analyze_play('HAD  胜平负', had_data)
hhad_r = analyze_play('HHAD 让球胜平负', hhad_data, lambda r: r[2])
ttg_r = analyze_play('TTG  总进球', ttg_data)

section("【综合策略】每场 HAD+HHAD+TTG 都买最低赔率 = ¥6/场")
tb = tr = 0; per_game = []
for d in details:
    m = d['m']; s1,s2 = d['s1'],d['s2']; gb = gr = 0; tags = []
    for nm, fn in [('HAD',had_data),('HHAD',hhad_data),('TTG',ttg_data)]:
        r = fn(m, s1, s2)
        if r is None: continue
        mn, act = r[0], r[1]; gb += 2
        if mn[0] == act: gr += 2*mn[1]; tags.append(f'{nm}✓@{mn[1]:.2f}')
        else: tags.append(f'{nm}✗')
    if gb>0:
        tb += gb; tr += gr
        per_game.append((m['matchDate'], m['homeTeam'], m['awayTeam'], d['stage'], gb, gr, gr-gb, ' '.join(tags)))
net = tr-tb
print(f"\n  投入 ¥{tb:.0f}  返还 ¥{tr:.2f}  净 {net:+.2f}  ROI {net/tb*100:+.1f}%")
win = sum(1 for r in per_game if r[6]>0); loss = sum(1 for r in per_game if r[6]<0)
print(f"  单场: {win}盈 / {loss}亏")
print()

def stat_table(title, records, bucket_fn, bucket_order, extra_name=None):
    section(title)
    by = {}
    for rec in records:
        b = bucket_fn(rec)
        by.setdefault(b, []).append(rec)
    header = f"  {'档位':<22}{'场次':>5}{'命中':>6}{'命中率':>9}{'ROI':>9}{'平均赔率':>11}{'保本线':>9}"
    print(header)
    for b in bucket_order:
        recs = by.get(b, [])
        if not recs: continue
        tot = len(recs); h = sum(1 for r in recs if r['won'])
        bet = tot*2; ret = sum(r['ret'] for r in recs)
        net = ret - bet; roi = net/bet*100
        hr = h/tot*100; avg = sum(r['min_odds'] for r in recs)/tot
        be = 100/hr if hr>0 else 99
        print(f"  {b:<22}{tot:>5}{h:>5}{hr:>8.1f}%{roi:>+8.1f}%{avg:>10.2f}{be:>9.2f}")
    print()

if had_r:
    stat_table("【阶段细分】HAD 单买策略 — 按赛事阶段",
        had_r['records'],
        lambda r: r['stage'],
        ['小组赛','R32','R16','QF','SF+'])

if had_r:
    def ob(rec):
        o = rec['min_odds']
        if o <= 1.30: return '≤1.30 绝对热门'
        if o <= 1.60: return '1.30-1.60 中热门'
        if o <= 2.00: return '1.60-2.00 一般热门'
        return '>2.00 均势'
    stat_table("【HAD 赔率档位细分】验证'绝对热门更稳'假设",
        had_r['records'], ob,
        ['≤1.30 绝对热门','1.30-1.60 中热门','1.60-2.00 一般热门','>2.00 均势'])

if hhad_r:
    def glb(gl):
        a = abs(gl)
        if a <= 1: return '±1 弱让球'
        if a <= 2: return '±2 中让球'
        return '±3+ 强让球'
    stat_table("【HHAD 让球数档位细分】验证'让球越大冷门越多'假设",
        hhad_r['records'], lambda r: glb(r['extra']),
        ['±1 弱让球','±2 中让球','±3+ 强让球'])

if had_r:
    by_date = {}
    for rec in had_r['records']:
        by_date.setdefault(rec['date'], []).append(rec)

    section("【串关策略】每天选 HAD 最低赔率 N 场，¥2/注")
    for n in (2, 3, 4):
        total_bet = total_ret = 0; total_bets = 0; hit = 0
        odds_products = []
        for date, recs in sorted(by_date.items()):
            if len(recs) < n: continue
            recs_sorted = sorted(recs, key=lambda r: r['min_odds'])[:n]
            total_bet += 2; total_bets += 1
            if all(r['won'] for r in recs_sorted):
                prod = 1
                for r in recs_sorted: prod *= r['min_odds']
                total_ret += 2 * prod
                hit += 1
                odds_products.append(prod)
        if total_bets == 0:
            print(f"  {n}串1：不足 {n} 场的日子，跳过")
            continue
        net = total_ret - total_bet
        roi = net/total_bet*100
        hr = hit/total_bets*100
        avg_prod = sum(odds_products)/len(odds_products) if odds_products else 0
        print(f"  ■ {n}串1 — {total_bets} 注")
        print(f"    投入 ¥{total_bet:.0f}  返还 ¥{total_ret:.2f}  净 {net:+.2f}  ROI {roi:+.1f}%")
        print(f"    全中 {hit}/{total_bets} = {hr:.1f}%   全中时平均赔率乘积 {avg_prod:.2f}")
    print()

section("【关键洞察】")
print("中国体彩竞彩官方返奖率约 70-73%，即每¥100投注长期返还¥70-73")
print("即'随机投注'长期 ROI ≈ -27% ~ -30%")
print("即使按'最低赔率'策略（最被看好），也未必能跑赢这个抽水")
