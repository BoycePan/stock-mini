// Package ths 封装同花顺(10jqka) API。
//
// 限流 0.5s/次，建议只做板块数据（股票K线走新浪）。
package ths

import (
	"fmt"
	"time"

	"wx-app-stock-backend/pkg/fetcher"
)

const (
	// 概念板块列表页，页面里藏了 id="gnSection" 的隐藏字段
	boardListURL = "https://q.10jqka.com.cn/gn/"

	// 板块K线 JSONP 接口
	// URL 模板: https://d.10jqka.com.cn/v4/line/bk_{platecode}/01/last.js
	klineURL = "https://d.10jqka.com.cn/v4/line/bk_%s/01/last.js"

	// 成分股列表（HTML页面）
	// URL 模板: http://q.10jqka.com.cn/gn/detail/order/desc/page/1/size/200/code/{cid}/
	membersURL = "http://q.10jqka.com.cn/gn/detail/order/desc/page/1/size/200/code/%d/"
)

var client *fetcher.DataSource

// Init 初始化同花顺数据源。
func Init(rateLimitSec float64, maxRetries, timeoutSec int) {
	client = fetcher.NewTHSSource()
	if rateLimitSec > 0 {
		client.Limiter = fetcher.NewRateLimiter(time.Duration(rateLimitSec*float64(time.Second)), 1)
	}
	if maxRetries > 0 {
		client.MaxRetries = maxRetries
	}
	if timeoutSec > 0 {
		client.Timeout = time.Duration(timeoutSec) * time.Second
	}
	client.Referer = "https://q.10jqka.com.cn/"
}

// buildKlineURL 拼接板块K线URL。
func buildKlineURL(plateCode string) string {
	return fmt.Sprintf(klineURL, plateCode)
}

// buildMembersURL 拼接成分股URL。
func buildMembersURL(cid int) string {
	return fmt.Sprintf(membersURL, cid)
}
