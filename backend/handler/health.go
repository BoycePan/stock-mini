package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
)

// HealthHandler 持有数据库连接
// Go 没有继承，用组合：struct 里嵌字段
type HealthHandler struct {
	db *sqlx.DB
}

// NewHealthHandler 构造函数
func NewHealthHandler(db *sqlx.DB) *HealthHandler {
	return &HealthHandler{db: db}
}

// Health 健康检查端点
// (h *HealthHandler) 叫"接收者"（receiver），相当于 Java 的 this
// 但 Go 把它写在方法名前面
func (h *HealthHandler) Health(c *gin.Context) {
	status := "ok"
	dbStatus := "connected"

	if err := h.db.Ping(); err != nil {
		status = "degraded"
		dbStatus = "disconnected: " + err.Error()
	}

	c.JSON(http.StatusOK, gin.H{
		"status":   status,
		"database": dbStatus,
	})
}

// Hello 简单问候
func (h *HealthHandler) Hello(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"message": "Hello World from Gin!",
	})
}
