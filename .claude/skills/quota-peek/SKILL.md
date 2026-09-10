---
name: quota-peek
description: 只读核算本项目三条部署/构建额度线的当月用量：GitHub Pages 构建（软限 10 次/小时）、Cloudflare Pages 构建（500 次/月）、Gitee Go 流水线分钟数（500 分钟/月）。当总司令说 额度查账 / 查额度 / 额度还剩多少 / 构建次数 / 部署了多少次 / Gitee 用了多少分钟 / 会不会超额度 / quota 之类，或担心推送太频繁刷爆流水线时使用——从 git log 和 shadow 库 status 分支现场算账并按军事化格式汇报，绝不写文件、绝不 commit/push。即便没点名"查账"，只要是"想知道部署/构建资源消耗情况"的意图就应触发。
---

# 额度查账（只读 quota peek）

## 这个技能解决什么

本项目每天由 Gitee Go 云端定时（11:30）出票并回写 GitHub，每次 push 会**同时触发两条部署流水线**（GitHub Pages + Cloudflare Pages 镜像），云跑本身还消耗 Gitee Go 构建分钟。三条线各有额度红线，刷爆了会：CF Pages 当月停建（出票数据不上站）、GH Pages 构建排队、Gitee Go 停跑（断云）。总司令需要**随时一句话**就能拿到当月用量账本，而不必登录三个平台后台翻。

账本数据源全是**自家已有的记录**，无需任何平台 token：

| 额度线 | 红线 | 数据源 |
|--------|------|--------|
| GitHub Pages | 软限 **10 构建/小时**（超了排队降速，不封） | `origin/main` 当月提交/推送 |
| Cloudflare Pages | 免费版 **500 构建/月**（超了当月停建） | 同上（跟推即建，1 推 ≈ 1 构建，09-09 已实锤与云提交同秒对齐） |
| Gitee Go | 个人免费档 **500 分钟/月** | Gitee 私密库 `gao-jiashun/shadow` 的 `status` 分支每日执行摘要（自带 start→end 完整时间线） |

## 怎么做（三步，全部只读）

### 第 1 步：GH/CF 构建数 = 当月 origin/main 提交清单

在仓库根（`E:\GitHub\WorldCup2026`）执行（fetch 带 STALL 低速掐断护栏，苏州→GitHub 链路半死时 60 秒自动放弃而不是挂死）：

```bash
git -c http.lowSpeedLimit=1024 -c http.lowSpeedTime=60 fetch origin main
git log origin/main --since=<当月1号，如2026-09-01> --format='%h %ad %s' --date=format:'%m-%d %H:%M'
```

- 提交总数 ≈ GH Pages / CF Pages 当月构建数的**上限**（一次 push 可含多个 commit，构建按 push 算，故实际构建 ≤ 提交数——偏保守，安全侧）。
- 顺手看**单小时峰值**：清单里同一小时内 ≥8 条就要预警 GH Pages 软限（历史上只有旧赔率采集时代每 15 分钟一推才会踩，09-01 冻结后不存在了）。

### 第 2 步：Gitee Go 分钟数 = status 分支当月摘要求和

本机已有 shadow 库克隆（`E:\gitee\shadow`），拉 status 分支后逐日解析：

```bash
cd /e/gitee/shadow && git -c http.lowSpeedLimit=1024 -c http.lowSpeedTime=60 fetch origin status
# 对当月每个日期（01 号到今天）：
git show origin/status:<YYYY-MM-DD>.md
```

每个摘要文件格式固定：首行 `# shadow <日期> mode=<模式> result=<结果>`，正文是带 `YYYY-MM-DD HH:MM:SS` 时间戳的时间线（start → selftest → engine → GitHub 回写）。**当日时长 = 最后一个时间戳 − 第一个时间戳**，全月求和即 Gitee Go 当月分钟数。

可用这段 node 一次性算完（把日期列表换成当月实际范围；无记录的日期输出"无记录"即可，shadow 通道 2026-09-07 才上线，之前日期必然无记录）：

```bash
git show origin/status:<日期>.md | node -e "let s='';process.stdin.on('data',x=>s+=x).on('end',()=>{if(!s.trim()){console.log('无记录');return}const ts=[...s.matchAll(/\d{4}-\d{2}-\d{2} (\d{2}:\d{2}:\d{2})/g)].map(m=>m[1]);const sec=t=>{const[a,b,c]=t.split(':').map(Number);return a*3600+b*60+c};const dur=sec(ts[ts.length-1])-sec(ts[0]);console.log(s.split('\n')[0].replace('# ',''),'|',ts[0]+'→'+ts[ts.length-1],'|',(dur/60).toFixed(1)+'分钟')})"
```

同时记下每日 `result`（pushed / no_change / clone_fail / selftest_only）——**clone_fail 空烧的分钟也计入额度**，这正是要盯的坏账。

### 第 3 步：算占用率并汇报

- CF Pages 占用 = 当月提交数 ÷ 500
- Gitee 占用 = 当月分钟求和 ÷ 500
- GH Pages 看单小时峰值 vs 10

## 汇报格式

用总司令的军事化结构——**先结论、再表格、后口径、末风险**：

```
✅ 额度查账 @ <北京时间>：<一句话结论，如"三线全绿，占用均 <10%">

| 额度线 | 本月已用 | 红线 | 占用 |
|--------|---------|------|------|
| GH Pages | N 次提交（峰值单小时 M 推） | 10/小时（软限） | 🟢/🟡/🔴 |
| CF Pages | ≈N 构建 | 500/月 | x% |
| Gitee Go | T 分钟 | 500/月 | y% |

Gitee 逐日明细：<日期 | result | 时长>（clone_fail 单独点名）

口径（保守偏差，均在安全侧）：
1. status 分支每日一档、后跑覆盖前跑——同日多次跑的分钟数漏记，实际 ≥ 账面
2. 提交数 ≥ 推送数，GH/CF 构建账面是上限
3. shadow 通道 2026-09-07 上线，此前 Gitee 消耗≈0

风险/建议：<如"照当前节奏月底预计 ~x%，无需行动"或预警>
```

占用分级：🟢 <50% ｜ 🟡 50~80%（提示收敛纯文档推送、合并提交）｜ 🔴 >80%（建议当月剩余天数改本机通道为主、云定时暂停，并请示总司令）。

## 安全与边界（务必守住）

- **只读**：全程只有 `git fetch` / `git log` / `git show` / `wc` / node 解析 stdout——**不 pull**（避免动工作区）、不写任何文件、不 commit、不 push、不动计划任务。
- **fetch 是网络操作但无副作用**：只更新远端跟踪引用。必须带 `-c http.lowSpeedLimit=1024 -c http.lowSpeedTime=60` 护栏，防苏州→GitHub/Gitee 半死链路挂死。
- **额度红线数字可能变**：表中红线是 2026-09 立项时查证的官方值（记录于 `projectDoc/plan/2026-09-04-gitee-go-shadow-channel.md` §一）。若总司令质疑数字，建议登录对应控制台看官方用量页，本技能给的是**自家账本推算值**。
- **别和出票混了**：本技能只算资源账，不看当日票出没出（那是哨兵/odds-peek 的事）。

## 失败处理

- `E:\gitee\shadow` 不存在或 fetch 失败：Gitee 线降级为"无法实测"，只报 GH/CF 两线，并提示总司令可登录 Gitee Go 控制台（https://gitee.com/gao-jiashun/shadow → 流水线 → 构建记录）人工补数。**不要**为此去克隆新仓库或改任何配置。
- GitHub fetch 被掐断（STALL 触发）：隔 1~2 分钟重试一次；再失败就改用本地已有的 `origin/main` 引用（`git log origin/main` 不 fetch 也能跑），但在汇报里注明"数据截至上次 fetch，可能滞后"。
- status 分支某日摘要缺失但当日明明有 `[cloud-primary]` 提交：说明云端回写 status 失败（哑巴跑），单独点名提醒——这比额度本身更值得警觉。
