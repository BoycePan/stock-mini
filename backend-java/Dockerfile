# ── 编译阶段 ──
FROM maven:3.9-eclipse-temurin-21-alpine AS builder

WORKDIR /app

# 先拷贝 pom 并预下载依赖，利用 Docker 层缓存避免每次重下
COPY pom.xml .
RUN mvn -q -B dependency:go-offline

COPY src ./src
RUN mvn -q -B package -DskipTests

# ── 运行阶段 ──
# 雅虎 Python sidecar 依赖 curl_cffi / pandas，只有 glibc 预编译 wheel；
# 必须用 glibc 镜像（noble），alpine(musl) 会现场编译，慢且易失败。
# 因此从原 eclipse-temurin:21-jre-alpine 换成 noble。
FROM eclipse-temurin:21-jre-noble

# python3-venv：Ubuntu 24.04(noble) 的 python3 是 PEP 668 externally-managed，
# pip 直接装系统环境会被拒绝，依赖统一装进 /opt/venv
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates tzdata wget python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*

ENV TZ=Asia/Shanghai

WORKDIR /app
COPY scripts/requirements.txt scripts/requirements.txt

# 依赖装进 venv，并把 venv 放到 PATH 最前：
# Java 侧 app.fetch.python 默认 "python3"，容器内 python3 即 venv 的 python，含全部依赖
# 放最前：requirements 极少变 → venv 层可复用，走镜像仓库时增量拉取不重传这 ~200MB
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r scripts/requirements.txt
ENV PATH="/opt/venv/bin:$PATH"

# 代码层放最后：Java / Python 改动各自只产生一个小层，镜像仓库增量拉取只传变化层
COPY scripts/fetch_service.py scripts/fetch_service.py
COPY --from=builder /app/target/stock-backend-*.jar app.jar

EXPOSE 18487

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -q --spider http://localhost:18487/api/health || exit 1

# 配置一律通过环境变量注入（DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD/JWT_SECRET/WECHAT_APP_ID/WECHAT_APP_SECRET）
# -Duser.timezone 与上方 ENV TZ=Asia/Shanghai 双保险，保证 JVM 默认时区为东8区（DAO 落库时间依赖它）
# app.fetch.enabled=true（默认）时，FetchSidecarLauncher 启动后拉起 scripts/fetch_service.py 子进程，
# JVM shutdown hook 在 Java 退出时 destroy 它 → Java 与 Python 同生命周期
CMD ["java", "-Duser.timezone=Asia/Shanghai", "-jar", "app.jar"]
