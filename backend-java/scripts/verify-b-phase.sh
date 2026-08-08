#!/usr/bin/env bash
#
# B + C 阶段集成验证脚本：启动 Java 后端（连现网库），逐接口 curl 并断言响应结构。
#   B 阶段：搜索 / K 线（DB）/ 行情 / 微信登录（手动）
#   C 阶段：概念板块 / 板块 K 线 / 分钟线 / 个股新闻 / 新闻 feed / 巨潮公告
#
# 用法：
#   export DB_HOST=... DB_PORT=5432 DB_NAME=gu_yu_stock DB_USER=... DB_PASSWORD=... \
#          JWT_SECRET=... WECHAT_APP_ID=... WECHAT_APP_SECRET=...
#   bash scripts/verify-b-phase.sh
#
# 前置：mvn 可用；本机可访问现网库与新浪/同花顺/巨潮（外网）。
# 注意：login/profile 依赖真实微信 code，无法自动验证，脚本末尾给出手动步骤。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-18487}"
BASE="http://localhost:${PORT}"

REQUIRED_VARS=(DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD JWT_SECRET WECHAT_APP_ID WECHAT_APP_SECRET)
for v in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!v:-}" ]; then
    echo "缺少环境变量: $v（从部署环境/Go 版 config.yaml 获取）" >&2
    exit 1
  fi
done

echo "==> 启动后端 (profile=dev, port=${PORT}) ..."
cd "$ROOT"
mvn -q spring-boot:run -Dspring-boot.run.profiles=dev &
PID=$!
trap 'kill "$PID" 2>/dev/null || true' EXIT

echo "==> 等待 /api/health 就绪 ..."
READY=0
for i in $(seq 1 90); do
  if curl -fsS "$BASE/api/health" >/dev/null 2>&1; then
    echo "    就绪 (${i}s)"
    READY=1
    break
  fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then
  echo "后端启动超时（90s）" >&2
  exit 1
fi

FAILED=0
check() {
  local desc="$1" url="$2" expect="$3"
  local body
  body="$(curl -sS "$url")" || { echo "✗ $desc: 请求失败"; FAILED=1; return; }
  if echo "$body" | grep -q "$expect"; then
    echo "✓ $desc"
  else
    echo "✗ $desc: 期望包含 [$expect]，实际: $body" >&2
    FAILED=1
  fi
}

echo "==> 接口验证 =="
check "health"              "$BASE/api/health"                              '"status":"ok"'
check "health db"           "$BASE/api/health"                              '"database":"connected"'
check "search 结构"          "$BASE/api/v1/stock/search?q=茅台&limit=5"        '"code":200'
check "search keyword"      "$BASE/api/v1/stock/search?q=茅台&limit=5"        '"keyword":"茅台"'
check "search stocks"       "$BASE/api/v1/stock/search?q=茅台&limit=5"        '"stocks"'
check "search is_active"    "$BASE/api/v1/stock/search?q=茅台&limit=5"        '"is_active"'
check "klines 结构"          "$BASE/api/v1/stock/600519/klines?scale=240&count=3" '"code":200'
check "klines klines"       "$BASE/api/v1/stock/600519/klines?scale=240&count=3" '"klines"'
check "klines 升序字段"       "$BASE/api/v1/stock/600519/klines?scale=240&count=3" '"time"'
check "quote 结构"           "$BASE/api/v1/stock/600519/quote"               '"code":200'
check "quote 字段"           "$BASE/api/v1/stock/600519/quote"               '"prev_close"'
check "quotes 结构"          "$BASE/api/v1/stock/quotes?codes=600519,000001" '"code":200'
check "quotes 字段"          "$BASE/api/v1/stock/quotes?codes=600519,000001" '"pct_change"'
check "缺参返回 400"         "$BASE/api/v1/stock/600519/klines?count=3"       '"code":400'

echo ""
echo "==> C 阶段接口验证 =="
check "boards 结构"          "$BASE/api/v1/sector/boards?top=5"              '"code":200'
check "boards plate_code"    "$BASE/api/v1/sector/boards?top=5"              '"plate_code"'
check "boards plate_name"    "$BASE/api/v1/sector/boards?top=5"              '"plate_name"'
check "board klines 结构"    "$BASE/api/v1/sector/board/885333/klines?count=5" '"code":200'
check "board klines klines"  "$BASE/api/v1/sector/board/885333/klines?count=5" '"klines"'
check "分钟线 结构"           "$BASE/api/v1/stock/600519/klines?scale=60&count=5" '"code":200'
check "分钟线 scale=60"      "$BASE/api/v1/stock/600519/klines?scale=60&count=5" '"scale":"60"'
check "分钟线 klines"        "$BASE/api/v1/stock/600519/klines?scale=60&count=5" '"klines"'
check "个股新闻 结构"         "$BASE/api/v1/stock/600519/news"                 '"code":200'
check "个股新闻 news"         "$BASE/api/v1/stock/600519/news"                 '"news"'
check "新闻 feed 结构"        "$BASE/api/v1/news/feed?q=A股&count=3"           '"code":200'
check "新闻 feed news"        "$BASE/api/v1/news/feed?q=A股&count=3"           '"news"'
check "公告 结构"             "$BASE/api/v1/stock/600519/announcements"        '"code":200'
check "公告 items"            "$BASE/api/v1/stock/600519/announcements"        '"items"'

echo ""
echo "==> 需手动验证（依赖真实微信 code）=="
echo "POST $BASE/api/v1/auth/login  body {\"code\":\"<wx.login code>\"}"
echo "    期望 → {code:200, data:{token, expires_in, user:{id,nickname,avatar_url,status,last_login_at,created_at,updated_at}}}"
echo "GET  $BASE/api/v1/user/profile  Authorization: Bearer <token>"
echo "    期望 → {code:200, data:<user_id>}"

echo ""
echo "==> 采集行为手动验证（无管理触发端点，看启动日志即可）=="
echo "启动命令（默认即 auto-full=false）："
echo "  mvn spring-boot:run -Dspring-boot.run.profiles=dev"
echo "  - auto-full=false（默认）：启动自检不跑全量。表已有数据时完全跳过自检；表为空时仅刷新股票信息/板块，日志出现"
echo "      '[启动] auto-full=false，仅刷新股票信息' 或 '[启动] 概念板块为空，自动采集'。"
echo "  - auto-full=true：表为空时启动自检执行全量采集（含日K线），日志出现 '[启动] stock_info 为空，自动执行采集'。"
echo "  - app.collector.startup-check=false：跳过启动自检（测试环境用），日志出现 '[启动] app.collector.startup-check=false，跳过启动自检'。"
echo "  - sample-size 生效于 CollectorService.runFull(sampleSize)（单测 CollectorServiceTest 覆盖）；"
echo "    定时 15:30 与启动自检的全量调用当前传 0（全部股票）。"

if [ "$FAILED" -eq 1 ]; then
  echo "" >&2
  echo "存在失败项，请对照 Go 版响应检查字段名/结构。" >&2
  exit 1
fi
echo ""
echo "全部自动项通过。"
