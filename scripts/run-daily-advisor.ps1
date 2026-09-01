# scripts/run-daily-advisor.ps1 — 每日推荐引擎·本机主通道(备用: 二期 CF Worker+Actions 上线后此任务可停用)
# 每天北京时间 11:30 自动: 拉最新 -> 回收昨日赛果 -> 生成今日票 -> 提交推送
# 全程写日志 logs\daily-advisor.log(追加、带时间戳)，窗口一闪而过也能查现场
# 注册(一次性, 管理员 PowerShell):
#   schtasks /create /tn DailyBettingAdvisor /sc daily /st 11:30 /f ^
#     /tr "powershell -ExecutionPolicy Bypass -File E:\GitHub\WorldCup2026\scripts\run-daily-advisor.ps1"
# 注销: schtasks /delete /tn DailyBettingAdvisor /f
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location E:\GitHub\WorldCup2026
New-Item -ItemType Directory -Force -Path logs | Out-Null
$script:LogFile = Join-Path (Get-Location) 'logs\daily-advisor.log'

function Log([string]$msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -Path $script:LogFile -Value $line -Encoding UTF8
  Write-Host $msg
}

function RunStep([string]$name, [scriptblock]$cmd) {
  $out = (& $cmd 2>&1 | Out-String).Trim()
  $code = $LASTEXITCODE
  if ($out) { Log "$name (exit=$code): $($out -replace "`r?`n", ' | ')" }
  else { Log "$name (exit=$code)" }
  return $code
}

Log '===== 任务启动 ====='
if ((RunStep 'git pull' { git pull --rebase --autostash }) -ne 0) { Log '警告: pull 失败, 以本地仓库继续' }
if ((RunStep 'engine' { node scripts/daily-advisor.js }) -ne 0) { Log '引擎运行失败, 中止不提交'; exit 1 }
if ((RunStep 'git add' { git add data/daily-advice.json }) -ne 0) { Log 'git add 失败, 中止'; exit 1 }
if ((RunStep 'git diff --cached' { git diff --cached --quiet }) -ne 0) {
  if ((RunStep 'git commit' { git commit -m 'chore: 每日投注推荐 [skip ci]' }) -ne 0) { Log 'git commit 失败, 中止'; exit 1 }
  if ((RunStep 'git push' { git push origin main }) -ne 0) { Log 'git push 失败, 明日随 pull 重试'; exit 1 }
  Log '已提交并推送'
} else {
  Log '无已暂存变化, 跳过提交'
}
Log '===== 任务结束 ====='
