#!/usr/bin/env bash
# 二期云端主通道 · Gitee Go 执行主脚本（计划：projectDoc/plan/2026-09-04-gitee-go-shadow-channel.md·v2 云为主）
# 放置：Gitee 私密 shadow 仓库根目录。密钥/模式读同目录 config.sh（命令行可覆盖：$1 GH_USER $2 GH_PAT $3 GITEE_USER $4 GITEE_TOKEN $5 MODE）
# MODE: selftest=只验云端 node+引擎自检; issue=真出票并条件回写（平时无参数运行）
# 原则（2026-09-07 总司令令）：云 11:30 为主出票；本机 12:45 仅兜底；幂等键保证先写者得当日批次，引擎零改动。

if grep -q "$(printf '\r')" "$0" 2>/dev/null; then
  f="$0.lf"; sed 's/\r$//' "$0" > "$f"; exec bash "$f" "$@"
fi

set -uo pipefail

# 参数优先级：命令行 > 同目录 config.sh（平台会洗掉流水线变量的值，config.sh 走仓库检出，不可被洗）
CFG_DIR="$(cd "$(dirname "$0")" && pwd)"
[ -f "$CFG_DIR/config.sh" ] && . <(sed 's/\r$//' "$CFG_DIR/config.sh")  # autocrlf 检出带 \r，必须剥
GH_USER="${1:-${GH_USER:-}}"; GH_PAT="${2:-${GH_PAT:-}}"
GITEE_USER="${3:-${GITEE_USER:-}}"; GITEE_TOKEN="${4:-${GITEE_TOKEN:-}}"
MODE="${5:-${SHADOW_MODE:-selftest}}"
[ -n "$GH_USER" ] && [ -n "$GH_PAT" ] && [ -n "$GITEE_USER" ] && [ -n "$GITEE_TOKEN" ] || { echo "FATAL: 缺 GH_USER/GH_PAT/GITEE_USER/GITEE_TOKEN(命令行参数或 config.sh)"; exit 2; }

GH_READ="https://github.com/DavidGao1024/WorldCup2026.git"
GH_PUSH="https://${GH_USER}:${GH_PAT}@github.com/DavidGao1024/WorldCup2026.git"
GITEE_PUSH="https://${GITEE_USER}:${GITEE_TOKEN}@gitee.com/${GITEE_OWNER:-$GITEE_USER}/shadow.git"
TODAY="$(TZ=Asia/Shanghai date +%F)"
NOW() { TZ=Asia/Shanghai date '+%F %H:%M:%S'; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
SUMMARY_LOG="$WORK/summary.txt"; : > "$SUMMARY_LOG"
say() { printf '%s %s\n' "$(NOW)" "$*" | tee -a "$SUMMARY_LOG"; }
retry() { local n="$1" i=1; shift; while [ "$i" -le "$n" ]; do if "$@"; then return 0; fi; say "retry ${i}/${n} failed: $*"; sleep 30; i=$((i+1)); done; return 1; }
gitid() { git -C "$1" config user.name wc-cloud-shadow && git -C "$1" config user.email cloud-shadow@users.noreply.github.com; }

say "start mode=$MODE node=$(node -v 2>/dev/null || echo NONE)"

if ! retry 5 git clone --quiet --depth=1 "$GH_READ" "$WORK/wc"; then
  say "FAIL: GitHub clone 5x 均失败（疑网络断）"; RESULT=clone_fail
else
  if ! ( cd "$WORK/wc" && node scripts/daily-advisor.js --selftest >"$WORK/st.log" 2>&1 ); then
    say "FAIL: 云端 node $(node -v) 引擎 selftest 未过: $(tail -1 "$WORK/st.log")"; RESULT=selftest_fail
  else
    say "selftest PASS (31 用例)"
    if [ "$MODE" = "selftest" ]; then
      RESULT=selftest_only
    else
      ( cd "$WORK/wc" && node scripts/daily-advisor.js >"$WORK/engine.log" 2>&1 ); rc=$?
      say "engine exit=${rc}: $(tail -1 "$WORK/engine.log" | tr -d '\r')"
      if [ "$rc" -ne 0 ]; then
        RESULT=engine_fail
      elif git -C "$WORK/wc" diff --quiet -- data/daily-advice.json; then
        RESULT=no_change
        say "幂等空转：当日批次已存在/无增量，不回写 GitHub"
      else
        gitid "$WORK/wc"
        git -C "$WORK/wc" commit -qam "[cloud-primary] ${TODAY} 云端主出票"
        if retry 5 sh -c "git -C '$WORK/wc' pull --rebase --quiet '$GH_PUSH' main && git -C '$WORK/wc' push --quiet '$GH_PUSH' HEAD:main"; then
          RESULT=pushed
          say "GitHub 回写成功"
        else
          git -C "$WORK/wc" rebase --abort 2>/dev/null
          if git -C "$WORK/wc" log --format=%s -1 FETCH_HEAD 2>/dev/null | grep -q "cloud-primary] ${TODAY}"; then
            RESULT=already_online
            say "远端已有今日 [cloud-primary]（并发轮抢先回写），本轮视为成功"
          else
            RESULT=push_fail
            say "GitHub 回写失败（已重试），次日晨本机自然补位"
          fi
        fi
      fi
    fi
  fi
fi

if git ls-remote --exit-code --heads "$GITEE_PUSH" status >/dev/null 2>&1; then
  retry 3 git clone --quiet --depth=1 -b status "$GITEE_PUSH" "$WORK/st"
else
  git init -q -b status "$WORK/st"
  git -C "$WORK/st" remote add origin "$GITEE_PUSH"
fi
if [ -d "$WORK/st/.git" ]; then
  gitid "$WORK/st"
  mkdir -p "$WORK/st"
  { echo "# shadow ${TODAY} mode=${MODE} result=${RESULT}"; cat "$SUMMARY_LOG"; } > "$WORK/st/${TODAY}.md"
  git -C "$WORK/st" add -A
  git -C "$WORK/st" commit -qm "[shadow] ${TODAY} result=${RESULT}" || true
  retry 3 git -C "$WORK/st" push --quiet origin "HEAD:status" \
    && say "摘要已回写 Gitee status 分支" || say "WARN: 摘要回写失败"
else
  say "WARN: status 分支 clone 失败，摘要丢失于: $(cat "$SUMMARY_LOG" | tr '\n' '|')"
fi

say "done result=${RESULT}"
[ "$RESULT" = "pushed" ] || [ "$RESULT" = "already_online" ] || [ "$RESULT" = "selftest_only" ] || [ "$RESULT" = "no_change" ]
