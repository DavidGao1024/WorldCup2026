# 每日投注推荐系统 · 设计文档（v1）

> **2026-09-01 修订（总司令令）**：§回收 中"开球 7 天未回收自动作废退本"机制**废止**。长期未回收场保持 pending 不计统计，改由 `--settle` 人工判定；前端显示"待判定"。详见 `docs/superpowers/plans/2026-09-01-settlement-amendment-and-history-modal.md` Part A。同日实况更新：本机计划任务已注册并实跑通过；二期云端反代证伪（CF 出口同被 EdgeOne 拦截），`fetch-odds.yml` 定时已停用、赔率数据冻结。

> 日期：2026-08-31｜状态：**已批准，v1 已实施并上线（提交 cae94eb）**——本机计划任务为主通道（schtasks 注册待执行）；二期 CF Worker+GitHub Actions 未启动；§10「停用 fetch-odds 定时」仍待批
> 前置阅读：`docs/lottery-pnl.md`（数据依据）、`docs/lottery-strategy.md`（规则来源）

## 1. 目标

每天自动完成「回收昨日赛果 → 判定票面命中 → 累计命中率统计 → 生成今日推荐票」，
结果沉淀为静态 JSON，由网站新增「每日推荐」页签（第一位、默认打开）展示。
全程 GitHub Actions 自动运行，本机计划任务作备用通道。人工仅参与：看推荐、去出票。

## 2. 非目标（v1 明确不做）

- EV 价值注 / 10 维模型分析（模型仅覆盖世界杯 48 队，联赛无数据）——数据结构预留 `rule` 字段供二期扩展
- 各国杯赛场次（冷门率高，v1 白名单只含五大联赛 + 欧冠欧联）
- 实时跟单变盘（每天只在固定时刻出票一次）
- 自动下单（出票仍由人到体彩门店完成）

## 3. 架构与数据流

```
GitHub Actions (cron: 03:30 UTC = 北京 11:30，每日一次)
  │
  ├─ ① 回收：体彩赛果接口(覆盖全部 pending 腿所在销售日) → 回填 data/daily-advice.json
  ├─ ② 判定：逐腿 hit/miss → 逐票 result/payout → 重算 summary 累计统计
  ├─ ③ 出票：在售赔率接口 → 白名单过滤 → 黄金区间规则引擎 → 追加当日 day
  └─ ④ 提交：文件有 diff 才 commit（"[skip ci] 每日投注推荐"）→ push
        │
        ▼
  data/daily-advice.json（git 跟踪，前端唯一数据源）
        │
        ▼
  前端「每日推荐」页签（js/daily-advice.js 渲染）
```

抓取通道（两条，脚本同一份代码）：

| 通道 | 前提 | 适用 |
|---|---|---|
| 主：GitHub Actions + CF Worker 反代 | 部署 Worker（代码随附）+ 配置仓库 secret `ODDS_PROXY_URL` | 全自动 |
| 备：本机 Windows 计划任务 11:30 | 本机直连体彩已验证通畅；git push 走 SSH | Worker 挂掉时兜底 |

**现状说明**：现有 `fetch-odds.yml`（15 分钟/次）因 secret 从未配置、直连被 WAF 拦截而连续失败。
本次部署 Worker 后该 workflow 顺带恢复；但其 WCC 过滤在世界杯后已无场次，建议将它的 cron 注释停用（保留文件备大赛复用），此项待总司令批准。

## 4. 数据格式：`data/daily-advice.json`

```json
{
  "updateTime": "2026-08-31T03:30:00Z",
  "summary": {
    "days": 30, "tickets": 45, "legsHit": 61, "legsTotal": 78,
    "legHitRate": 0.782, "ticketsHit": 22, "ticketHitRate": 0.489,
    "staked": 90, "returned": 103.4, "roi": 0.149, "curWinStreak": 2
  },
  "days": [
    {
      "date": "2026-09-01",
      "generatedAt": "2026-08-31T03:30:00Z",
      "rest": false,
      "tickets": [
        {
          "id": "20260901-T1",
          "kind": "parlay2",
          "rule": "黄金区间2串1(1.40×1.55)",
          "stake": 4,
          "combinedOdds": 2.17,
          "legs": [
            {
              "matchNumStr": "周一004", "league": "瑞超",
              "match": "佐加顿斯 vs 米亚尔比",
              "kickoff": "2026-09-01 01:00",
              "pool": "HAD", "pick": "h", "pickLabel": "主胜",
              "odds": 1.40, "score": null, "result": "pending"
            }
          ],
          "result": "pending", "payout": null, "void": false
        }
      ]
    }
  ]
}
```

约定：

- `kind`：`single` 单关｜`parlay2` 2串1｜`bonus` ±2 彩蛋（本质也是 parlay2 的 HHAD 版）
- `pick`：`h`/`d`/`a`；`pool`：`HAD`/`HHAD`
- `result`：`pending` → `hit` / `miss`；比赛取消或判 void 的票记 `void=true`，本金按退回计（不计入命中率分母）
- 判定口径 = **体彩官方开奖结果（90 分钟固定奖金口径）**，与真实兑奖一致，不用 ESPN 换算
- `rest: true` 的休战日 `tickets` 为空，也入档（统计"空仓日"表现）
- `summary.curWinStreak` = 连红天数（当日至少 1 张票 hit 记"红日"；休战日不打断连红也不计入；出现全 miss 日则归零）
- 数组按日追加，只进不退；同日重复生成仅在手动 dispatch 时发生，**覆盖当天 day，历史日永不改写**
- `day.date` = **批次生成日（北京日历日）**，即 Action 运行当天（2026-08-31 实现修正：原设计用销售日/UTC 日混用致幂等失效）；腿的实际开球北京时间在 `legs[].kickoff`，票的 `date`/`id` 前缀仍按开球日

## 5. 规则引擎判定表（`scripts/daily-advisor.js` 唯一出票逻辑）

| # | 规则 | 阈值 | 动作 |
|---|---|---|---|
| 1 | 白名单 | 英超/西甲/意甲/德甲/法甲/欧冠/欧联（按 `leagueAbbName` 前缀匹配） | 名单外全部忽略 |
| 2 | 可买窗口 | 开球时间 ≥ 运行时刻 + 3h 且 `matchStatus=Selling` | 不满足不出票 |
| 3 | 黄金候选 | HAD 三向最低赔率 ∈ [1.30, 1.60] | 候选池；[1.30,1.35) 标记**边缘**：只允许单关 ¥2×1，不参与成串 |
| 4 | 串关配对 | 非边缘候选 ≥2 | 按「赔率距 1.47」升序相邻配对，最多 2 张 parlay2，每张 ¥2×2 倍（¥4） |
| 5 | 单关 | 候选中 `bettingSingle=1` 且未进串 | 非边缘 ¥2×2 倍（¥4）；边缘 ¥2×1（¥2） |
| 6 | 必串候选 | `bettingSingle=0` 落单无法成串 | 放弃该候选 |
| 7 | ±2 彩蛋 | 未开 HAD、仅开 HHAD 且 \|goalLine\|=2；让球方赔率 ∈ [1.6, 2.6] | 满足者 ≥2 场时取赔率距 2.1 最近的两场成串，¥2×1 一张；不足两场不出 |
| 8 | 日预算 | 所有票 stake 合计 ≤ ¥20 | 按「赔率距 1.47」升序保留，超限的票整张弃 |
| 9 | 休战 | 候选数 = 0 | 当日 `rest: true` |
| 10 | 去重 | 出票前比对**其他日期**的全部 legs（手动覆盖当日重出票时，当日旧票不参与去重） | 已出过票的对阵+玩法不重复出（防跨日重复：如开球在次日 15:00 的场次两日运行均满足 3h 窗口） |

出票顺序 4 → 5 → 7。每票 `rule` 字段自动写入依据文案（二期 EV 引擎可替换此字段）。

## 6. 赛果回收（✅ 2026-08-31 已实测验证）

- **端点**：`https://webapi.sporttery.cn/gateway/uniform/football/getUniformMatchResultV1.qry?matchBeginDate=YYYY-MM-DD&matchEndDate=YYYY-MM-DD&leagueId=&pageSize=30&pageNo=1&isFix=0&matchPage=1&pcOrWap=1`
  （注意：不是旧文档流传的 `getMatchResultV1.qry`，后者 403。Node 直连实测 HTTP 200）
- **关键字段**（`value.matchResult[]`，分页 `value.pages`）：
  - `matchNumStr` + `matchDate`（开球日）= 匹配键；引擎生成票时同时存 `matchId` 作双保险
  - `sectionsNo999` 最终比分 "4:0"｜`sectionsNo1` 半场比分｜`winFlag` H/D/A（**HAD 官方判定**，90 分钟口径）
  - `poolStatus`："Payout"=已结算；空串 + `winFlag=""` = 该场未开 HAD（如皇马让2案例），此时用 `goalLine`+比分推算 HHAD 判定：`(主-客)+goalLine` >0→h，=0→d，<0→a
- 查询范围 = 现存全部 pending 腿的最早 `matchDate` 至 当日（覆盖断更多日场景）
- 找不到结果的 pending 腿（延期/未出）保持 `pending`，次日再收；超 7 天自动 `void`

## 7. 前端「每日推荐」页签

**视觉层级（总司令已定调）：「今日出票」为唯一视觉主角**——核心 2串1 票以大幅票根样式置顶（金色描边+大赔率数字+票型缎带），单关/彩蛋票双列次之；新鲜度徽章紧贴其上方；统计条/历史表/资金曲线一律降为次要区域。最终样式以总司令 Figma 稿为准，本系统只锁定信息层级与字段。


- `index.html`：新增第一个 tab 按钮 + `#tab-advice` 容器（默认 `active`，`init()` 首屏切到 advice；原 schedule 仍保留入口）
- **文案口径（总司令定调）**：一切面向用户的中文文案不用行话和英文缩写——"腿"→"场"；ROI→"收益率"；ODDS→"赔率"；Engine→"引擎"；不出现 [1.30,1.35) 这类区间符号，写"接近下限"等白话；JSON 内部字段保留英文（`legs`/`roi`）不改
- `js/daily-advice.js`（加载顺序排在 app.js 前，仅依赖 i18n.js 与 fetch）：
  - **数据新鲜度指示（页签最顶部，一眼可辨）**：徽章常显「最后更新：北京 M-D HH:MM」，颜色按距今时长判定（用时效而非"是否今天"，避免每日 0 点至 11:30 之间误报）：
    - ≤ 26h → 绿色（正常节奏）
    - 26–48h → 琥珀「⚠ 昨日引擎未成功」
    - > 48h → 红色「⚠ 断更超 2 天，检查 Actions / 启用备用通道」
    - 数据文件缺失/fetch 失败 → 红色「无数据」
  - 顶部统计条：累计 ROI、单腿命中率、票命中率、连红数
  - 今日票卡：逐腿（联赛/对阵/开球/选项/赔率）+ 投入 + 预计返还 + 规则依据；休战日显示「今日休战」（休战也是当日新数据，绿色徽章照常亮）
  - 历史表：按日倒序，票级 命中✓/未中✗/void，比分回填
  - 收益曲线：内联 SVG 折线（累计盈亏），零依赖
  - i18n：`i18n.js` 增加中英文案键
- 降级：任何数据异常均只影响本页签显示（走上述红色「无数据」态），不影响其他页签

## 8. 错误处理

| 故障 | 行为 |
|---|---|
| 赔率/赛果接口超时或 403 | Action 该步 exit 1，数据文件保持上一次成功状态；前端新鲜度徽章变琥珀/红（§7） |
| 赛果缺字段 | 降级比分判定；再缺则保持 pending |
| 当日无在售白名单场次 | 正常出「休战」日 |
| Worker 长期挂 | 备用本机计划任务通道顶上（注册命令见交付物 `run-daily-advisor` 脚本内注释） |

## 9. 测试与验收

1. 引擎 `--selftest`：内置 3 组 fixture（黄金+必串混合日、全边缘日、零候选休战日）断言出票结果与金额
2. 赛果判定 `--selftest`：fixture 覆盖 hit/miss/void/加时杯赛（90 分钟口径）
3. 本地 `npx serve .` + 浏览器实测：今日票渲染、休战态、历史表、空数据降级 4 种状态
4. 部署演练：手动 workflow_dispatch 跑一次真实生成（用当天 11:30 后数据），核对 JSON 与页面
5. 次日自动跑：验证回收判定真实生效

## 10. 交付物清单（v1 状态）

- ✅ `scripts/daily-advisor.js`（引擎+回收+自测 26 用例，零依赖；含 --regen/--force 守卫、原子写、无变化不写盘）
- ⬜ `.github/workflows/daily-advice.yml`（二期，随 CF Worker 一起做）
- ⬜ `workers/odds-proxy.js` + 部署指引（二期）
- ✅ `data/daily-advice.json`（已有真实首跑批次 2026-08-31：2 张票待赛）
- ✅ `js/daily-advice.js` + `index.html`/`app.js`/`i18n.js`/`style.css`（页签第一位默认，浏览器四态实测过）
- ✅ 本机主通道 `run-daily-advisor.ps1`（schtasks 注册命令在脚本头注释，**注册动作待总司令执行**）
- ⬜ 停用 `fetch-odds.yml` cron——仍待批准

## 11. 风险与免责

- 五条法则源自世界杯 53 场样本，迁移到联赛属**样本外应用**，命中率曲线将如实展示验证结果（这正是系统的核心价值）
- 固定奖金随时间浮动，推荐票与实际出票赔率可能有差，按出票时刻记账
- 本系统仅统计模拟票，不构成投注建议；止损纪律（单日亏 ¥30 停手）需人工执行
