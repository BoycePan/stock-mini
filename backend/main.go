package main

import (
	"context"
	"log"
	"time"

	"wx-app-stock-backend/config"
	"wx-app-stock-backend/handler"
	"wx-app-stock-backend/middleware"
	"wx-app-stock-backend/pkg/cninfo"
	"wx-app-stock-backend/pkg/eastmoney"
	"wx-app-stock-backend/pkg/response"
	"wx-app-stock-backend/pkg/sina"
	"wx-app-stock-backend/pkg/ths"
	"wx-app-stock-backend/repository"
	"wx-app-stock-backend/service"

	"github.com/gin-gonic/gin"
	"github.com/robfig/cron/v3"
)

func main() {
	cfg := config.Load()

	// 初始化数据源
	sina.Init(cfg.Stock.Sina.RateLimit, cfg.Stock.Sina.MaxRetries, cfg.Stock.Sina.Timeout)
	log.Println("新浪数据源已初始化")
	eastmoney.Init(cfg.Stock.Eastmoney.RateLimit, cfg.Stock.Eastmoney.MaxRetries, cfg.Stock.Eastmoney.Timeout)
	log.Println("东方财富数据源已初始化")
	ths.Init(cfg.Stock.THS.RateLimit, cfg.Stock.THS.MaxRetries, cfg.Stock.THS.Timeout)
	log.Println("同花顺数据源已初始化")
	cninfo.Init(cfg.Stock.Cninfo.RateLimit, cfg.Stock.Cninfo.MaxRetries, cfg.Stock.Cninfo.Timeout)
	log.Println("巨潮资讯数据源已初始化")

	db, err := repository.NewDB(cfg)
	if err != nil {
		log.Fatalf("数据库连接失败: %v", err)
	}
	defer db.Close()
	log.Println("数据库连接成功")

	// ---------- 依赖注入 ----------

	// Repository 层
	userRepo := repository.NewUserRepo(db)
	klineRepo := repository.NewStockKLineRepo(db)
	infoRepo := repository.NewStockInfoRepo(db)
	conceptRepo := repository.NewConceptRepo(db)
	newsRepo := repository.NewNewsRepo(db)

	// Service 层
	authService := service.NewAuthService(cfg, userRepo)
	collector := service.NewCollector(klineRepo, infoRepo, conceptRepo)

	// Handler 层
	authHandler := handler.NewAuthHandler(authService)
	stockHandler := handler.NewStockHandler(klineRepo, infoRepo)
	sectorHandler := handler.NewSectorHandler(conceptRepo)
	newsHandler := handler.NewNewsHandler(newsRepo)

	// ---------- 路由 ----------
	r := gin.Default()
	r.Use(response.Recovery())

	api := r.Group("/api/v1")
	api.POST("/auth/login", authHandler.Login)

	// 股票行情接口
	api.GET("/stock/search", stockHandler.Search)
	api.GET("/stock/quotes", stockHandler.BatchQuote)
	api.GET("/stock/:code/klines", stockHandler.GetKLine)
	api.GET("/stock/:code/quote", stockHandler.GetQuote)

	// 概念板块接口
	api.GET("/sector/boards", sectorHandler.ListBoards)
	api.GET("/sector/board/:code/klines", sectorHandler.GetBoardKLine)
	api.GET("/sector/members/:cid", sectorHandler.GetMembers)

	// 新闻接口
	api.GET("/news/feed", newsHandler.FeedNews)
	api.GET("/stock/:code/news", newsHandler.StockNews)
	api.GET("/stock/:code/announcements", newsHandler.Announcements)

	// 需要认证的路由
	auth := api.Group("", middleware.Auth(cfg))
	auth.GET("/user/profile", func(c *gin.Context) {
		value, _ := c.Get("user_id")
		response.Success(value).Write(c)
	})

	// ---------- 定时任务 ----------
	c := cron.New(cron.WithSeconds())

	// 交易日 9:00 刷新股票信息
	c.AddFunc("0 0 9 * * 1-5", func() {
		log.Println("[定时任务] 刷新股票信息...")
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		collector.RefreshStockInfo(ctx)
	})

	// 交易日 9:05 刷新概念板块数据（在 stock_info 之后）
	c.AddFunc("0 5 9 * * 1-5", func() {
		log.Println("[定时任务] 刷新概念板块...")
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		collector.RefreshConceptData(ctx)
	})

	// 交易日 15:30 采集日K线
	c.AddFunc("0 30 15 * * 1-5", func() {
		log.Println("[定时任务] 盘后日K线采集...")
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Hour)
		defer cancel()
		collector.RunFull(ctx)
	})

	// 启动时检查：stock_info 为空则立即刷新
	go func() {
		time.Sleep(3 * time.Second)
		infos, err := infoRepo.GetAll()
		if err != nil || len(infos) == 0 {
			log.Println("[启动] stock_info 为空，自动执行首次采集...")
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Hour)
			defer cancel()
			collector.RunFull(ctx)
		} else {
			log.Printf("[启动] 已有 %d 只股票数据，跳过首次采集", len(infos))
		}
	}()

	// 启动时检查：concept_board 为空则立即采集
	go func() {
		time.Sleep(5 * time.Second)
		n, _ := conceptRepo.CountBoards()
		if n == 0 {
			log.Println("[启动] 概念板块为空，自动采集...")
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
			defer cancel()
			collector.RefreshConceptData(ctx)
		} else {
			log.Printf("[启动] 已有 %d 个概念板块", n)
		}
	}()

	c.Start()
	log.Println("定时任务已启动（交易日 9:00 刷新股票信息，9:05 概念板块，15:30 采集日K线）")

	log.Printf("服务器启动在 :%s", cfg.Server.Port)
	if err := r.Run(":" + cfg.Server.Port); err != nil {
		log.Fatalf("服务器启动失败: %v", err)
	}
}
