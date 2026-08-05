package sina

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"wx-app-stock-backend/pkg/cache"
)

// ---------- 数据结构 ----------

// KLine 单根 K 线
type KLine struct {
	Time   string  `json:"time"`   // 日期或时间：日线 "2026-08-05"，分钟线 "2026-08-05 14:55:00"
	Open   float64 `json:"open"`   // 开盘价
	High   float64 `json:"high"`   // 最高价
	Low    float64 `json:"low"`    // 最低价
	Close  float64 `json:"close"`  // 收盘价
	Volume int64   `json:"volume"` // 成交量（股）
}

// KLineResult K 线查询结果
type KLineResult struct {
	Code   string  `json:"code"`   // 6 位股票代码
	Scale  string  `json:"scale"`  // 周期：5/15/30/60/240
	Klines []KLine `json:"klines"` // K 线列表，按时间升序
	Count  int     `json:"count"`  // 返回条数
}

// sinaKlineRaw 新浪 K 线 API 原始 JSON 的一条记录。
// 字段名与接口返回保持一致（首字母小写）。
type sinaKlineRaw struct {
	Day    string `json:"day"`  // 日期或时间字符串
	Open   string `json:"open"` // 字符串数字
	High   string `json:"high"`
	Low    string `json:"low"`
	Close  string `json:"close"`
	Volume string `json:"volume"`
}

// ---------- 缓存 ----------

// minuteCache 分钟 K 线内存缓存。
//
// key 格式: "{code}:{scale}"，例如 "000001:5"
// value:  *KLineResult
//
// TTL 策略：
//
//	5 分钟线：30 秒（一根 K 线 5 分钟才闭合，30 秒刷新足够）
//	15 分钟线：60 秒
//	30 分钟线：120 秒
//	60 分钟线：180 秒
//	日线：不缓存（走数据库）
var minuteCache = cache.New[*KLineResult]()

// getMinuteTTL 根据 scale 返回缓存 TTL。
func getMinuteTTL(scale string) time.Duration {
	switch scale {
	case "5":
		return 30 * time.Second
	case "15":
		return 60 * time.Second
	case "30":
		return 120 * time.Second
	case "60":
		return 180 * time.Second
	default:
		return 60 * time.Second
	}
}

// ---------- 公开 API ----------

// GetKLine 获取 K 线数据。
//
// 日线（scale="240"）：只调新浪 API，不缓存，调用方负责存/查数据库。
// 分钟线（scale="5"/"15"/"30"/"60"）：先查内存缓存，未命中则调 API 并存缓存。
//
// 参数：
//
//	code  - 纯 6 位股票代码
//	scale - 周期："5"/"15"/"30"/"60"/"240"
//	count - 拉多少根 K 线（默认 100）
func GetKLine(ctx context.Context, code, scale string, count int) (*KLineResult, error) {
	if client == nil {
		return nil, fmt.Errorf("sina 未初始化，请先调用 Init()")
	}
	if count <= 0 {
		count = 100
	}

	// 分钟线：先查内存缓存
	if scale != "240" {
		cacheKey := code + ":" + scale
		if cached, ok := minuteCache.Get(cacheKey); ok {
			return cached, nil
		}

		result, err := fetchKLine(ctx, code, scale, count)
		if err != nil {
			return nil, err
		}
		// 写缓存
		minuteCache.Set(cacheKey, result, getMinuteTTL(scale))
		return result, nil
	}

	// 日线：直接调接口，不缓存
	return fetchKLine(ctx, code, scale, count)
}

// fetchKLine 实际调新浪 API 拉取 K 线。
func fetchKLine(ctx context.Context, code, scale string, count int) (*KLineResult, error) {
	url := buildKLineURL(code, scale, count)

	// 新浪 K 线接口返回 JSON，编码是 UTF-8（apparent_encoding），Get() 自动处理
	resp, err := client.Get(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("新浪K线请求失败: %w", err)
	}

	var raw []sinaKlineRaw
	if err := json.Unmarshal(resp.Body, &raw); err != nil {
		return nil, fmt.Errorf("新浪K线 JSON 解析失败: %w", err)
	}

	if len(raw) == 0 {
		return &KLineResult{Code: code, Scale: scale, Klines: []KLine{}, Count: 0}, nil
	}

	// 将原始数据转为 KLine 结构
	klines := make([]KLine, 0, len(raw))
	for _, r := range raw {
		k := KLine{
			Time:   r.Day,
			Open:   parseFloat(r.Open),
			High:   parseFloat(r.High),
			Low:    parseFloat(r.Low),
			Close:  parseFloat(r.Close),
			Volume: parseInt64(r.Volume),
		}
		klines = append(klines, k)
	}

	return &KLineResult{
		Code:   code,
		Scale:  scale,
		Klines: klines,
		Count:  len(klines),
	}, nil
}

// ---------- 内部工具 ----------

// parseFloat 将字符串转为 float64，解析失败返回 0。
// 新浪 API 返回的数值都是字符串类型。
func parseFloat(s string) float64 {
	var f float64
	fmt.Sscanf(s, "%f", &f)
	return f
}

// parseInt64 将字符串转为 int64，解析失败返回 0。
func parseInt64(s string) int64 {
	var i int64
	fmt.Sscanf(s, "%d", &i)
	return i
}

// ---------- JSON 序列化辅助（debug 用）----------

// MarshalJSON 实现 json.Marshaler，方便调试打印。
func (k KLine) MarshalJSON() ([]byte, error) {
	// 复用默认序列化
	type Alias KLine
	return json.Marshal(&struct{ *Alias }{Alias: (*Alias)(&k)})
}
