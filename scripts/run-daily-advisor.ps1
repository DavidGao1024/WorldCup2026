# scripts/run-daily-advisor.ps1 — 每日推荐引擎·本机主通道(备用: 二期 CF Worker+Actions 上线后此任务可停用)
# 每天北京时间 11:30 自动: 拉数据(本机直连) -> 回收昨日赛果 -> 生成今日票 -> 提交推送
# 注册(一次性, 管理员 PowerShell):
#   schtasks /create /tn DailyBettingAdvisor /sc daily /st 11:30 /f ^
#     /tr "powershell -ExecutionPolicy Bypass -File E:\GitHub\WorldCup2026\scripts\run-daily-advisor.ps1"
# 注销: schtasks /delete /tn DailyBettingAdvisor /f
$ErrorActionPreference = 'Stop'
Set-Location E:\GitHub\WorldCup2026
git pull --rebase --quiet
node scripts/daily-advisor.js
if ($LASTEXITCODE -ne 0) { Write-Host "引擎运行失败, 不提交"; exit 1 }
git add data/daily-advice.json
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  git commit -m "chore: 每日投注推荐 [skip ci]"
  git push origin main
  Write-Host "已提交并推送"
} else {
  Write-Host "数据无变化, 跳过提交"
}
