# 二期计划：Gitee Go 云端主出票通道 + 本机 12:45 兜底（v2）

> 立项：2026-09-04 ｜ v2 改令：2026-09-07 总司令令**倒置**（原：本机 11:30 主、云影子）
> 状态：M4 执行中——M2/M3 已于 2026-09-07 当日验收（GitHub `14b4de7` 云端主出票首批 + `status` 分支幂等空转审计）
> M4 四步验收（09-08 上午）：云定时首跑落库 / status 当日摘要 / 本机 12:45 静默让路 / Pages 镜像随推重建。
> 已定军规：本机 12:45 任务**永久保留为保险丝**（云正常时预检 5 秒退出，零成本）；令牌走 C 案——GH PAT 维持 30 天，10-05 09:55 已挂持久轮换提醒。
> 前置实证：探针仓库 sporttery-probe 16 轮全链路验证（已按 M1 吊销令牌，待删/归档）

## 一、目标与原则

- **目标**：云端为主，「当日必出票」彻底不依赖本机在线；本机降为兜底，云断则补位。
- **原则（v2 军规）**：
  1. 云 Gitee Go 每日 **11:30**（北京）主出票，commit 标 `[cloud-primary]`；
  2. 本机计划任务 `DailyBettingAdvisor` 改 **12:45**：pull 后预检「当日批次已存在→待命退出」，无批次才顶跑，commit 标 `[local-backstop]`；
  3. **引擎零改动**：幂等键 `matchId|pool` + `day.date`=北京生成日 + 无变化跳过——谁先写入谁得当日档案，另一方自动空转；
  4. 令牌只存私密 shadow 库 yml `variables:`；GitHub PAT 30 天过期，Gitee 令牌季度手动轮换（进过 git 历史即视为泄露面）。

## 二、架构

```
Gitee Go（百度云苏州）yml triggers.schedule cron 30 11 * * *（社区版定时写在 yml，仅一条；「定时运行」表单是企业版功能）
  └─ gao-jiashun/shadow(私密) .workflow/shadow.yml   # variables 含 GH PAT + Gitee 令牌
       └─ shadow.sh（仓库根）:
            1) clone GitHub 公开库 --depth=1（重试×5，治苏州→GitHub 抖动）
            2) node scripts/daily-advisor.js --selftest —— 两模式共用闸门
            3) SHADOW_MODE=issue：无参跑引擎（回收+出票）→ daily-advice.json 有 diff 才
               commit "[cloud-primary]" → pull --rebase → push GitHub main（重试×5）
            4) 无论成败：执行摘要回写本库 status 分支（每日一 md，日志需登录方可看）
本机 12:45：run-daily-advisor.ps1 → 预检 → 无当日批次才顶跑 [local-backstop]
```

- 产物镜像：本仓库 `shadow/shadow.sh` + `shadow/shadow.yml`（占位符模板、无密钥）；**source of truth = Gitee 私密库**。
- 已知代价：Gitee Go 免费档无 SLA，漏跑/延迟时批次漂到 ~12:45 本机补位；极端竞态（云迟写撞本机批次）由 rebase 冲突自动败者退让，不脏数据。
- 免费额度：每日 1 跑约 3-5 分钟，月耗 ~120 分钟 < 500 分钟个人月额。

## 三、里程碑与现状

| 阶段 | 内容 | 通过标准 | 状态 |
|------|------|----------|------|
| M1 | 探针令牌吊销、实验仓库清理 | 双平台令牌列表清空 | ✅ 09-07（probe 库删除与否待确认） |
| M2 | shadow 私密库 + shadow.sh/yml 推送 + 双新令牌注入 | 云端日志 `selftest PASS (31 用例)` + `result=selftest_only` | ✅ 09-07（修两格式坑：`step:` 键名、参数平铺；密钥改 `config.sh` 走仓库，平台会洗 variables 值） |
| M3 | SHADOW_MODE=issue 真首发 | 云端出当日批次+回写 GitHub + 并发轮幂等空转 | ✅ 09-07：#4 落 `14b4de7 [cloud-primary]`（回收 ¥7.72+休战记录）；#6 `result=no_change`+status 分支建档 |
| M4 | 云定时 `triggers.schedule '30 11 * * *'`（社区版走 yml，c69c45e 已配）；连跑一周；**断云演练**：某天停云端→验证本机 12:45 顶替出 `[local-backstop]` | 一周云绿 + 一次成功顶替 | 🔄 09-07 本机兜底首验✅「待命退出」；待明晨 11:30 云定时首跑判定 |
| M5 | 收尾：CLAUDE.md 通道节 + 记忆同步（09-07 已改）、探针库归档、本文档归档 | 总司令验收 | ⬜ 进行中 |

## 四、风险与对策

| 风险 | 对策 |
|------|------|
| 云定时漏跑/延迟（无 SLA） | 本机 12:45 天然兜底；status 分支留每日执行摘要 |
| 苏州→GitHub 抖动 | clone/push 各重试×5；仍失败则摘要落 status 分支、次日本机为当日主力 |
| 双机竞写 daily-advice.json | 错峰 75 分钟 + 先 pull --rebase + 引擎幂等；冲突时云自动落败 |
| 令牌经日志/历史泄露 | 单库最小权限 + 30 天过期 + 季度轮换；泄露窗口攻击面=仅本站仓库文件 |
| Gitee yaml 保存但流水线对象不注册（探针期 issue #IJUFI0） | 兜底：Gitee Go 页「新建流水线→YAML 编辑」指向 .workflow/shadow.yml |
| Gitee Go 日志强制登录 | 未登录浏览器 403，验收日志由总司令本人复制 |

## 五、不做清单（防蔓延）

- 不动 `daily-advisor.js`/前端/数据接口；不复活 WCC/lottery-odds 采集（冻结令不变）；不建 GH 侧新 secret/Action；不再尝试海外反代（CF 出口被 EdgeOne 拦已证伪）。
