// Package eastmoney 封装东方财富 API。
//
// 限流严格（4s/次），不建议全量采集，只做按需补充。
package eastmoney

import (
	"context"
	"fmt"
	"strings"
	"time"

	"wx-app-stock-backend/pkg/fetcher"
)

const klineAPI = "https://push2his.eastmoney.com/api/qt/stock/kline/get"

var client *fetcher.DataSource

// Init 初始化东方财富数据源（main.go 启动时调用一次）。
func Init(rateLimitSec float64, maxRetries, timeoutSec int) {
	client = fetcher.NewEastmoneySource()
	if rateLimitSec > 0 {
		client.Limiter = fetcher.NewRateLimiter(time.Duration(rateLimitSec*float64(time.Second)), 1)
	}
	if maxRetries > 0 {
		client.MaxRetries = maxRetries
	}
	if timeoutSec > 0 {
		client.Timeout = time.Duration(timeoutSec) * time.Second
	}
	client.Referer = "https://quote.eastmoney.com/"
}

// ---------- 数据结构 ----------

// KLine 东财日K线，包含成交额和换手率。
type KLine struct {
	Date     string // 日期 "2026-08-05"
	Open     float64
	Close    float64
	High     float64
	Low      float64
	Volume   int64
	Amount   float64 // ★ 成交额（元）
	Turnover float64 // ★ 换手率（%）
}

// ---------- API ----------

// GetDailyKLine 获取单只股票的日K线（含成交额+换手率）。
//
// secid 转换规则：
//
//	6xxxxx → 1.{code}  (上海)
//	其他   → 0.{code}  (深圳)
func GetDailyKLine(ctx context.Context, code string, count int) ([]KLine, error) {
	if client == nil {
		return nil, fmt.Errorf("eastmoney 未初始化")
	}
	if count <= 0 {
		count = 60
	}

	secid := toSecID(code)
	url := fmt.Sprintf(
		"%s?secid=%s&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20500101&lmt=%d",
		klineAPI, secid, count,
	)

	resp, err := client.Get(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("东财K线请求失败: %w", err)
	}

	return parseKlines(resp.Body)
}

// ---------- 内部解析 ----------

// parseKlines 解析东财 K 线响应。
//
// 返回格式：
//
//	{"data":{"klines":["2024-01-15,10.50,10.80,11.20,10.30,123456,133000000,1.50,3.45,0.10,2.30",...]}}
//
// 每行逗号分隔：[0]日期 [1]开盘 [2]收盘 [3]最高 [4]最低 [5]成交量 [6]成交额 [7]振幅 [8]涨跌幅 [9]涨跌额 [10]换手率
func parseKlines(body []byte) ([]KLine, error) {
	// 简单解析：找 "klines":[ 然后提取字符串数组
	bodyStr := string(body)

	// 定位 klines 数组
	start := strings.Index(bodyStr, `"klines":`)
	if start < 0 {
		return nil, fmt.Errorf("东财响应中没有 klines 字段")
	}

	// 找第一个 [
	start = strings.Index(bodyStr[start:], "[")
	if start < 0 {
		return nil, fmt.Errorf("klines 格式错误")
	}

	// 简单提取：按 " 分隔取出每个 kline 字符串
	rest := bodyStr[start:]
	var result []KLine

	for _, line := range strings.Split(rest, `"`) {
		line = strings.TrimSpace(line)
		if line == "" || line == "[" || line == "]" || line == "," {
			continue
		}
		// line 应该是 "2024-01-15,10.50,..." 格式
		if !strings.Contains(line, ",") {
			continue
		}

		k := parseKlineLine(line)
		if k != nil {
			result = append(result, *k)
		}
	}

	return result, nil
}

// parseKlineLine 解析单行逗号分隔的 K 线数据。
// 字段顺序：[0]日期 [1]开盘 [2]收盘 [3]最高 [4]最低 [5]成交量 [6]成交额 [7]振幅 [8]涨跌幅 [9]涨跌额 [10]换手率
// 注意：收盘在最高/最低前面，和一般习惯不同！
func parseKlineLine(line string) *KLine {
	fields := strings.Split(line, ",")
	if len(fields) < 11 {
		return nil
	}

	return &KLine{
		Date:     fields[0],
		Open:     parseFloat(fields[1]),
		Close:    parseFloat(fields[2]),
		High:     parseFloat(fields[3]),
		Low:      parseFloat(fields[4]),
		Volume:   parseInt64(fields[5]),
		Amount:   parseFloat(fields[6]),
		Turnover: parseFloat(fields[10]),
	}
}

// ---------- 工具 ----------

// toSecID 将 6 位代码转为东财 secid 格式。
//
//	6xxxxx → 1.{code}  (上海)
//	其他   → 0.{code}  (深圳)
func toSecID(code string) string {
	if len(code) > 0 && code[0] == '6' {
		return "1." + code
	}
	return "0." + code
}

func parseFloat(s string) float64 {
	var f float64
	fmt.Sscanf(strings.TrimSpace(s), "%f", &f)
	return f
}

func parseInt64(s string) int64 {
	var i int64
	fmt.Sscanf(strings.TrimSpace(s), "%d", &i)
	return i
}
