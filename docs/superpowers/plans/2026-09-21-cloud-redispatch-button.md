# 云端补出按钮 + 长期双窗口 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为「每日推荐」页签加一枚口令保护的「补出今日票」按钮（触发云端补跑），并把云端出票从单窗口升级为 11:30 + 13:30 双窗口、压缩失败重试耗时。

**Architecture:** 前端按钮 POST 到新建的 Cloudflare Worker（持 Gitee 令牌与口令），Worker 改写 Gitee 私密库 `shadow` 的 `PROBE.md`；该库 yml 已配 `triggers.trigger: push`，推送即起云端班次，`shadow.sh` 走 issue 模式调引擎（默认幂等补出，当日已有票则 `no_change` 空转），有 diff 才回写 GitHub main。双窗口只是 yml 的 cron 由一条变两条；重试压缩只改 `shadow.sh` 的两处 `retry 5` → `retry 3`。

**Tech Stack:** 纯静态站（vanilla JS，无构建）+ Cloudflare Worker（ES module，单文件粘贴部署）+ CF KV + Gitee OpenAPI v5 + Gitee Go 流水线（bash）。

**规格：** `docs/superpowers/specs/2026-09-21-cloud-redispatch-button-design.md`

> **状态（2026-09-22 更新）**：**阶段 1 已完成**（Task 1 retry 压缩已推送上云并实证生效、Task 2 额度哨兵、Task 3 双窗口 cron 已网页保存生效；Task 4 验收记录待 13:30 首班观察）。
> **阶段 2 暂缓**（09-22 总司令令）：Task 7 Worker 不部署、Task 9 端到端挂起；Task 8 已完成的按钮改由 `ADVICE_DISPATCH_READY = false` 开关托管，点击只显示「敬请期待」且不发请求。Task 6 Worker 源码保留留档。Task 10 收尾随阶段 1 验收一并完成。

---

## 交付分期与硬前置

| 阶段 | 任务 | 前置 |
|---|---|---|
| 阶段 1 | Task 1~4 | 无（改 `shadow.sh` 需先过 Task 5 的令牌 PoC 吗？**不需要**——本机已有 shadow 克隆，推送用既有 remote 凭据） |
| 阶段 2 | Task 5~10 | **Task 5 PoC 必须先过**（Gitee 令牌是否含 `projects` 写权限），不过则阶段 2 停摆 |

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `E:/gitee/shadow/shadow.sh` | 云端执行主脚本（Gitee 私密库，非本仓） | 改两处 retry 次数 |
| `.claude/scheduled_tasks.json` | 定时任务登记（哨兵） | 换装哨兵 prompt，追加月度额度段 |
| `scripts/shadow-trigger-worker.js` | 触发中继 Worker 源码（本仓留档，与线上一致） | 新建 |
| `js/daily-advice.js` | 每日推荐页签渲染 | 加按钮逻辑与轮询 |
| `css/style.css` | 站点样式 | 加按钮样式 |
| `docs/superpowers/specs/2026-09-21-cloud-redispatch-button-design.md` | 规格 | 状态行更新 |
| `projectDoc/plan/2026-09-04-gitee-go-shadow-channel.md` | 云通道计划 + §十 账本 | 新增节 + 补记 |

**不可动**：`scripts/daily-advisor.js`（引擎零改动）、`data/daily-advice.json` 的写入路径、任何数据结构/API 接口。

---

# 阶段 1：双窗口 + 重试压缩 + 额度哨兵

### Task 1: `shadow.sh` 重试压缩（5 → 3）

**Files:**
- Modify: `E:/gitee/shadow/shadow.sh:44`、`E:/gitee/shadow/shadow.sh:64`

**背景（执行前必读）**：`retry()` 每次失败 `sleep 30`（`:37`）；每条 git 命令带 `STALL` 掐速（60 秒低速即 abort，`:39`）。故 `retry 5` 最坏 ≈ 5×60 + 4×30 = 420 秒，`retry 3` ≈ 3×60 + 2×30 = 240 秒，**每处省约 3 分钟**。双窗口上线后 11:30 班的失败由 13:30 班兜住，故允许少重试。

- [ ] **Step 1: 确认工作副本干净**

Run: `git -C /e/gitee/shadow status --short`
Expected: 无输出（若列出 `config.sh` 被改动，先问总司令，勿覆盖）

- [ ] **Step 2: 改 clone 段重试次数**

`E:/gitee/shadow/shadow.sh:44-45` 原文：
```bash
if ! retry 5 git $STALL clone --quiet --depth=1 "$GH_READ" "$WORK/wc"; then
  say "FAIL: GitHub clone 5x 均失败（疑网络断）"; RESULT=clone_fail
```
改为：
```bash
if ! retry 3 git $STALL clone --quiet --depth=1 "$GH_READ" "$WORK/wc"; then
  say "FAIL: GitHub clone 3x 均失败（疑网络断）"; RESULT=clone_fail
```

- [ ] **Step 3: 改回写段重试次数**

`E:/gitee/shadow/shadow.sh:64` 原文：
```bash
        if retry 5 sh -c "git $STALL -C '$WORK/wc' pull --rebase --quiet '$GH_PUSH' main && git $STALL -C '$WORK/wc' push --quiet '$GH_PUSH' HEAD:main"; then
```
改为：
```bash
        if retry 3 sh -c "git $STALL -C '$WORK/wc' pull --rebase --quiet '$GH_PUSH' main && git $STALL -C '$WORK/wc' push --quiet '$GH_PUSH' HEAD:main"; then
```
> `:83`（status 分支 clone）与 `:94`（status 推送）本就是 `retry 3`，**不动**。

- [ ] **Step 4: 语法检查**

Run: `bash -n /e/gitee/shadow/shadow.sh && echo SYNTAX_OK`
Expected: `SYNTAX_OK`

- [ ] **Step 5: 确认改动只在那两行**

Run: `git -C /e/gitee/shadow diff --stat && git -C /e/gitee/shadow diff | grep -E "^[+-].*retry [0-9]"`
Expected: 只出现 `-        if retry 5 sh -c` / `+        if retry 3 sh -c` 与 `-if ! retry 5 git` / `+if ! retry 3 git`

- [ ] **Step 6: 提交并推送（⚠️ 需总司令令；推送即触发一次云端班次）**

**推送前检查**：避开 11:25~11:35 与 13:25~13:35（免与定时班并发）。当日已有票时该班次会 `no_change` 空转，仅耗 2~4 分钟额度。

```bash
git -C /e/gitee/shadow add shadow.sh
git -C /e/gitee/shadow commit -m "chore: 双窗口配套——clone/回写重试 5→3 压缩失败班耗时"
git -C /e/gitee/shadow push origin master
```

- [ ] **Step 7: 验证起班**

Run: `cd /e/gitee/shadow && git fetch origin status && git log origin/status -2 --format="%h %ad %s" --date=format:"%m-%d %H:%M"`
Expected: 出现一条新的 `[shadow] <今日> result=no_change`（当日已有票）

---

### Task 2: 额度哨兵（并入每日哨兵的条件段）

**Files:**
- Modify: `.claude/scheduled_tasks.json`（哨兵 `f8d21bd3` 的 `prompt` 字段）

**做法**：哨兵每日 13:07 触发，本任务给它追加一段**条件执行**的额度核算（仅北京 1 号与 16 号生效），避免新建一套会 7 天过期的 recurring 任务链。

- [ ] **Step 1: 取当前哨兵原文**

Run:
```bash
node -e "const j=require('./.claude/scheduled_tasks.json');const t=(j.tasks||j).find(x=>String(x.prompt||'').includes('每日出票全账本哨兵'));process.stdout.write(t.prompt)"
```
Expected: 输出 v3.1 全文（约 3.5KB，含「一、基线账本」「二、每日步骤」「三、备注」）

- [ ] **Step 2: 在「二、每日步骤」末尾追加第 8 条（原文其余部分一字不改）**

追加段落全文（插在 `7) 若当日已超过 10-15…` **之后**、`三、备注` **之前**——即「二、每日步骤」列表末尾；其余原文一字不改）：
```
8) 【额度核算·仅北京 1 号与 16 号执行】若非 1 号/16 号则跳过本条、汇报不加额度段。核账口径（只读，不动任何文件）：
   a) GH/CF Pages：`git fetch origin main` 后 **全量遍历 + 日期过滤**：`git log origin/main --format='%ad|%h' --date=short | awk -F'|' '$1>="<当月1号>"' | wc -l` = 当月提交数（≈CF 构建数，红线 500/月）；单小时峰值同法把 `--date=short` 换成 `--date=format:'%m-%d %H'`，再 `cut -d'|' -f1 | sort | uniq -c | sort -rn | head -3`（红线 10/小时，软限）。**禁用 `--since=`**——本仓含 Actions 提交与分支 merge，`--since` 的遍历裁剪会漏计（09-21 实测同命令先后得 47 与 51 两种结果，全量+awk 稳定为 54，跑 3 次一致）；
   b) Gitee Go：`git -C E:/gitee/shadow fetch origin status` 后对当月每日 `git show origin/status:<日期>.md` 取首末时间戳算时长求和（红线 500 分钟/月）；**必须同时回溯 status 分支 git 历史逐 commit**（`git log origin/status --format='%ad|%H' --date=short | awk -F'|' '$1>="<当月1号>"'`。status 分支为线性历史，`--since` 亦可用，但为统一口径一律用全量+awk），因当日 md 只留最后一班、后跑覆盖前跑；
   c) 汇报末尾追加一段「额度」：三线已用/红线/占用率与分级（🟢<50% ｜ 🟡50~80% ｜ 🔴>80%）；🔴 时附一句「请令回退单窗口」——**只报不改**，改云端 cron 只能总司令在 Gitee 网页编辑器保存。
```

- [ ] **Step 3: 换装（删除旧哨兵 + 按新原文重建）**

用 `CronDelete` 注销 `f8d21bd3`，再用 `CronCreate` 重建：`cron = 7 13 * * *`、`recurring = true`、`durable = true`、prompt = Step 2 的全文。

- [ ] **Step 4: 验证登记正确**

Run:
```bash
node -e "const j=require('./.claude/scheduled_tasks.json');const t=(j.tasks||j).find(x=>String(x.prompt||'').includes('每日出票全账本哨兵'));console.log('cron:',t.cron,'| recurring:',t.recurring,'| 含额度段:',/额度核算/.test(t.prompt),'| 长度:',t.prompt.length)"
```
Expected: `cron: 7 13 * * * | recurring: true | 含额度段: true | 长度:` 比换装前多约 550 字符

- [ ] **Step 5: 人工预演额度口径（今日不是 1/16 号，只验口径可用）**

Run: `git log origin/main --since=2026-09-01 --oneline | wc -l`
Expected: 数字（09-21 实测 51）——证明 a) 口径可直接执行

> **待验（不得假称已验）**：条件分支的真实触发要等 **10-01** 北京日哨兵 13:07 班次。

---

### Task 3: 云端双窗口 cron（总司令网页操作）

**Files:** Gitee 网页配置（无仓库文件改动）

- [ ] **Step 1: 打开编辑器**

直达：https://gitee.com/gao-jiashun/shadow → 流水线 → YAML 编辑

- [ ] **Step 2: 只改一行**

`triggers.schedule` 段原文：
```yaml
  schedule:
    - cron: '0 30 11 * * ?'
```
改为：
```yaml
  schedule:
    - cron: '0 30 11,13 * * ?'
```

- [ ] **Step 3: 保存并确认**

点保存。**坑纪律**：若报 `cronExpressionError` → 说明转换失败且挂起全部触发 → **把内容清空再保存一次即复活**；保存后必须确认**无报错弹窗**（弹出报错但内容看起来一样 = 假绿）。
注：git push **不会**重新注册定时（09-08 实锤），只能网页保存。

- [ ] **Step 4: 当日/次日验证**

Run: `cd /e/gitee/shadow && git fetch origin status && git log origin/status -3 --format="%h %ad %s" --date=format:"%m-%d %H:%M"`
Expected: 出现一条 13:3x 的新 `[shadow] ... result=no_change`

- [ ] **Step 5: 回滚预案（若注册失败或想退回）**

网页编辑器改回 `- cron: '0 30 11 * * ?'` 保存，或「空内容再保存」复活。期间本机 12:45 兜底不断粮。

---

### Task 4: 阶段 1 验收记录

**Files:**
- Modify: `projectDoc/plan/2026-09-04-gitee-go-shadow-channel.md`（§九 状态 ⬜ → ✅；新增观察段）

- [ ] **Step 1: 采集三证**

```bash
cd /e/gitee/shadow && git fetch origin status
git log origin/status -4 --format="%h %ad %s" --date=format:"%m-%d %H:%M"
git show origin/status:$(TZ=Asia/Shanghai date +%F).md | head -8
```
Expected: 当日状摘要出现两班记录（11:30 与 13:30），均为 `no_change` 或 `pushed`

- [ ] **Step 2: 把双窗口与压缩结果写入 §九**

在 §九「实施步骤」下新增一段 `**09-21 实施记录（B 案落地）**`，写明：cron 现值、retry 压缩前后（5→3）、观察到的 13:30 班 result、额度消耗实测。

- [ ] **Step 3: 提交（需总司令令）**

```bash
git add projectDoc/plan/2026-09-04-gitee-go-shadow-channel.md
git commit -m "docs: B案双窗口落地入册(11:30+13:30)+shadow.sh重试5→3压缩"
```

---

# 阶段 2：Cloudflare Worker + 前端补出按钮

### Task 5: PoC — Gitee 令牌写权限（**硬前置，不过则停摆**）

**Files:** 无（只读验证 + 一次 PROBE.md 写入）

- [ ] **Step 1: 载入令牌并确认存在（只打长度与前 2 字符）**

```bash
set -a; . /e/gitee/shadow/config.sh; set +a
echo "GITEE_USER=$GITEE_USER | token_len=${#GITEE_TOKEN} | token_head=${GITEE_TOKEN:0:2}"
```
Expected: `GITEE_USER=gao-jiashun | token_len=<>0 的数 | token_head=<2 字符>`
⚠️ **绝不打印令牌全文**（09-11 泄露教训）

- [ ] **Step 2: 读 PROBE.md 取 sha**

```bash
curl -s -H "Authorization: token $GITEE_TOKEN" -H "User-Agent: wc-poc" \
  "https://gitee.com/api/v5/repos/gao-jiashun/shadow/contents/PROBE.md" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('sha=',j.sha,'| size=',j.size,'| msg=',JSON.stringify(j.message));})"
```
Expected: `sha=<40 位> | size=<数字> | msg=undefined`
若返回 `{"message":"..."}` 且无 sha → 令牌无读权限或路径错，**停下报总司令**

- [ ] **Step 3: 写入新内容（⚠️ 会触发一次云端班次 + 改动 PROBE.md）**

```bash
SHA=$(curl -s -H "Authorization: token $GITEE_TOKEN" -H "User-Agent: wc-poc" \
  "https://gitee.com/api/v5/repos/gao-jiashun/shadow/contents/PROBE.md" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).sha))")
BODY=$(printf '{"content":"%s","sha":"%s","message":"chore: poc dispatch"}' \
  "$(printf 'trigger probe %s poc' "$(TZ=Asia/Shanghai date +%H%M)" | base64 -w0)" "$SHA")
curl -s -X PUT -H "Authorization: token $GITEE_TOKEN" -H "User-Agent: wc-poc" \
  -H "Content-Type: application/json" -d "$BODY" \
  "https://gitee.com/api/v5/repos/gao-jiashun/shadow/contents/PROBE.md" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('commit=',j.commit&&j.commit.sha,'| msg=',JSON.stringify(j.message));})"
```
Expected: `commit=<40 位 sha> | msg=undefined` → **PoC 通过**
失败（`msg` 有值，如 403/权限不足）→ **阶段 2 全部暂停**，报总司令：需在 https://gitee.com/profile/personal_access_tokens 新建含 `projects` 权限的令牌，替换 `config.sh` 与该 Worker。

- [ ] **Step 4: 验证 push 触发确实起班**

```bash
sleep 90; cd /e/gitee/shadow && git fetch origin status
git log origin/status -2 --format="%h %ad %s" --date=format:"%m-%d %H:%M"
```
Expected: 新出现一条 `[shadow] <今日> result=...`（当日已有票 → `no_change`）

- [ ] **Step 5: 记录 PoC 结论**

把 sha、触发起班时间、result 记入规格 §8 验证清单第 2 条。

---

### Task 6: Worker 源码

**Files:**
- Create: `scripts/shadow-trigger-worker.js`

- [ ] **Step 1: 写文件（全文）**

```js
/**
 * Cloudflare Worker — 云端补出触发中继（「每日推荐」页签「补出今日票」按钮的后端）
 *
 * 作用：前端持口令 → Worker 校验并限次 → 改写 Gitee 私密库 shadow 的 PROBE.md
 *       → 该库 yml `triggers.trigger: push` 起班 → shadow.sh issue 模式幂等补出。
 * 部署：CF dash → Workers & Pages → Create Worker → 粘贴本文件 → Save and Deploy
 * 环境变量（Settings → Variables，全部按 Secret 存）：
 *   DISPATCH_PASS  补出口令（必填）
 *   GITEE_TOKEN    Gitee 令牌，需 projects 权限（与 config.sh 同一枚；轮换须两处同改）
 *   GITEE_OWNER    默认 gao-jiashun
 *   GITEE_REPO     默认 shadow
 * KV 绑定：DISPATCH_KV（Storage → KV → 新建命名空间 → 绑定变量名 DISPATCH_KV）
 *
 * 路由：
 *   GET  /           健康检查 → {ok, service, day, used, limit}
 *   POST /dispatch   body {pass} → 触发补出
 *
 * 红线：本文件不含任何明文密钥；令牌/口令只在 Worker 环境变量里。
 */

const PROBE_PATH = 'PROBE.md';
const DAILY_LIMIT = 3;          // 每日触发上限（北京日）
const FAIL_COOLDOWN_SEC = 60;   // 口令错后的冷却

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Cache-Control': 'no-store',
    },
  });
}

function bjDay() {
  return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
}
function bjHHMM() {
  return new Date(Date.now() + 8 * 3600e3).toISOString().slice(11, 16).replace(':', '');
}
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function b64(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}

async function gitee(env, path, init) {
  const owner = env.GITEE_OWNER || 'gao-jiashun';
  const repo = env.GITEE_REPO || 'shadow';
  return fetch(`https://gitee.com/api/v5/repos/${owner}/${repo}/${path}`, {
    ...init,
    headers: {
      'Authorization': `token ${env.GITEE_TOKEN}`,
      'User-Agent': 'wc-shadow-trigger',
      'Content-Type': 'application/json',
      ...((init && init.headers) || {}),
    },
  });
}

async function dispatchUpstream(env) {
  const got = await gitee(env, `contents/${PROBE_PATH}`);
  if (!got.ok) return { ok: false, status: got.status, step: 'get' };
  const cur = await got.json();
  if (!cur || !cur.sha) return { ok: false, status: 502, step: 'sha' };
  const put = await gitee(env, `contents/${PROBE_PATH}`, {
    method: 'PUT',
    body: JSON.stringify({
      content: b64(`trigger probe ${bjHHMM()} manual`),
      sha: cur.sha,
      message: `chore: manual dispatch ${bjDay()} ${bjHHMM()}`,
    }),
  });
  return { ok: put.ok, status: put.status, step: 'put' };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return json({ ok: true });

    const day = bjDay();

    if (url.pathname === '/' && request.method === 'GET') {
      const used = Number((await env.DISPATCH_KV.get(`d:${day}`)) || 0);
      return json({ ok: true, service: 'shadow-trigger', day, used, limit: DAILY_LIMIT });
    }
    if (url.pathname !== '/dispatch' || request.method !== 'POST') {
      return json({ error: 'not found' }, 404);
    }

    let pass = '';
    try {
      pass = String((await request.json()).pass || '');
    } catch (e) {
      pass = '';
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (await env.DISPATCH_KV.get(`f:${ip}`)) {
      return json({ error: '尝试过于频繁，请 60 秒后再试' }, 429);
    }
    if (!env.DISPATCH_PASS || !safeEqual(pass, env.DISPATCH_PASS)) {
      await env.DISPATCH_KV.put(`f:${ip}`, '1', { expirationTtl: FAIL_COOLDOWN_SEC });
      return json({ error: '口令不正确' }, 401);
    }

    const used = Number((await env.DISPATCH_KV.get(`d:${day}`)) || 0);
    if (used >= DAILY_LIMIT) {
      return json({ error: `今日触发次数已用尽（上限 ${DAILY_LIMIT} 次）`, day, used }, 429);
    }

    const r = await dispatchUpstream(env);
    if (!r.ok) {
      return json({ error: `云端触发失败（Gitee API ${r.status}）`, step: r.step }, 502);
    }

    await env.DISPATCH_KV.put(`d:${day}`, String(used + 1), { expirationTtl: 172800 });
    return json({ ok: true, day, used: used + 1, limit: DAILY_LIMIT, acceptedAt: new Date().toISOString() });
  },
};
```

- [ ] **Step 2: 语法检查（ES module 需临时 .mjs）**

```bash
cp scripts/shadow-trigger-worker.js /tmp/w.mjs && node --check /tmp/w.mjs && echo SYNTAX_OK && rm -f /tmp/w.mjs
```
Expected: `SYNTAX_OK`

- [ ] **Step 3: 确认无明文密钥**

```bash
grep -nE "ghp_|github_pat_|glpat-|token *= *['\"]" scripts/shadow-trigger-worker.js || echo "NO_SECRET_OK"
```
Expected: `NO_SECRET_OK`

- [ ] **Step 4: 提交（需总司令令）**

```bash
git add scripts/shadow-trigger-worker.js
git commit -m "feat: 补出触发中继 Worker 源码(口令+KV限次+Gitee contents 写入)"
```

---

### Task 7: Worker 部署与绑定（总司令 CF 后台操作）

**Files:** 无（线上配置）

- [ ] **Step 1: 建 Worker**

dash.cloudflare.com → Workers & Pages → Create → Worker → 命名 `shadow-trigger` → 编辑器内清空默认代码 → 粘贴 Task 6 全文 → Save and Deploy
记录 URL：`https://shadow-trigger.<你的子域>.workers.dev`

- [ ] **Step 2: 配环境变量（全部按 Secret）**

Settings → Variables and Secrets → 新增：
| 名称 | 值 |
|---|---|
| `DISPATCH_PASS` | 你定的口令（建议 12 位以上随机） |
| `GITEE_TOKEN` | 与 `config.sh` 同一枚 Gitee 令牌 |
| `GITEE_OWNER` | `gao-jiashun` |
| `GITEE_REPO` | `shadow` |

- [ ] **Step 3: 建 KV 并绑定**

Storage & Databases → KV → Create namespace `DISPATCH_KV` → 回到 Worker → Settings → Bindings → 添加 KV Namespace，变量名 **`DISPATCH_KV`** → 保存

- [ ] **Step 4: 验证健康检查**

```bash
curl -s "https://shadow-trigger.<你的子域>.workers.dev/"
```
Expected: `{"ok":true,"service":"shadow-trigger","day":"2026-09-21","used":0,"limit":3}`

- [ ] **Step 5: 验证口令错**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Content-Type: application/json" \
  -d '{"pass":"wrong-pass"}' "https://shadow-trigger.<你的子域>.workers.dev/dispatch"
```
Expected: `401`

- [ ] **Step 6: 验证对口令触发（⚠️ 真触发一次云端班次）**

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"pass":"<你的口令>"}' "https://shadow-trigger.<你的子域>.workers.dev/dispatch"
```
Expected: `{"ok":true,"day":"...","used":1,...}`

- [ ] **Step 7: 验证限次**

连发 3 次同一口令（间隔 >60 秒，避开冷却）后第 4 次：
Expected: `{"error":"今日触发次数已用尽（上限 3 次）",...}` 且 HTTP `429`
> 测完记得用 `GET /` 看 `used`，并在次日自然归零时确认计数按北京日重置

---

### Task 8: 前端补出按钮

**Files:**
- Modify: `js/daily-advice.js`（新增函数 + 改 `renderAdvice` 的绑定与渲染）
- Modify: `css/style.css`（追加 `.advice-dispatch` 样式）
- Modify: `index.html`：**无需改动**（`js/daily-advice.js` 已在 `:105` 加载）

- [ ] **Step 1: 在 `js/daily-advice.js` 顶部配置区加常量**

在 `:1` 的注释行之后插入：
```js
// 补出按钮：部署 Task 7 的 Worker 后回填 URL
var ADVICE_WORKER = 'https://shadow-trigger.REPLACE_ME.workers.dev';
var ADVICE_PASS_KEY = 'advice_dispatch_pass';
```

- [ ] **Step 2: 加按钮判定与触发函数（插在 `:64` 的 `adviceDaysCache` 声明之后）**

```js
function adviceTodayBJ(){ return new Date(Date.now()+8*3600e3).toISOString().slice(0,10); }
function adviceDispatchState(latest){
  if (!latest || latest.date !== adviceTodayBJ()) return { ok:true, label:'今日暂无批次 · 补出' };
  if (latest.rest) return { ok:true, label:'引擎判定休战 · 仍要补出' };
  if (latest.tickets && latest.tickets.length) return { ok:false, label:'今日已出 '+latest.tickets.length+' 张' };
  return { ok:true, label:'今日暂无票 · 补出' };
}
async function adviceDispatch(btn, latest){
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
  if (tries > 40) {                  // 30 秒 × 40 = 20 分钟窗口（Task 5 PoC 实测：起班排队可慢至 9 分钟）
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
```

- [ ] **Step 3: 改 `renderAdvice` 的委托绑定（`:102-108`）**

原文：
```js
    if (!adviceHistBound) {
      adviceHistBound = true;
      document.getElementById('advice-content').addEventListener('click', function(e){
        var tr = e.target.closest && e.target.closest('tr[data-date]');
        if (tr) openAdviceDayModal(tr.getAttribute('data-date'));
      });
    }
```
改为：
```js
    if (!adviceHistBound) {
      adviceHistBound = true;
      document.getElementById('advice-content').addEventListener('click', function(e){
        var btn = e.target.closest && e.target.closest('#advice-dispatch-btn');
        if (btn && !btn.disabled) { adviceDispatch(btn, adviceLatest); return; }
        var tr = e.target.closest && e.target.closest('tr[data-date]');
        if (tr) openAdviceDayModal(tr.getAttribute('data-date'));
      });
    }
```
并在 `:109` 那行（`var s = d.summary || {}, latest = ...`）之前加一行缓存：
```js
    adviceLatest = (d.days||[])[(d.days||[]).length-1];
```
同时在 `:64` 的 `var adviceDaysCache = [], adviceHistBound = false, adviceModalEsc = null;` 末尾追加 `, adviceLatest = null`。

- [ ] **Step 4: 渲染按钮（在 `:121` 的 `latest` 块收尾处追加）**

在 `html += '<div class="advice-budget">'...` 之后（该 if 块内）插入：
```js
      var ds = adviceDispatchState(latest);
      html += '<div class="advice-dispatch"><button id="advice-dispatch-btn"'+(ds.ok?'':' disabled')+'>'+ds.label+'</button>'+
        '<span class="advice-dispatch-note" id="advice-dispatch-msg">补出仅在当日无票时生效；引擎判定休战则不会出票。云端排队 + 出票 + 站点构建共需 5~15 分钟，等得久 ≠ 没生效</span></div>';
```
> 注意：需同时覆盖「无当日批次」分支——把该行**移到 `if (latest) {...}` 块之后**（不放在 `if (!latest.rest)` 里），确保休战日/无批次日也能显示。

- [ ] **Step 5: 追加样式（`css/style.css` 末尾）**

```css
.advice-dispatch{display:flex;align-items:center;gap:.6rem;margin:.6rem 0 1rem}
.advice-dispatch button{background:#1f3d1f;color:#ffd700;border:1px solid #3a5a3a;border-radius:6px;padding:.4rem .9rem;font-size:.85rem;cursor:pointer}
.advice-dispatch button:hover:not(:disabled){background:#2a4f2a}
.advice-dispatch button:disabled{opacity:.5;cursor:default;color:#9aa79a}
.advice-dispatch-note{color:#6b7d6b;font-size:.75rem}
```

- [ ] **Step 6: 本地起服务验证三态**

Run: `npx serve . -p 3000`
打开 `http://localhost:3000` → 每日推荐页签：
Expected（09-21 实际数据 = 休战日）：按钮显示「引擎判定休战 · 仍要补出」，可点
再手工构造「有票」态验证禁用：把 `data/daily-advice.json` 的 09-21 块临时改成 `{"date":"2026-09-21","generatedAt":"...","rest":false,"tickets":[{...}]}` → 刷新 → 按钮应变「今日已出 1 张」且灰色 → **验完还原**（用 `git checkout -- data/daily-advice.json`）

- [ ] **Step 7: 回填 Worker URL 并确认按钮能走到「已受理」**

把 `:2` 的 `ADVICE_WORKER` 改成 Task 7 的真实 URL → 刷新 → 点击 → 输口令 → 应转「已受理 · 云端处理中」（网络面板应见 `POST /dispatch` 200）

- [ ] **Step 8: 提交（需总司令令）**

```bash
git add js/daily-advice.js css/style.css
git commit -m "feat: 每日推荐页签补出按钮(口令触发云端补跑+轮询回看)"
```

---

### Task 9: 端到端验收

- [ ] **Step 1: 验幂等路径（今日可验）**

点按钮触发 → 等 3~5 分钟 → 查：
```bash
cd /e/gitee/shadow && git fetch origin status && git log origin/status -2 --format="%h %ad %s" --date=format:"%m-%d %H:%M"
```
Expected: 新班次 `result=no_change`（当日已有休战批次），GitHub main **无新提交**（账本未被动）

- [ ] **Step 2: 验「云端未动账本」**

```bash
git fetch origin main && git log origin/main -1 --format="%h %s"
```
Expected: 仍是最近一次正常提交（无 `[cloud-primary] 2026-09-21` 新增），证明幂等不污染账本

- [ ] **Step 3: 登记真正未验项**

在规格 §8「待自然场景验」逐条标注状态。**真出票路径**（当日无票 → 补出生效）必须等自然缺票日，验前不得写成已验。

- [ ] **Step 4: 验额度入账**

按 Task 2 的额度口径核算一次，确认新触发的班次时长已计入当月总和。

---

### Task 10: 文档收尾

**Files:**
- Modify: `docs/superpowers/specs/2026-09-21-cloud-redispatch-button-design.md`（状态行改「已实施」+ §8 勾选实况）
- Modify: `projectDoc/plan/2026-09-04-gitee-go-shadow-channel.md`（§十 补记 09-22 起的通道变化；§九 标记 B 案落地）

- [ ] **Step 1: 更新规格状态行与验证清单实况**

- [ ] **Step 2: §十 账本补记当日通道与结果（哨兵口径不变）**

- [ ] **Step 3: 提交（需总司令令）**

```bash
git add docs/superpowers/specs/2026-09-21-cloud-redispatch-button-design.md projectDoc/plan/2026-09-04-gitee-go-shadow-channel.md
git commit -m "docs: 补出按钮与双窗口实施入册+规格状态更新"
```

---

## 完成标准（Definition of Done）

- [ ] 云端每日两班（11:30 / 13:30），status 分支可见两班记录
- [ ] `shadow.sh` 重试为 3，失败班时长较 15~17 分明显下降
- [ ] 哨兵 prompt 含额度段，10-01 自然触发一次并在汇报中给出三线占用
- [ ] 页面按钮三态正确；口令错 401、超限 429、成功 200
- [ ] 触发后账本不被幂等路径污染
- [ ] 引擎 `scripts/daily-advisor.js` 零改动、数据结构未变
- [ ] 未验项（真出票路径、轮询实际延迟）在规格中如实标注为「待自然场景验」