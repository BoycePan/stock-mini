package main

import (
	"log"

	"wx-app-stock-backend/config"
	"wx-app-stock-backend/handler"
	"wx-app-stock-backend/middleware"
	"wx-app-stock-backend/pkg/response"
	"wx-app-stock-backend/repository"
	"wx-app-stock-backend/service"

	"github.com/gin-gonic/gin"
)

func main() {
	cfg := config.Load()

	db, err := repository.NewDB(cfg)
	if err != nil {
		log.Fatalf("数据库连接失败: %v", err)
	}
	defer db.Close()

	log.Println("数据库连接成功")

	userRepo := repository.NewUserRepo(db)
	authService := service.NewAuthService(cfg, userRepo)
	authHandler := handler.NewAuthHandler(authService)

	r := gin.Default()

	// 全局异常恢复，放在最外层，对标 Java GlobalExceptionHandler
	r.Use(response.Recovery())

	api := r.Group("/api/v1")
	api.POST("/auth/login", authHandler.Login)

	auth := api.Group("", middleware.Auth(cfg))
	auth.GET("/user/profile", func(c *gin.Context) {
		value, _ := c.Get("user_id")
		response.Success(value).Write(c)
	})

	log.Printf("服务器启动在 :%s", cfg.Server.Port)
	if err := r.Run(":" + cfg.Server.Port); err != nil {
		log.Fatalf("服务器启动失败: %v", err)
	}
}
