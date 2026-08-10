#!/usr/bin/env bash
#
# backend-java 部署脚本。
#
# 从 backend-java/.env 读取数据库/微信/JWT/新浪配置（构建不打包配置，
# 运行时用 docker run --env-file 注入为容器环境变量，spring-dotenv 读取；OS 环境变量优先于 .env）。
# 构建 backend-java 镜像。
# 默认只构建；加 --run 才在本机以容器方式运行（--network host）。
#
# 用法：
#   bash scripts/deploy.sh            # 只构建镜像 stock-backend-java:latest
#   bash scripts/deploy.sh --run      # 构建并运行容器（默认端口 18487，可用 PORT 覆盖）
#   bash scripts/deploy.sh --tag v1   # 指定镜像 tag（默认 latest）
#
# 前置：backend-java/.env 必须存在（git 忽略，本地提供）：
#   cp backend-java/.env.example backend-java/.env   # 再填入真实值
#
# 注意：--run 会启动一个占 18487 端口的容器（与运行中的 Go 版冲突时请用 PORT 改端口）。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BACKEND_JAVA="$ROOT/backend-java"
ENV_FILE="$BACKEND_JAVA/.env"

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

if [ ! -f "$ENV_FILE" ]; then
  echo "未找到 $ENV_FILE" >&2
  echo "请先复制模板并填入真实值：" >&2
  echo "  cp $BACKEND_JAVA/.env.example $ENV_FILE" >&2
  echo "（真实值可从 backend/config.yaml 复制；.env 被 git 忽略，不会提交）" >&2
  exit 1
fi

# 从 .env 提取 `KEY=VALUE`（键唯一；去除首尾引号）——仅用于提前校验，运行时由 docker --env-file 注入
env_get() {
  sed -n "s/^[[:space:]]*$1=\(.*\)$/\1/p" "$ENV_FILE" | head -1 \
    | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

for var in DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD JWT_SECRET WECHAT_APP_ID WECHAT_APP_SECRET; do
  val="$(env_get "$var")"
  [ -n "$val" ] || { echo ".env 中缺少 $var" >&2; exit 1; }
done

echo "==> 构建镜像 stock-backend-java:$TAG (source: $BACKEND_JAVA)"
docker build -t "stock-backend-java:$TAG" "$BACKEND_JAVA"

if [ "$RUN" -ne 1 ]; then
  echo ""
  echo "镜像已构建（未运行）。运行：bash scripts/deploy.sh --run"
  echo "运行时将把 $ENV_FILE 以 --env-file 注入容器环境变量。"
  exit 0
fi

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
