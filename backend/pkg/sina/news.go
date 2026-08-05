package sina

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"wx-app-stock-backend/pkg/cache"
	"wx-app-stock-backend/pkg/fetcher"
)

// ---------- 缓存 ----------

// stockNewsCache 个股新闻缓存，TTL 60s
var stockNewsCache = cache.New[[]NewsItem]()

// feedNewsCache 通用新闻缓存，TTL 30s
var feedNewsCache = cache.New[[]NewsItem]()

// ---------- 数据结构 ----------

// NewsItem 新闻条目
type NewsItem struct {
	Title   string `json:"title"`   // 标题
	Summary string `json:"summary"` // 摘要
	URL     string `json:"url"`     // 原文链接
	Time    string `json:"time"`    // 发布时间 "2026-08-05 10:30"
	Source  string `json:"source"`  // 来源
}

// ---------- API ----------

// FetchStockNews 获取个股新闻（带 60s 缓存）。
func FetchStockNews(ctx context.Context, code string, page int) ([]NewsItem, error) {
	if client == nil {
		return nil, fmt.Errorf("sina 未初始化")
	}
	if page <= 0 {
		page = 1
	}

	cacheKey := fmt.Sprintf("stock:%s:%d", code, page)
	if cached, ok := stockNewsCache.Get(cacheKey); ok {
		return cached, nil
	}

	url := fmt.Sprintf(
		"http://vip.stock.finance.sina.com.cn/corp/view/vCB_AllNewsStock.php?symbol=%s&Page=%d",
		toSymbol(code), page,
	)

	// 个股新闻页是 GB2312，用 GetRaw 拿原始字节再手动解码
	resp, err := client.GetRaw(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("个股新闻请求失败: %w", err)
	}

	utf8Body, err := fetcher.DecodeBytes(resp.Body, "gbk")
	if err != nil {
		return nil, fmt.Errorf("个股新闻解码失败: %w", err)
	}

	items := parseStockNews(string(utf8Body))
	stockNewsCache.Set(cacheKey, items, 60*time.Second)
	return items, nil
}

// FetchFeedNews 获取通用财经新闻（带 30s 缓存）。
func FetchFeedNews(ctx context.Context, keyword string, count int) ([]NewsItem, error) {
	if client == nil {
		return nil, fmt.Errorf("sina 未初始化")
	}
	if count <= 0 {
		count = 20
	}

	cacheKey := fmt.Sprintf("feed:%s:%d", keyword, count)
	if cached, ok := feedNewsCache.Get(cacheKey); ok {
		return cached, nil
	}

	url := fmt.Sprintf(
		"https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2516&k=%s&num=%d&page=1&r=%d&callback=jsonp",
		keyword, count, time.Now().UnixMilli(),
	)

	resp, err := client.GetRaw(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("新闻feed请求失败: %w", err)
	}

	// JSONP 去壳
	jsonBytes, err := fetcher.StripJSONP(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("新闻feed JSONP解析失败: %w\n原始内容: %s", err, string(resp.Body[:min(len(resp.Body), 200)]))
	}

	items := parseFeedNews(jsonBytes)
	feedNewsCache.Set(cacheKey, items, 30*time.Second)
	return items, nil
}

// ---------- 解析 ----------

// stockNewsPattern 个股新闻页正则
// 格式: 2024-01-15&nbsp;10:30&nbsp;&nbsp;<a href="...">新闻标题</a>
var stockNewsPattern = regexp.MustCompile(
	`(\d{4}-\d{2}-\d{2})&nbsp;(\d{2}:\d{2})&nbsp;&nbsp;<a[^>]*href=['\"]([^'\"]+)['\"][^>]*>([^<]+)</a>`,
)

func parseStockNews(html string) []NewsItem {
	var items []NewsItem
	matches := stockNewsPattern.FindAllStringSubmatch(html, -1)

	for _, m := range matches {
		if len(m) < 5 {
			continue
		}
		items = append(items, NewsItem{
			Title:  strings.TrimSpace(m[4]),
			Time:   m[1] + " " + m[2],
			URL:    m[3],
			Source: "新浪",
		})
	}

	return items
}

// feedResponse 新浪 feed 接口的 JSON 结构
type feedResponse struct {
	Result struct {
		Data []struct {
			Title  string `json:"title"`
			Intro  string `json:"intro"`
			Ctime  string `json:"ctime"` // Unix 时间戳（秒）
			URL    string `json:"url"`
			Source string `json:"media_name"`
		} `json:"data"`
	} `json:"result"`
}

func parseFeedNews(jsonBytes []byte) []NewsItem {
	var resp map[string]interface{}
	if err := json.Unmarshal(jsonBytes, &resp); err != nil {
		return nil
	}

	result, ok := resp["result"].(map[string]interface{})
	if !ok {
		return nil
	}

	// data 可能是 []interface{} 数组
	rawData := result["data"]
	if rawData == nil {
		return nil
	}

	dataList, ok := rawData.([]interface{})
	if !ok {
		return nil
	}

	var items []NewsItem
	for _, item := range dataList {
		d, ok := item.(map[string]interface{})
		if !ok {
			continue
		}

		title, _ := d["title"].(string)
		intro, _ := d["intro"].(string)
		url, _ := d["url"].(string)
		source, _ := d["media_name"].(string)
		if source == "" {
			source = "新浪财经"
		}

		ctimeStr := ""
		switch v := d["ctime"].(type) {
		case string:
			if ts, err := strconv.ParseInt(v, 10, 64); err == nil {
				ctimeStr = time.Unix(ts, 0).Format("2006-01-02 15:04")
			}
		case float64:
			ctimeStr = time.Unix(int64(v), 0).Format("2006-01-02 15:04")
		}

		items = append(items, NewsItem{
			Title:   title,
			Summary: intro,
			URL:     url,
			Time:    ctimeStr,
			Source:  source,
		})
	}

	return items
}
