package handler

import (
	"strconv"
	"time"

	"wx-app-stock-backend/model"
	"wx-app-stock-backend/pkg/errcode"
	"wx-app-stock-backend/pkg/response"
	"wx-app-stock-backend/pkg/sina"
	"wx-app-stock-backend/repository"

	"github.com/gin-gonic/gin"
)

// StockHandler 股票数据接口处理器。
type StockHandler struct {
	klineRepo *repository.StockKLineRepo
	infoRepo  *repository.StockInfoRepo
}

func NewStockHandler(klineRepo *repository.StockKLineRepo, infoRepo *repository.StockInfoRepo) *StockHandler {
	return &StockHandler{klineRepo: klineRepo, infoRepo: infoRepo}
}

// klineQuery K 线查询参数
type klineQuery struct {
	Scale string `form:"scale" binding:"required"`
	Count int    `form:"count"`
}

// scaleToDB 将 API scale 参数映射为数据库 scale 字段
func scaleToDB(scale string) string {
	switch scale {
	case "240":
		return "1d"
	case "1200":
		return "1w"

	default:
		return scale
	}
}

// isDBKLine scale 是否需要走数据库（日线/周线/月线）
func isDBKLine(scale string) bool {
	return scale == "240" || scale == "1200"
}

// ---------- K 线 ----------

func (h *StockHandler) GetKLine(c *gin.Context) {
	code := c.Param("code")
	if code == "" {
		response.Error(errcode.InvalidParam, "股票代码不能为空").Write(c)
		return
	}
	var q klineQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Error(errcode.InvalidParam, "scale 参数必填，例如 ?scale=240").Write(c)
		return
	}
	if q.Count <= 0 {
		q.Count = 100
	}

	if isDBKLine(q.Scale) {
		h.getDBKLine(c, code, q.Scale, q.Count)
		return
	}

	result, err := sina.GetKLine(c.Request.Context(), code, q.Scale, q.Count)
	if err != nil {
		response.Error(errcode.ServerError, err.Error()).Write(c)
		return
	}
	response.Success(result).Write(c)
}

func (h *StockHandler) getDBKLine(c *gin.Context, code, scale string, count int) {
	dbScale := scaleToDB(scale)
	dbKlines, err := h.klineRepo.QueryByCode(code, dbScale, count)
	if err == nil && len(dbKlines) > 0 {
		result := dbKlinesToResult(code, scale, dbKlines)
		response.Success(result).Write(c)
		return
	}

	sinaResult, err := sina.GetKLine(c.Request.Context(), code, scale, count)
	if err != nil {
		response.Error(errcode.ServerError, err.Error()).Write(c)
		return
	}

	go func() {
		dbRows := sinaKlinesToDB(code, scale, sinaResult.Klines)
		if len(dbRows) > 0 {
			h.klineRepo.BatchUpsert(dbRows)
		}
	}()

	response.Success(sinaResult).Write(c)
}

// ---------- 行情 ----------

func (h *StockHandler) GetQuote(c *gin.Context) {
	code := c.Param("code")
	if code == "" {
		response.Error(errcode.InvalidParam, "股票代码不能为空").Write(c)
		return
	}
	quote, err := sina.GetQuote(c.Request.Context(), code)
	if err != nil {
		response.Error(errcode.ServerError, err.Error()).Write(c)
		return
	}
	response.Success(quote).Write(c)
}

func (h *StockHandler) BatchQuote(c *gin.Context) {
	codesStr := c.Query("codes")
	if codesStr == "" {
		response.Error(errcode.InvalidParam, "codes 参数必填，逗号分隔").Write(c)
		return
	}
	codes := splitCodes(codesStr)
	if len(codes) == 0 {
		response.Error(errcode.InvalidParam, "股票代码列表为空").Write(c)
		return
	}
	if len(codes) > 50 {
		response.Error(errcode.InvalidParam, "一次最多查询 50 只股票").Write(c)
		return
	}
	quotes, err := sina.BatchQuote(c.Request.Context(), codes)
	if err != nil {
		response.Error(errcode.ServerError, err.Error()).Write(c)
		return
	}
	response.Success(quotes).Write(c)
}

// ---------- 搜索 ----------

// Search GET /api/v1/stock/search?q=茅台&limit=10
// 按代码或名称搜索，支持前缀匹配。
func (h *StockHandler) Search(c *gin.Context) {
	q := c.Query("q")
	if q == "" {
		response.Error(errcode.InvalidParam, "q 参数必填").Write(c)
		return
	}

	limit := 20
	if n, err := strconv.Atoi(c.DefaultQuery("limit", "20")); err == nil && n > 0 && n <= 100 {
		limit = n
	}

	infos, err := h.infoRepo.Search(q, limit)
	if err != nil {
		response.Error(errcode.ServerError, err.Error()).Write(c)
		return
	}

	response.Success(gin.H{
		"keyword": q,
		"count":   len(infos),
		"stocks":  infos,
	}).Write(c)
}

// ---------- 格式转换 ----------

func dbKlinesToResult(code, scale string, dbKlines []model.StockKLine) *sina.KLineResult {
	klines := make([]sina.KLine, 0, len(dbKlines))
	for i := len(dbKlines) - 1; i >= 0; i-- {
		k := dbKlines[i]
		klines = append(klines, sina.KLine{
			Time:   k.TradeDate.Format("2006-01-02"),
			Open:   k.Open,
			High:   k.High,
			Low:    k.Low,
			Close:  k.Close,
			Volume: k.Volume,
		})
	}
	return &sina.KLineResult{Code: code, Scale: scale, Klines: klines, Count: len(klines)}
}

func sinaKlinesToDB(code, scale string, klines []sina.KLine) []model.StockKLine {
	result := make([]model.StockKLine, 0, len(klines))
	var prevClose float64
	for i, k := range klines {
		tradeDate, _ := time.Parse("2006-01-02", k.Time)
		dbKline := model.StockKLine{
			Code: code, Scale: scaleToDB(scale), TradeDate: tradeDate,
			Open: k.Open, High: k.High, Low: k.Low, Close: k.Close, Volume: k.Volume,
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

func round2(v float64) float64 { return float64(int(v*100+0.5)) / 100 }

// ---------- 工具 ----------

func splitCodes(s string) []string {
	var result []string
	current := ""
	for _, ch := range s {
		if ch == ',' {
			if current != "" {
				result = append(result, current)
				current = ""
			}
		} else if ch != ' ' {
			current += string(ch)
		}
	}
	if current != "" {
		result = append(result, current)
	}
	return result
}
