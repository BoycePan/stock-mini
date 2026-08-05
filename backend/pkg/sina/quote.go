package sina

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"wx-app-stock-backend/pkg/cache"
	"wx-app-stock-backend/pkg/fetcher"
)

// ---------- 数据结构 ----------

// Quote 实时行情快照。
// 字段来源：hq.sinajs.cn 逗号分隔行，索引见 parseOneQuote 注释。
type Quote struct {
	Code      string  `json:"code"`       // 6 位股票代码
	Name      string  `json:"name"`       // 股票名称
	Open      float64 `json:"open"`       // 今开
	PrevClose float64 `json:"prev_close"` // 昨收
	Price     float64 `json:"price"`      // 当前价
	High      float64 `json:"high"`       // 今日最高
	Low       float64 `json:"low"`        // 今日最低
	Volume    int64   `json:"volume"`     // 成交量（股）
	Amount    float64 `json:"amount"`     // 成交额（元）
	Date      string  `json:"date"`       // 日期 "2026-08-05"
	Time      string  `json:"time"`       // 时间 "15:00:03"
	Turnover  float64 `json:"turnover"`   // 换手率（%）
	PctChange float64 `json:"pct_change"` // 涨跌幅（%），本地计算
}

// ---------- 缓存 ----------

// quoteCache 实时行情内存缓存。
// key: 6 位股票代码, TTL: 3 秒（盘中行情变化快）
var quoteCache = cache.New[*Quote]()

const quoteCacheTTL = 3 * time.Second

// batchQuoteCache 批量行情缓存，key 为排序去重后的 codes 拼接
var batchQuoteCache = cache.New[[]*Quote]()

// ---------- 公开 API ----------

// GetQuote 获取单只股票实时行情（带缓存）。
//
// 盘中每 3 秒刷新一次，盘后价格不再变化但缓存 TTL 一样无所谓。
func GetQuote(ctx context.Context, code string) (*Quote, error) {
	if client == nil {
		return nil, fmt.Errorf("sina 未初始化，请先调用 Init()")
	}

	if q, ok := quoteCache.Get(code); ok {
		return q, nil
	}

	quotes, err := fetchQuotes(ctx, []string{code})
	if err != nil {
		return nil, err
	}
	if len(quotes) == 0 || quotes[0] == nil {
		return nil, fmt.Errorf("未找到 %s 的行情数据", code)
	}

	q := quotes[0]
	q.Code = code // 确保 code 有值
	quoteCache.Set(code, q, quoteCacheTTL)
	return q, nil
}

// BatchQuote 批量获取实时行情，最多 50 只一批。
func BatchQuote(ctx context.Context, codes []string) ([]*Quote, error) {
	if client == nil {
		return nil, fmt.Errorf("sina 未初始化，请先调用 Init()")
	}
	if len(codes) == 0 {
		return nil, nil
	}

	sorted := make([]string, len(codes))
	copy(sorted, codes)
	sort.Strings(sorted)
	cacheKey := strings.Join(sorted, ",")
	if cached, ok := batchQuoteCache.Get(cacheKey); ok {
		return cached, nil
	}

	quotes, err := fetchQuotes(ctx, codes)
	if err != nil {
		return nil, err
	}
	batchQuoteCache.Set(cacheKey, quotes, quoteCacheTTL)
	return quotes, nil
}

// ---------- 网络调用 ----------

// fetchQuotes 调 hq.sinajs.cn，GBK 编码，需要手动解码。
func fetchQuotes(ctx context.Context, codes []string) ([]*Quote, error) {
	if len(codes) == 0 {
		return nil, nil
	}

	// 拼接 URL: http://hq.sinajs.cn/list=sh600001,sz000001,...
	symbols := make([]string, len(codes))
	for i, c := range codes {
		symbols[i] = toSymbol(c)
	}
	url := quoteURL + strings.Join(symbols, ",")

	// GetRaw 拿到原始字节（因为这里是 GBK，不能让 Get 的自动解码误判）
	resp, err := client.GetRaw(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("新浪行情请求失败: %w", err)
	}

	// 手动 GBK→UTF-8
	utf8Body, err := fetcher.DecodeBytes(resp.Body, "gbk")
	if err != nil {
		return nil, fmt.Errorf("行情编码转换失败: %w", err)
	}

	return parseQuoteLines(string(utf8Body)), nil
}

// parseQuoteLines 解析响应，每行格式: var hq_str_sh600001="值1,值2,..."
func parseQuoteLines(body string) []*Quote {
	var quotes []*Quote

	for _, line := range strings.Split(body, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || !strings.Contains(line, "=") {
			continue
		}

		// 提取 hq_str_ 前缀中的 symbol（如 sh600001）
		// 行格式: var hq_str_sh600001="..."
		eqIdx := strings.Index(line, "=")
		symbolPart := line[:eqIdx]

		// 提取 6 位代码
		code := ""
		if idx := strings.LastIndex(symbolPart, "_"); idx >= 0 {
			code = fromSymbol(symbolPart[idx+1:])
		}

		// 提取引号内容
		quoteIdx := strings.Index(line, "\"")
		if quoteIdx < 0 {
			continue
		}
		rest := line[quoteIdx+1:]
		endQuote := strings.LastIndex(rest, "\"")
		if endQuote < 0 {
			continue
		}
		raw := rest[:endQuote]

		q := parseOneQuote(code, raw)
		if q != nil {
			quotes = append(quotes, q)
		}
	}

	return quotes
}

// parseOneQuote 解析逗号分隔的单只股票行情。
//
// 新浪行情字段布局（EXTERNAL_API_ANALYSIS.md 2.4节 + 实测修正）：
//
//	[0]  名称
//	[1]  今开
//	[2]  昨收
//	[3]  当前价
//	[4]  最高
//	[5]  最低
//	[6]  竞买价
//	[7]  竞卖价
//	[8]  成交量（股）
//	[9]  成交额（元）
//	[10-29] 买卖五档盘口（买1量/买1价/.../卖5量/卖5价 共 20 个字段）
//	[30] 日期  "2026-08-05"
//	[31] 时间  "15:00:03"
//	[32] 状态 "00"=正常
//	[33] 附加信息
//
// 注意：换手率字段在当前接口中不可靠，统一返回 0。
func parseOneQuote(code string, line string) *Quote {
	fields := strings.Split(line, ",")
	if len(fields) < 32 {
		return nil
	}

	q := &Quote{
		Code:      code,
		Name:      fields[0],
		Open:      parseFloat(fields[1]),
		PrevClose: parseFloat(fields[2]),
		Price:     parseFloat(fields[3]),
		High:      parseFloat(fields[4]),
		Low:       parseFloat(fields[5]),
		Volume:    parseInt64(fields[8]),
		Amount:    parseFloat(fields[9]),
		Date:      safeField(fields, 30),
		Time:      safeField(fields, 31),
	}

	// 涨跌幅 = (当前价 - 昨收) / 昨收 * 100
	if q.PrevClose != 0 {
		q.PctChange = (q.Price - q.PrevClose) / q.PrevClose * 100
	}

	return q
}

// fromSymbol 去掉 sh/sz 前缀，返回纯 6 位代码。
// 例: "sh600001" → "600001"
func fromSymbol(symbol string) string {
	if len(symbol) > 2 {
		return symbol[2:]
	}
	return symbol
}

// safeField / safeFloatField 安全取索引，越界返回空/0。
func safeField(fields []string, idx int) string {
	if idx >= len(fields) {
		return ""
	}
	return strings.TrimSpace(fields[idx])
}

func safeFloatField(fields []string, idx int) float64 {
	if idx >= len(fields) {
		return 0
	}
	return parseFloat(fields[idx])
}
