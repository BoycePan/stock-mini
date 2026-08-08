#!/usr/bin/env bash
#
# backend-java 部署脚本。
#
# 从 Go 版 backend/config.yaml 读取数据库/微信/JWT 配置（运行时读取，不落盘到仓库），
# 构建 backend-java 镜像。默认只构建；加 --run 才在本机以容器方式运行（--network host）。
#
# 用法：
#   bash scripts/deploy.sh            # 只构建镜像 stock-backend-java:latest
#   bash scripts/deploy.sh --run      # 构建并运行容器（默认端口 18487，可用 PORT 覆盖）
#   bash scripts/deploy.sh --tag v1   # 指定镜像 tag（默认 latest）
#
# 注意：本机与服务器共用同一 config.yaml 时，数据库主机/端口须可达；
#       --run 会启动一个占 18487 端口的容器（与运行中的 Go 版冲突时请用 PORT 改端口）。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BACKEND_JAVA="$ROOT/backend-java"
CONFIG="$ROOT/backend/config.yaml"

RUN=0
TAG="latest"
PORT="${PORT:-18487}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --run) RUN=1 ;;
    --tag) TAG="$2"; shift ;;
    *) echo "未知参数: $1" >&2; exit 1 ;;
  esac
  shift
done

[ -f "$CONFIG" ] || { echo "未找到 $CONFIG" >&2; exit 1; }

# 从 YAML 提取 `key: value`（键在文件中唯一；去引号）
yaml_get() {
  sed -n "s/^[[:space:]]*$1:[[:space:]]*[\"']\?\([^\"']*\)[\"']\?$/\1/p" "$CONFIG" | head -1
}

DB_HOST="$(yaml_get host)"
DB_PORT="$(yaml_get port)"
DB_USER="$(yaml_get user)"
DB_PASSWORD="$(yaml_get password)"
DB_NAME="$(yaml_get name)"
JWT_SECRET="$(yaml_get secret)"
WECHAT_APP_ID="$(yaml_get app_id)"
WECHAT_APP_SECRET="$(yaml_get app_secret)"

for v in DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME JWT_SECRET WECHAT_APP_ID WECHAT_APP_SECRET; do
  [ -n "${!v}" ] || { echo "config.yaml 中缺少 $v" >&2; exit 1; }
done

echo "==> 构建镜像 stock-backend-java:$TAG (source: $BACKEND_JAVA)"
docker build -t "stock-backend-java:$TAG" "$BACKEND_JAVA"

if [ "$RUN" -ne 1 ]; then
  echo ""
  echo "镜像已构建（未运行）。"
  echo "本机运行（验证）：bash scripts/deploy.sh --run"
  echo "  或使用 run-sample-on-start 触发小样本采集："
  echo "  docker run -d --name stock-backend-java --network host --env-file <env文件> \\"
  echo "    -e PORT=18487 -e JAVA_TOOL_OPTIONS=\"-Dapp.collector.run-sample-on-start=true -Dapp.collector.sample-size=20\" \\"
  echo "    stock-backend-java:$TAG"
  exit 0
fi

# 临时 env 文件（避免 -e 把密码暴露在进程列表/历史）
ENV_FILE="$(mktemp)"
trap 'rm -f "$ENV_FILE"' EXIT
{
  echo "DB_HOST=$DB_HOST"
  echo "DB_PORT=$DB_PORT"
  echo "DB_NAME=$DB_NAME"
  echo "DB_USER=$DB_USER"
  echo "DB_PASSWORD=$DB_PASSWORD"
  echo "JWT_SECRET=$JWT_SECRET"
  echo "WECHAT_APP_ID=$WECHAT_APP_ID"
  echo "WECHAT_APP_SECRET=$WECHAT_APP_SECRET"
} > "$ENV_FILE"

echo "==> 启动容器 stock-backend-java (port ${PORT}, network host)"
docker rm -f stock-backend-java 2>/dev/null || true
docker run -d \
  --name stock-backend-java \
  --restart unless-stopped \
  --network host \
  -e SERVER_PORT="$PORT" \
  --env-file "$ENV_FILE" \
  "stock-backend-java:$TAG"

echo "==> 等待健康检查 ..."
for i in $(seq 1 60); do
  if curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
    echo "    就绪 (${i}s)"
    exit 0
  fi
  sleep 1
done
echo "健康检查超时，最近日志:" >&2
docker logs --tail 30 stock-backend-java >&2
exit 1
