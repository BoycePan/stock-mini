# ================================================================
#  后端 Dockerfile — Go 多阶段构建
# ================================================================

# ── 阶段 1: 编译 ──
FROM golang:1.25-alpine AS builder

WORKDIR /app

# 国内镜像加速
ENV GOPROXY=https://goproxy.cn,direct

# 安装系统依赖（如果需要 CGO 可取消注释）
# RUN apk add --no-cache gcc musl-dev

# 复制依赖文件
COPY backend/go.mod backend/go.sum ./
RUN go mod download

# 复制源码
COPY backend/ ./

# 编译（静态链接）
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o server .

# ── 阶段 2: 运行 ──
FROM alpine:3.21

RUN apk add --no-cache ca-certificates tzdata
ENV TZ=Asia/Shanghai

WORKDIR /app

# 复制编译产物
COPY --from=builder /app/server .

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q --spider http://localhost:8080/api/v1/stock/search?keyword=test || exit 1

CMD ["./server"]
