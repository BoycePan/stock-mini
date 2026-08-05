package service

import (
	"context"
	"log"
	"time"

	"wx-app-stock-backend/model"
	"wx-app-stock-backend/pkg/sina"
	"wx-app-stock-backend/pkg/ths"
	"wx-app-stock-backend/repository"
)

// Collector 数据采集服务。
type Collector struct {
	klineRepo   *repository.StockKLineRepo
	infoRepo    *repository.StockInfoRepo
	conceptRepo *repository.ConceptRepo
}

func NewCollector(klineRepo *repository.StockKLineRepo, infoRepo *repository.StockInfoRepo, conceptRepo *repository.ConceptRepo) *Collector {
	return &Collector{klineRepo: klineRepo, infoRepo: infoRepo, conceptRepo: conceptRepo}
}

// ---------- 公开方法 ----------

// RefreshStockInfo 仅刷新股票列表和行业分类（不拉 K 线）。
// 用于开盘前的定时任务，确保股票名称/代码是最新的。
// 耗时约 2-3 分钟。
func (c *Collector) RefreshStockInfo(ctx context.Context) {
	log.Println("[采集] ========== 开始刷新股票信息 ==========")
	startTime := time.Now()

	// 1. 拉股票列表
	stockInfos, err := sina.FetchStockList(ctx)
	if err != nil {
		log.Printf("[采集] 股票列表拉取失败: %v", err)
		return
	}
	log.Printf("[采集] 获取到 %d 只股票", len(stockInfos))

	// 2. 拉行业分类
	industryMap, err := sina.FetchIndustryMap(ctx)
	if err != nil {
		log.Printf("[采集] 行业分类拉取失败（非致命）: %v", err)
	} else {
		log.Printf("[采集] 获取到 %d 个行业映射", len(industryMap))
		for i := range stockInfos {
			if ind, ok := industryMap[stockInfos[i].Code]; ok {
				stockInfos[i].Industry = ind
			}
		}
	}

	// 3. 写入 stock_info
	dbInfos := sinaToModelInfos(stockInfos)
	if err := c.infoRepo.BatchUpsert(dbInfos); err != nil {
		log.Printf("[采集] stock_info 写入失败: %v", err)
		return
	}

	elapsed := time.Since(startTime)
	log.Printf("[采集] 股票信息刷新完成，%d 条，耗时 %s", len(dbInfos), elapsed.Round(time.Second))
}

// RunFull 全量采集：股票列表 + 日K线。
// 耗时约 80-90 分钟，盘后 15:30 触发。
func (c *Collector) RunFull(ctx context.Context) {
	startTime := time.Now()
	log.Println("[采集] ========== 开始全量采集（含日K线）==========")

	// 先刷新股票信息
	dbInfos := c.refreshStockInfoInternal(ctx)
	if len(dbInfos) == 0 {
		return
	}

	// 拉日K线
	c.fetchAllKlines(ctx, dbInfos)

	elapsed := time.Since(startTime)
	log.Printf("[采集] ========== 全量采集完成，耗时 %s ==========", elapsed.Round(time.Second))
}

// ---------- 内部方法 ----------

// refreshStockInfoInternal 与 RefreshStockInfo 逻辑相同，返回 dbInfos 供内部使用。
func (c *Collector) refreshStockInfoInternal(ctx context.Context) []model.StockInfo {
	stockInfos, err := sina.FetchStockList(ctx)
	if err != nil {
		log.Printf("[采集] 股票列表拉取失败: %v", err)
		return nil
	}
	log.Printf("[采集] 获取到 %d 只股票", len(stockInfos))

	industryMap, err := sina.FetchIndustryMap(ctx)
	if err != nil {
		log.Printf("[采集] 行业分类拉取失败（非致命）: %v", err)
	} else {
		for i := range stockInfos {
			if ind, ok := industryMap[stockInfos[i].Code]; ok {
				stockInfos[i].Industry = ind
			}
		}
	}

	dbInfos := sinaToModelInfos(stockInfos)
	if err := c.infoRepo.BatchUpsert(dbInfos); err != nil {
		log.Printf("[采集] stock_info 写入失败: %v", err)
		return nil
	}
	log.Printf("[采集] stock_info 写入完成 (%d 条)", len(dbInfos))
	return dbInfos
}

// fetchAllKlines 遍历全市场股票，逐只拉取日K线并写入。
// 新浪限流 1s/次，全市场 ~5000 只需要约 80 分钟。
func (c *Collector) fetchAllKlines(ctx context.Context, stocks []model.StockInfo) {
	total := len(stocks)
	saved := 0

	for i, s := range stocks {
		select {
		case <-ctx.Done():
			log.Printf("[采集] 被取消，已处理 %d/%d 只", i, total)
			return
		default:
		}

		// 跳过非沪深A股
		if s.Market != "sh" && s.Market != "sz" {
			continue
		}

		klines, err := sina.GetKLine(ctx, s.Code, "240", 60)
		if err != nil {
			log.Printf("[采集] %s 拉取失败: %v", s.Code, err)
			continue
		}
		if klines.Count == 0 {
			continue
		}

		dbKlines := sinaKlinesToModel(s.Code, klines.Klines)
		if err := c.klineRepo.BatchUpsert(dbKlines); err != nil {
			log.Printf("[采集] %s 写入失败: %v", s.Code, err)
			continue
		}
		saved++

		if (i+1)%100 == 0 {
			log.Printf("[采集] K线进度: %d/%d (已保存 %d)", i+1, total, saved)
		}
	}

	log.Printf("[采集] K线写入完成，共保存 %d 只股票", saved)
}

// RefreshConceptData 刷新概念板块数据（板块列表 + 成分股）。
// 从同花顺拉取，写入 concept_board 和 concept_stock 表。
// 耗时约 2-3 分钟（400 个板块，每板块间隔 0.5s）。
func (c *Collector) RefreshConceptData(ctx context.Context) {
	log.Println("[采集] 开始刷新概念板块...")

	// 1. 拉取全部概念板块
	boards, err := ths.FetchBoardList(ctx, 500)
	if err != nil {
		log.Printf("[采集] 板块列表拉取失败: %v", err)
		return
	}
	log.Printf("[采集] 获取到 %d 个概念板块", len(boards))

	// 2. 逐个写入板块 + 成分股
	savedBoards := 0
	savedMembers := 0
	for i, b := range boards {
		if err := c.conceptRepo.UpsertBoard(b.PlateCode, b.PlateName, b.Cid); err != nil {
			log.Printf("[采集] 板块写入失败(%s): %v", b.PlateCode, err)
			continue
		}
		savedBoards++

		// 拉成分股
		if b.Cid > 0 {
			codes, err := ths.FetchMembers(ctx, b.Cid)
			if err != nil {
				log.Printf("[采集] 成分股拉取失败(%s,cid=%d): %v", b.PlateCode, b.Cid, err)
				continue
			}
			if len(codes) > 0 {
				if err := c.conceptRepo.ReplaceMembers(b.PlateCode, codes); err != nil {
					log.Printf("[采集] 成分股写入失败(%s): %v", b.PlateCode, err)
					continue
				}
				savedMembers++
			}
		}

		if (i+1)%20 == 0 {
			log.Printf("[采集] 板块进度: %d/%d", i+1, len(boards))
		}
	}

	log.Printf("[采集] 概念板块刷新完成：%d 个板块, %d 个成分股已入库", savedBoards, savedMembers)
}

// ---------- 转换函数 ----------

func sinaToModelInfos(src []sina.StockInfo) []model.StockInfo {
	result := make([]model.StockInfo, len(src))
	for i, s := range src {
		result[i] = model.StockInfo{
			Code:     s.Code,
			Name:     s.Name,
			Type:     "stock",
			Market:   s.Market,
			Board:    s.Board,
			Industry: s.Industry,
			IsActive: true,
		}
	}
	return result
}

// sinaKlinesToModel 将新浪 K 线转为数据库 model，同时计算涨跌幅/涨跌额/振幅。
// 成交额和换手率新浪日线不返回，后续用东方财富/Baostock 补充。
func sinaKlinesToModel(code string, klines []sina.KLine) []model.StockKLine {
	result := make([]model.StockKLine, 0, len(klines))
	var prevClose float64

	for i, k := range klines {
		tradeDate, _ := time.Parse("2006-01-02", k.Time)

		dbKline := model.StockKLine{
			Code:      code,
			Scale:     "1d",
			TradeDate: tradeDate,
			Open:      k.Open,
			High:      k.High,
			Low:       k.Low,
			Close:     k.Close,
			Volume:    k.Volume,
			// 成交额估算：均价 × 成交量（误差约 5-10%）
			Amount: round2((k.Open + k.High + k.Low + k.Close) / 4 * float64(k.Volume)),
		}

		if i > 0 && prevClose != 0 {
			dbKline.ChangeAmt = round2(k.Close - prevClose)
			dbKline.PctChange = round2((k.Close - prevClose) / prevClose * 100)
			dbKline.Amplitude = round2((k.High - k.Low) / prevClose * 100)
		}
		prevClose = k.Close
		result = append(result, dbKline)
	}
	return result
}

func round2(v float64) float64 {
	return float64(int(v*100+0.5)) / 100
}
