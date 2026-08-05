package response

import (
	"net/http"

	"wx-app-stock-backend/pkg/errcode"

	"github.com/gin-gonic/gin"
)

// R 统一响应体。
// 对标 Java 的 R<T> {code, msg, data}
type R struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
	Data any    `json:"data,omitempty"` // omitempty: data 为空时不序列化
}

// Write 写入 HTTP 响应（状态码固定 200，业务状态码在 code 字段里）。
func (r *R) Write(c *gin.Context) {
	c.JSON(http.StatusOK, r)
}

// Abort 中断请求链并写入响应（用于中间件拦截）。
func (r *R) Abort(c *gin.Context) {
	c.AbortWithStatusJSON(http.StatusOK, r)
}

func Success(data any) *R {
	return &R{Code: errcode.Success, Msg: errcode.Msg(errcode.Success), Data: data}
}

func Ok() *R {
	return Success(nil)
}

func Error(code int, msg string) *R {
	if msg == "" {
		msg = errcode.Msg(code)
	}
	return &R{Code: code, Msg: msg}
}
