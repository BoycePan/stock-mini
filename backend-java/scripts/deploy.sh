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
# 日志：容器内 /apps/logs（logback-spring.xml，按天滚动保留 3 天），
#       默认挂载到宿主机 ${LOG_DIR:-/apps/stock/backend-java/logs}，可用 LOG_DIR 覆盖。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BACKEND_JAVA="$ROOT/backend-java"
ENV_FILE="$BACKEND_JAVA/.env"

RUN=0
TAG="latest"
PORT="${PORT:-18487}"
LOG_DIR="${LOG_DIR:-/apps/stock/backend-java/logs}"
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
echo "    日志挂载: ${LOG_DIR} -> /apps/logs (按天滚动，保留 3 天)"
mkdir -p "$LOG_DIR"
docker rm -f stock-backend-java 2>/dev/null || true

# ── OpenTelemetry agent（SigNoz 监控）──
# agent jar 从宿主挂载 + 覆盖 CMD 加载（不打包进镜像，省带宽）；
# jar 不存在时优雅降级（无监控启动，业务不停）
OTEL_JAR="$BACKEND_JAVA/opentelemetry-javaagent.jar"
AGENT_ARGS=""
if [ -f "$OTEL_JAR" ]; then
  AGENT_ARGS="-v $OTEL_JAR:/app/opentelemetry-javaagent.jar:ro"
  echo "    启用 OpenTelemetry agent ($OTEL_JAR)"
else
  echo "    !! $OTEL_JAR 不存在，本次以无监控模式启动（业务不受影响）。" >&2
  echo "    !! 下载：curl -L -o $OTEL_JAR https://repo1.maven.org/maven2/io/opentelemetry/javaagent/opentelemetry-javaagent/2.31.0/opentelemetry-javaagent-2.31.0.jar" >&2
fi

docker run -d \
  --name stock-backend-java \
  --restart unless-stopped \
  --network host \
  -e SERVER_PORT="$PORT" \
  -e LOG_DIR=/apps/logs \
  -v "$LOG_DIR:/apps/logs" \
  --env-file "$ENV_FILE" \
  $AGENT_ARGS \
  "stock-backend-java:$TAG" \
  bash -lc 'if [ -f /app/opentelemetry-javaagent.jar ]; then exec java -javaagent:/app/opentelemetry-javaagent.jar -Duser.timezone=Asia/Shanghai -jar app.jar; else exec java -Duser.timezone=Asia/Shanghai -jar app.jar; fi'

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
