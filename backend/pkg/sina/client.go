// Package sina 封装新浪财经 API 的调用逻辑。
//
// 子模块：
//   - kline.go: K线数据（日/周/月/分钟），分钟线内存缓存
//   - quote.go: 实时行情快照（hq.sinajs.cn），内存缓存 3-5 秒
//   - info.go:  股票列表、行业分类
//
// 数据流：
//
//	日线请求   → 由 handler/repository 层负责查/写 PostgreSQL
//	分钟线请求 → 本包内存缓存 → 未命中则调新浪 API
//	实时行情   → 本包内存缓存（短 TTL）→ 未命中则调新浪 API
package sina

import (
	"fmt"
	"net/url"
	"time"

	"wx-app-stock-backend/pkg/fetcher"
)

// ---------- 常量（API URL）----------

const (
	// K 线接口，文档：EXTERNAL_API_ANALYSIS.md 2.1节
	klineURL = "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData"

	// 实时行情接口，文档：EXTERNAL_API_ANALYSIS.md 2.4节
	quoteURL = "http://hq.sinajs.cn/list="

	// 股票列表接口，文档：EXTERNAL_API_ANALYSIS.md 2.2节
	stockListURL = "http://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData"

	// 行业分类接口，文档：EXTERNAL_API_ANALYSIS.md 2.3节
	industryURL = "http://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php"
)

// ---------- 全局数据源实例 ----------

// client 新浪财经的 HTTP 客户端，全局复用。
// 程序启动时调用 Init() 初始化，之后所有 func 共享此实例。
var client *fetcher.DataSource

// Init 初始化新浪数据源（main.go 中调用一次）。
// 参数来自 config.yaml 的 stock.sina 段。
func Init(rateLimitSec float64, maxRetries, timeoutSec int) {
	client = fetcher.NewSinaSource()

	// 覆盖默认限流参数
	if rateLimitSec > 0 {
		interval := time.Duration(rateLimitSec * float64(time.Second))
		client.Limiter = fetcher.NewRateLimiter(interval, 1)
	}
	if maxRetries > 0 {
		client.MaxRetries = maxRetries
	}
	if timeoutSec > 0 {
		client.Timeout = time.Duration(timeoutSec) * time.Second
	}
}

// ---------- 工具函数 ----------

// toSymbol 将 6 位代码转为新浪格式的市场前缀 + 代码。
//
// 规则（EXTERNAL_API_ANALYSIS.md 2.1节）：
//
//	6xxxxx, 9xxxxx → sh{code}
//	其他           → sz{code}
//
// 例：600001 → sh600001, 000001 → sz000001
func toSymbol(code string) string {
	if len(code) == 0 {
		return code
	}
	switch code[0] {
	case '6', '9':
		return "sh" + code
	default:
		return "sz" + code
	}
}

// buildKLineURL 拼接 K 线请求 URL，包含 query string。
//
// 参数：
//
//	code  - 纯 6 位代码（内部自动转 symbol）
//	scale - 周期："5"/"15"/"30"/"60"（分钟）或 "240"（日线）
//	count - 拉多少根 K 线
func buildKLineURL(code string, scale string, count int) string {
	params := url.Values{}
	params.Set("symbol", toSymbol(code))
	params.Set("scale", scale)
	params.Set("ma", "no")                          // 不需要均线
	params.Set("datalen", fmt.Sprintf("%d", count)) // 返回条数
	return klineURL + "?" + params.Encode()
}
