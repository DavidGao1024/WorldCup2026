# 二期计划：Gitee Go 云端影子灾备通道（daily-advisor）

> 立项日：2026-09-04 ｜ 状态：待总司令批准
> 前置实证：探针仓库 sporttery-probe 16 轮全链路验证（详见记忆「Gitee Go 流水线要点」）

## 一、目标与原则

- **目标**：本机计划任务（北京 11:30，唯一正式通道）离线时，云端自动顶上出票，保证"当日必出票"。
- **原则（军规不变）**：
  1. 本机 11:30 仍是唯一正式通道，云端只做影子，不改 engine 一行代码；
  2. 云端真写 GitHub 仅发生在"本机当日没出票"时（靠引擎幂等：去重键 `matchId|pool`、无变化跳过写盘、原子写）；
  3. 影子批次 commit 一律带 `[cloud-shadow]` 标记，事后可审计。

## 二、架构

```
Gitee Go（百度云苏州）每日 12:00 cron
  └─ shadow 仓库(私密) 的 .workflow/shadow.yml
       └─ shadow.sh：
            1) git clone --depth=1 https://github.com/DavidGao1024/WorldCup2026.git   # 公开库，读免令牌
            2) cd WorldCup2026 && node scripts/daily-advisor.js                        # 无参=正常出票流，幂等
            3) 若 data/daily-advice.json 有 diff → commit "[cloud-shadow] ..." → push GitHub（重试×5，间隔30s，治抖动）
            4) 无论成败，把执行摘要回写 shadow 仓库 status 分支（探针已实证通道）
```

- 12:00 设计依据：本机 11:30 通常 1 分钟内完赛；错峰 30 分钟彻底避开双跑竞争。
- 引擎零依赖 Node：云镜像 node 14.16 需过 `--selftest` 31 用例验证（M2 首个任务）。
- 令牌：GitHub 细粒度 PAT（仅 WorldCup2026 / Contents 读写 / 短过期），只存在于 shadow 私密库 yml `variables:`，总司令亲手填，会进构建日志 → 到期即轮换。

## 三、里程碑

| 阶段 | 内容 | 通过标准 |
|------|------|----------|
| M1 | 本计划批准；总司令吊销探针令牌 | 已部分完成 |
| M2 | 建 shadow 私密仓库 + shadow.sh + cron（先 `--selftest` 版）；新令牌注入 | 云端 selftest 31/31 绿 |
| M3 | 换真出票命令，手动触发一次（今日本机已出票→应幂等空转、push 不发生） | 日志见"无变化跳过"且 GitHub 无新 commit |
| M4 | 上 cron 12:00，连跑一周；模拟本机离线一次（当天禁用本机任务）验证顶替 | 一周影子全绿 + 一次成功顶替（或明确记录为何未顶） |
| M5 | 收尾：CLAUDE.md「通道」节更新（请示）、记忆同步、文档归档 | 总司令验收 |

## 四、风险与对策

| 风险 | 对策 |
|------|------|
| 苏州→GitHub 抖动（实测同跳 15s 超时与 3s 成功并存） | push 重试×5；最终失败则结果只落 Gitee status 分支，次日晨本机自然补位 |
| Gitee 平台政策/额度变化（社区版随时收紧） | 免费月 500 分钟只耗 ~60；代码零侵入，随时可弃用不伤主链路 |
| 令牌经日志泄露 | 单库最小权限 + 短过期 + 季度轮换纪律；泄露窗口内攻击面=仅能改本站仓库文件（GH Pages 有审校习惯兜底） |
| 双机竞写 daily-advice.json | 错峰 30 分钟 + 云端 push 前 `pull --rebase`；引擎原子写/幂等键双保险 |
| 云端时钟/时区漂移（day.date=北京生成日不变量） | 脚本内部以北京时区算日期，与运行机器无关；M2 selftest 已覆盖 |

## 五、不做清单（防蔓延）

- 不动本机计划任务；不碰 daily-advisor.js；不复活 WCC/lottery-odds 采集（冻结令不变）；不建 GH 侧新 secret/Action。
