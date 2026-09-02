# 源码隐藏部署（私有仓 + 前端隔离发布）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 GitHub Free 套餐下，让"源码（含投注引擎 `scripts/`、策略 `docs/`、档案 `CLAUDE.md`、CI `.github/`、`logs/`）不再对公网可读"，同时保住一个可公开访问的世界杯站点。

**Architecture:** 两道闸缺一不可——(1) **GitHub 仓库转私有**：挡住 `github.com` 上的源码，但**管不到已部署站点**；(2) **Cloudflare Pages 只发布前端白名单**：把部署产物从"整个仓库根"改为 `dist/`（由构建脚本按 allow-list 生成），`scripts/`、`docs/`、`CLAUDE.md` 等一律不进 `dist/`，公网 404。因 Free + 私有会失去 GitHub Pages 公开镜像，最终只剩 Cloudflare 单一公开入口，故建议**绑自有域名**替代 `*.pages.dev` 兜底大陆可达性。

**Tech Stack:** 纯静态站（vanilla HTML/CSS/JS，零构建）；Cloudflare Pages（Git 连接、构建命令 + 输出目录）；GitHub Free；Git Bash（本机）/ Ubuntu+Node（CF 构建环境）。

---

## 背景与实测依据（2026-09-02）

Cloudflare 把仓库根整体当静态站发布，以下路径**当前全部 200、公网可下载**（浏览器 `fetch` 实测）：

| 路径 | 状态 | 说明 |
|---|---|---|
| `/scripts/daily-advisor.js` | 200 (23KB) | 投注引擎算法（核心 IP） |
| `/scripts/predict.js` | 200 (11KB) | 赛前预测脚本 |
| `/scripts/predict-final.js` | 200 (11KB) | 小组末轮预测 |
| `/scripts/fetch-odds.js` | 200 (10KB) | 体彩抓取脚本 |
| `/CLAUDE.md` | 200 (14KB) | 项目档案/内部说明 |
| `/docs/lottery-strategy.md` | 200 (4KB) | 五条黄金法则策略 |
| `/.github/workflows/fetch-injuries.yml` | 200 | CI 配置 |

`index.html` 仅引用 `css/ js/ data/ img/ favicon.jpg` 与外部 https，**无根级散资产引用**（已 grep 确认），故前端白名单可确定为：`index.html favicon.jpg css/ js/ data/ img/`（`.nojekyll` 可选）。

**关键认知**：前端 `js/*.js` 因要在浏览器执行，天生公开、view-source 可读，**藏不了**；本计划只保护**非前端**文件（引擎/策略/档案/CI/日志）。若目标是藏"预测算法本身"，那部分逻辑在 `js/analysis.js` 前端里，静态站无法既公开运行又对浏览器保密。

---

## 执行分工

| 类别 | 由谁做 |
|---|---|
| 本地文件/脚本/git 操作、验证命令 | 营长（Claude）在获授权后代跑，或总司令本地执行 |
| Cloudflare 控制台改构建设置/删部署/清缓存/绑域名 | **总司令手动**（营长无 CF 登录） |
| GitHub 改仓库可见性 | **总司令手动**（Danger Zone 操作） |

**⚠️ 破坏性/外不可逆动作**（force-push 清史、改可见性、删部署历史）执行前逐条向总司令确认。

---

## File Structure

- Create: `scripts/cf-build.sh` — Cloudflare Pages 打包脚本（allow-list 生成 `dist/`；本身在 `scripts/` 下，**不进** dist）
- Create: `docs/superpowers/plans/2026-09-02-source-hiding-deploy.md` — 本计划
- External（非仓库文件，控制台操作）: Cloudflare Pages Build settings / Deployments / Cache / Custom domains；GitHub repo visibility
- Modify（可选，Task 6）: `index.html` 的 `og:url` / canonical 指向新公开域
- Modify（Task 7）: `CLAUDE.md` "GitHub Pages" 章节；`memory/project_cloudflare_deploy.md`

---

## Task 1: 转私前密钥与敏感内容审计（先定是否需清史）

> 若仓库任何时刻公开且曾提交过凭据，即视为**已泄露**，必须轮换 + 清 git 历史，与本计划"藏源码"是两回事。此任务只做**判定**，清史在 Task 1b。
> **E-SafeNet 注意**：本机 bash 直接 `cat/rg` 受保护文件可能见乱码；审计一律走 **git 通道**（`git grep`/`git log` 读到明文）。

**Files:** 无（只读审计）

- [ ] **Step 1: 扫工作区（git 索引视角）**

```bash
git -C E:/GitHub/WorldCup2026 grep -nI -e 'ghp_' -e 'github_pat_' -e 'gho_' -e 'ghs_' \
  -e 'AKIA[0-9A-Z]{16}' -e 'BEGIN .*PRIVATE KEY' -e '-----BEGIN' \
  -e '(?i)(api[_-]?key|secret|token|passwd|password|access[_-]?key)' HEAD
```
Expected: 仅命中无害词（如 `token` 作为普通英文词、`secrets.XXX` 的 Actions 变量引用），**无真实凭据值**。

- [ ] **Step 2: 扫全部历史提交**

```bash
git -C E:/GitHub/WorldCup2026 log --all -p \
  | grep -nEi 'ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY'
```
Expected: **无输出**（干净）。

- [ ] **Step 3: 核查工作流是否硬编码凭据**

```bash
git -C E:/GitHub/WorldCup2026 grep -nEi 'password|secret|token|key' HEAD -- .github/workflows/
```
Expected: 只出现 `${{ secrets.* }}` 之类的**引用**，无明文值。

- [ ] **Step 4: 判定并记录**

- 全干净 → 结论"**无需清史**"，直接进 Task 2。
- 命中真实凭据 → 进 **Task 1b**（轮换 + 清史），且**先请示**（含 force-push）。

---

## Task 1b（条件执行）: 轮换 + 清理 git 历史

> 仅在 Task 1 命中真实凭据时做。**破坏性、需总司令明确批准**。

- [ ] **Step 1:** 立即在对应服务侧**轮换/吊销**泄露的凭据（GitHub PAT、云厂商 AK/SK、SSH key 等）。清史不能撤销"已被人拉取"的事实，轮换才是止血。
- [ ] **Step 2:** 清史（择一，先本地验证再推）

```bash
# 推荐 git-filter-repo（若无：pip install git-filter-repo）
git -C E:/GitHub/WorldCup2026 filter-repo --invert-paths --path <泄露文件路径>
```
- [ ] **Step 3:** 强推覆盖远端历史（**⚠️ 破坏性，逐条确认**）

```bash
git -C E:/GitHub/WorldCup2026 push --all --force && git -C E:/GitHub/WorldCup2026 push --tags --force
```
- [ ] **Step 4:** 在 GitHub → Settings → 详情页 触发/等待 Git LFS 与缓存对象清除；确认 `github.com/.../commits` 里旧凭据 blob 不再可访问。

---

## Task 2: 新增 `scripts/cf-build.sh` 前端白名单打包脚本

**Files:**
- Create: `scripts/cf-build.sh`
- Test: 本地运行脚本 + `serve dist` + 断言 dist 无敏感目录

- [ ] **Step 1: 写打包脚本**

创建 `scripts/cf-build.sh`：

```bash
#!/usr/bin/env bash
#
# scripts/cf-build.sh
# Cloudflare Pages 打包：只把「前端可部署资产」按白名单拷进 dist/，
# 仓库其余一切（CLAUDE.md / docs / scripts / .github / logs / 测试图 / 临时件）
# 一律不进 dist，因而不会被静态站发到公网。默认拒绝。
#
# Cloudflare Pages 设置：
#   Build command  = bash scripts/cf-build.sh
#   Build output   = /dist
#
set -euo pipefail

# 允许部署的前端白名单（相对仓库根）
ALLOW_FILES=(index.html favicon.jpg)
ALLOW_DIRS=(css js data img)

rm -rf dist
mkdir -p dist

for f in "${ALLOW_FILES[@]}"; do cp "$f" dist/; done
for d in "${ALLOW_DIRS[@]}"; do [ -d "$d" ] && cp -r "$d" dist/; done

# .nojekyll 仅 GH Pages 需要，CF 无关；有则带上无害
[ -f .nojekyll ] && cp .nojekyll dist/ || true

echo "[cf-build] dist/ 内容："
ls -A dist
```

- [ ] **Step 2: 本地运行脚本**

Run（在仓库根）:
```bash
cd E:/GitHub/WorldCup2026 && bash scripts/cf-build.sh
```
Expected: 末行打印 `dist/` 内容，含 `index.html favicon.jpg css js data img`（及 `.nojekyll`）。

- [ ] **Step 3: 断言敏感文件未进 dist**

```bash
cd E:/GitHub/WorldCup2026 && \
for bad in CLAUDE.md docs scripts .github logs README.md predictions; do \
  test ! -e "dist/$bad" && echo "PASS(排除) $bad" || echo "FAIL(泄漏) $bad"; done
```
Expected: 七行全 `PASS(排除)`，无 `FAIL`。

- [ ] **Step 4: 本地起站验证功能不缺失**

```bash
npx serve dist -p 3100
```
浏览器开 `http://localhost:3100`，走一遍默认页签与各页签；DevTools Network **无同源 404**。
Expected: 站点正常渲染。
> 若某前端资源 404（说明它不在白名单）：把对应**根级文件或目录**补进 `ALLOW_FILES`/`ALLOW_DIRS`，重跑 Step 2–4。（`index.html` 已确认无根级散引用，预期一次通过。）

- [ ] **Step 5: 提交**

```bash
cd E:/GitHub/WorldCup2026 && git add scripts/cf-build.sh && \
git commit -m "build: 新增 scripts/cf-build.sh，Cloudflare Pages 前端白名单打包（默认拒绝）"
```
> 注：`dist/` 属产物，确保已被 `.gitignore` 忽略（见 Task 2 附）。提交前 `git status` 应无 `dist/`。

- [ ] **Step 6（附）: 忽略 dist**

若 `.gitignore` 尚无 `dist/`：追加一行 `dist/`，随 Step 5 一并提交。

---

## Task 3: Cloudflare Pages 切换为「构建命令 + 输出 /dist」

> **总司令在 CF 控制台手动**。营长可用浏览器（若已登录）协助点选或核对，但改配置由总司令确认。

- [ ] **Step 1: 改构建设置**

Cloudflare Dashboard → **Workers & Pages → worldcup2026-12d → Settings → Builds & deployments**：
- Build command: `bash scripts/cf-build.sh`
- Build output directory: `/dist`
- Root directory: `/`（仓库根，脚本按此相对路径找 index/css/js/data/img）
- Framework preset: `None`
保存。

- [ ] **Step 2: 推送触发一次生产构建**

任选：`git push`（Task 2 提交后推 main）或控制台 **Deployments → 最新项 → ⋯ → Retry build**。
- [ ] **Step 3: 确认构建成功**

Deployments 里最新一条 `Success`；日志出现 `[cf-build] dist/ 内容：`。
Expected: 构建无 `cp: cannot stat` 之类报错。

- [ ] **Step 4: 验证生产 URL 敏感文件已 404、站点正常**

营长用浏览器对 `https://worldcup2026-12d.pages.dev` 执行同源探测（或总司令 curl）：
```bash
for p in / /data/worldcup.json /js/daily-advice.js /scripts/daily-advisor.js /CLAUDE.md /docs/lottery-strategy.md; do \
  printf '%s -> ' "$p"; curl -s -o /dev/null -w '%{http_code}\n' "https://worldcup2026-12d.pages.dev$p"; done
```
Expected:
```
/ -> 200
/data/worldcup.json -> 200
/js/daily-advice.js -> 200
/scripts/daily-advisor.js -> 404
/CLAUDE.md -> 404
/docs/lottery-strategy.md -> 404
```
> CF 缓存可能滞后：若敏感项仍 200，等 1–2 分钟或见 Task 4 清缓存后复测。

---

## Task 4: 清理历史部署快照与边缘缓存

> Cloudflare Pages 每个历史部署有独立 URL（`<hash>.worldcup2026-12d.pages.dev`），旧部署里仍含被发布的 `scripts/` 等。**光换构建不删历史 = 漏点仍在。**

- [ ] **Step 1（总司令 CF 控制台）: 删除含敏感文件的旧部署**

Pages 项目 → **Deployments** 列表 → 逐个 ⋯ → **Delete**（尤其 Task 3 之前的所有生产/预览部署）。
> 生产别名 `worldcup2026-12d.pages.dev` 现指向新 dist，本身安全；要清的是**历史 hash 子域 URL**。

- [ ] **Step 2: 验证旧快照不再可取**

```bash
# 任一旧 hash 子域（从 Deployments 里复制一个历史 URL）
curl -s -o /dev/null -w '%{http_code}\n' "https://<旧hash>.worldcup2026-12d.pages.dev/scripts/daily-advisor.js"
```
Expected: `404` 或该子域整体不可达（已删除）。

- [ ] **Step 3（如已绑自有域名）: 清边缘缓存**

CF → 该 Zone/项目 → **Caching → Purge Everything**。对 pages.dev 生产别名亦可在 Pages 设置里 purge。

---

## Task 5: GitHub 仓库转私有 + 联动验证

> **总司令在 GitHub 手动**（Danger Zone）。转私有后 **Free 套餐的 GitHub Pages 会停服**（这是既定取舍：只留 Cloudflare 单公开入口）。

- [ ] **Step 1: 转私有**

`github.com/DavidGao1024/WorldCup2026` → **Settings → General → Danger Zone → Change repository visibility → Make private** → 输入确认。

- [ ] **Step 2: 确认 GitHub Pages 停服（预期行为）**

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://davidgao1024.github.io/WorldCup2026/
```
Expected: `404`。若仍 200（缓存），进 Settings → Pages 关闭/等待失效。
> 这意味着原"双跑镜像"在 Free+私有下**不再成立**，退化为 Cloudflare 单入口。

- [ ] **Step 3: 验证 Cloudflare 仍能读私有仓构建**

CF Pages → Deployments → **Retry build**（最新提交）。
Expected: `Success`（Cloudflare 的 GitHub App 对私有仓保留读权限）。
若报权限失败：GitHub → **Settings → Applications → GitHub Apps → Cloudflare Workers/Pages → Configure → Repository access**，把该私有仓纳入（或 "All repositories"），再 Retry。

- [ ] **Step 4: 验证 Actions 仍跑（私有仓 Free 有 2000 分/月，够用）**

GitHub → Actions → `fetch-injuries` → **Run workflow** 手动触发。
Expected: 绿；生成的提交出现在私有仓。

- [ ] **Step 5: 验证本机采集通道不受影响**

本机 `DailyBettingAdvisor` 计划任务走 SSH，私有仓同一 key 即可，无需改配置。可手动跑一次 `bash` 或等次日：
```bash
cd E:/GitHub/WorldCup2026 && git pull --rebase --autostash
```
Expected: 成功（SSH 私仓正常）。

---

## Task 6（推荐·可后置）: 绑自有域名 + 站点 URL 指向更新

> 私有化后只剩 `*.pages.dev` 一个公开入口，而它大陆常 DNS 污染/不稳。绑自有域名规避 pages.dev 专项封锁。
> **诚实预期**：无 ICP 时 Cloudflare 仍走海外 PoP，自有域**不保证**大陆稳定，只是比 pages.dev 更可控、可品牌化。要真稳需 ICP + 国内备案线路（超出本计划）。

- [ ] **Step 1（总司令 CF 控制台）: 加自定义域**

Pages 项目 → **Custom domains → Set up a custom domain** → 填 `wc.<你的域>` → CF 建 DNS 记录 + Universal SSL 自动签发 → 状态 `Active`。

- [ ] **Step 2: 验证自有域发布的是 dist（同样无敏感文件）**

```bash
for p in / /scripts/daily-advisor.js /CLAUDE.md; do \
  printf '%s -> ' "$p"; curl -s -o /dev/null -w '%{http_code}\n' "https://wc.<你的域>$p"; done
```
Expected: `/ -> 200`，敏感项 `404`。

- [ ] **Step 3: 更新 `index.html` 对外 URL（改动仓库内容，需总司令批）**

`index.html:16` 的 `og:url`（及任何 canonical）从 `https://davidgao1024.github.io/WorldCup2026/` 改为 `https://wc.<你的域>/`。
提交：
```bash
cd E:/GitHub/WorldCup2026 && git add index.html && \
git commit -m "fix: og:url 指向 Cloudflare 自有域（GH Pages 退役）"
```

---

## Task 7: 文档与记忆同步

- [ ] **Step 1:** 更新 `CLAUDE.md` "GitHub Pages" 章节：改为"私有仓 + Cloudflare Pages 单公开入口（`scripts/cf-build.sh` 白名单发布前端，GH Pages 已退役），自有域 `<wc.xxx>`"。
- [ ] **Step 2:** 更新记忆 `memory/project_cloudflare_deploy.md`：反映新拓扑（源码私有、CF 仅发前端 dist、GH Pages 停、双跑不再成立）；改状态需总司令确认（记忆写入属持久化）。
- [ ] **Step 3:** 提交文档（需总司令说"提交"）。

---

## 回滚预案

| 出问题 | 回滚 |
|---|---|
| CF 改 dist 后站点白屏/缺资源 | 控制台把 Build command 清空、Output 改回 `/`，Retry build → 恢复"整仓发布"（**但敏感文件重新公网可读，仅应急，尽快回到本计划**） |
| 想撤销私有化 | GitHub → Danger Zone → Change visibility → **Make public**（可逆，不丢提交）；之后 GH Pages 恢复，但需重跑并确认 dist 方案 |
| 清史 force-push 出错 | 依赖 Task 1b 前的本地镜像/`git stash`；绝不在未确认镜像时强推 |

## Self-Review

- **Spec 覆盖**：目标=Free 下藏源码 + 保住公开站。→ 闸一 Task 5；闸二 Task 2/3；漏点收尾 Task 4；可达性兜底 Task 6；既有 IP 泄露风险 Task 1/1b。齐。
- **占位符扫描**：白名单、脚本、命令、期望状态码均具体；`<旧hash>`、`wc.<你的域>` 为**需总司令提供的真实值**（属输入参数，非计划占位），已在步骤内标注来源。
- **一致性**：输出目录全程 `/dist`、脚本路径全程 `scripts/cf-build.sh`、公开 host 在各 Task 内统一。一致。

## Open Questions（执行前需总司令给）

1. 是否已有可绑的**自有域名**？（决定 Task 6 走不走，还是先只用 pages.dev）
2. Task 1 若查出历史凭据泄露——授权轮换 + `filter-repo` + 强推吗？
3. 确认接受"私有化 ⇒ Free 下 GitHub Pages 退役、双跑退化单入口"这一取舍？
