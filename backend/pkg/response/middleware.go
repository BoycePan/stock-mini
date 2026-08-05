package response

import (
	"log"
	"net/http"

	"wx-app-stock-backend/pkg/errcode"

	"github.com/gin-gonic/gin"
)

// Recovery 全局异常处理中间件。
// 对标 Java 的 GlobalExceptionHandler。
// 放在路由链最外层，捕获后续 handler 中 panic 抛出的 BizError 和未知异常。
func Recovery() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if r := recover(); r != nil {
				switch e := r.(type) {
				case *BizError:
					// 业务异常 → 返回错误码和消息
					c.AbortWithStatusJSON(http.StatusOK, Error(e.Code, e.Msg))
				default:
					// 未知异常 → 500
					log.Printf("panic recovered: %v", r)
					c.AbortWithStatusJSON(http.StatusOK, Error(errcode.ServerError, "内部服务错误"))
				}
			}
		}()
		c.Next()
	}
}
