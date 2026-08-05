package middleware

import (
	"strings"

	"wx-app-stock-backend/config"
	"wx-app-stock-backend/pkg/errcode"
	"wx-app-stock-backend/pkg/response"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

type JWTClaims struct {
	UserID int64  `json:"user_id"`
	OpenID string `json:"openid"`
	jwt.RegisteredClaims
}

func Auth(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			response.Error(errcode.TokenMissing, "").Abort(c)
			return
		}

		tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
		if tokenStr == authHeader {
			response.Error(errcode.TokenMissing, "认证格式错误，应为 Bearer <token>").Abort(c)
			return
		}

		var claims JWTClaims
		token, err := jwt.ParseWithClaims(tokenStr, &claims, func(t *jwt.Token) (any, error) {
			return []byte(cfg.JWT.Secret), nil
		})
		if err != nil || !token.Valid {
			response.Error(errcode.TokenInvalid, "").Abort(c)
			return
		}

		c.Set("user_id", claims.UserID)
		c.Set("openid", claims.OpenID)
		c.Next()
	}
}
