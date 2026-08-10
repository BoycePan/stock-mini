# ── 编译阶段 ──
FROM maven:3.9-eclipse-temurin-21-alpine AS builder

WORKDIR /app

# 先拷贝 pom 并预下载依赖，利用 Docker 层缓存避免每次重下
COPY pom.xml .
RUN mvn -q -B dependency:go-offline

COPY src ./src
RUN mvn -q -B package -DskipTests

# ── 运行阶段 ──
FROM eclipse-temurin:21-jre-alpine

RUN apk add --no-cache ca-certificates tzdata wget
ENV TZ=Asia/Shanghai

WORKDIR /app
COPY --from=builder /app/target/stock-backend-*.jar app.jar

EXPOSE 18487

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -q --spider http://localhost:18487/api/health || exit 1

# 配置一律通过环境变量注入（DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD/JWT_SECRET/WECHAT_APP_ID/WECHAT_APP_SECRET）
# -Duser.timezone 与上方 ENV TZ=Asia/Shanghai 双保险，保证 JVM 默认时区为东8区（DAO 落库时间依赖它）
CMD ["java", "-Duser.timezone=Asia/Shanghai", "-jar", "app.jar"]
