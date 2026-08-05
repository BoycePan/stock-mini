// Package cninfo 封装巨潮资讯 API。
// 巨潮是证监会指定信息披露平台，公告权威性最高。
package cninfo

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"

	"wx-app-stock-backend/pkg/cache"
	"wx-app-stock-backend/pkg/fetcher"
)

const queryURL = "http://www.cninfo.com.cn/new/hisAnnouncement/query"

var client *fetcher.DataSource

// announcementCache 公告缓存，TTL 5 分钟
var announcementCache = cache.New[[]Announcement]()

// Init 初始化巨潮资讯数据源。
func Init(rateLimitSec float64, maxRetries, timeoutSec int) {
	client = fetcher.NewCninfoSource()
	if rateLimitSec > 0 {
		client.Limiter = fetcher.NewRateLimiter(time.Duration(rateLimitSec*float64(time.Second)), 1)
	}
	if maxRetries > 0 {
		client.MaxRetries = maxRetries
	}
	if timeoutSec > 0 {
		client.Timeout = time.Duration(timeoutSec) * time.Second
	}
}

// ---------- 数据结构 ----------

// Announcement 公告条目
type Announcement struct {
	ID    string `json:"id"`    // 公告ID
	Title string `json:"title"` // 标题
	Time  string `json:"time"`  // 发布时间 "2026-08-05"
	URL   string `json:"url"`   // 详情页URL
	PDF   string `json:"pdf"`   // PDF附件URL
}

type cninfoResponse struct {
	Announcements []struct {
		AnnouncementID    string `json:"announcementId"`
		AnnouncementTitle string `json:"announcementTitle"`
		AnnouncementTime  int64  `json:"announcementTime"` // 毫秒时间戳
		AdjunctURL        string `json:"adjunctUrl"`
	} `json:"announcements"`
}

// ---------- API ----------

// FetchAnnouncements 获取个股公告列表（带 5 分钟缓存）。
func FetchAnnouncements(ctx context.Context, code string, page, pageSize int) ([]Announcement, error) {
	if client == nil {
		return nil, fmt.Errorf("cninfo 未初始化")
	}
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}

	cacheKey := fmt.Sprintf("%s:%d:%d", code, page, pageSize)
	if cached, ok := announcementCache.Get(cacheKey); ok {
		return cached, nil
	}

	_, orgID, plate := marketInfo(code)

	// POST form-urlencoded
	form := url.Values{}
	form.Set("pageNum", fmt.Sprintf("%d", page))
	form.Set("pageSize", fmt.Sprintf("%d", pageSize))
	form.Set("column", plate)
	form.Set("tabName", "fulltext")
	form.Set("plate", plate)
	form.Set("stock", fmt.Sprintf("%s,%s", code, orgID))
	form.Set("searchkey", "")
	form.Set("secid", "")
	form.Set("category", "")
	form.Set("trade", "")
	form.Set("seDate", "")

	resp, err := client.PostForm(ctx, queryURL, form.Encode())
	if err != nil {
		return nil, fmt.Errorf("巨潮公告请求失败: %w", err)
	}

	var raw cninfoResponse
	if err := json.Unmarshal(resp.Body, &raw); err != nil {
		return nil, fmt.Errorf("巨潮公告JSON解析失败: %w", err)
	}

	items := make([]Announcement, 0, len(raw.Announcements))
	for _, a := range raw.Announcements {
		t := time.UnixMilli(a.AnnouncementTime).Format("2006-01-02")
		items = append(items, Announcement{
			ID:    a.AnnouncementID,
			Title: a.AnnouncementTitle,
			Time:  t,
			URL:   fmt.Sprintf("http://www.cninfo.com.cn/new/disclosure/detail?announcementId=%s", a.AnnouncementID),
			PDF:   "https://static.cninfo.com.cn/" + strings.TrimPrefix(a.AdjunctURL, "/"),
		})
	}

	announcementCache.Set(cacheKey, items, 5*time.Minute)
	return items, nil
}

// marketInfo 返回股票的市场信息和 orgId。
//
//	6xxxxx → sh, gssh0{code}
//	0/3xxxxx → sz, gssz0{code}
func marketInfo(code string) (market, orgID, plate string) {
	if len(code) == 0 {
		return "sh", "", "sh"
	}
	switch code[0] {
	case '6':
		return "sh", "gssh0" + code, "sh"
	default:
		return "sz", "gssz0" + code, "sz"
	}
}
