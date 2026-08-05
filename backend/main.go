package main

import "fmt"

//func main() {
//	// 1. 加载配置
//	cfg := config.Load()
//
//	// 2. 连接数据库
//	// Go 的惯用错误处理：每步都检查 err != nil
//	db, err := repository.NewDB(cfg)
//	if err != nil {
//		log.Fatalf("数据库连接失败: %v", err)
//	}
//	defer db.Close() // defer = finally，函数退出时自动执行
//
//	log.Println("数据库连接成功")
//
//	// 3. 初始化 handler
//	h := handler.NewHealthHandler(db)
//
//	// 4. 创建 Gin 引擎并注册路由
//	// gin.Default() 自带 Logger 和 Recovery 中间件
//	r := gin.Default()
//
//	// GET 请求，路径 + 处理函数
//	r.GET("/health", h.Health)
//	r.GET("/hello", h.Hello)
//
//	// 5. 启动服务器
//	log.Printf("服务器启动在 :%s", cfg.ServerPort)
//	if err := r.Run(":" + cfg.ServerPort); err != nil {
//		log.Fatalf("服务器启动失败: %v", err)
//	}
//}

func main() {
	fmt.Println("你好")
}
