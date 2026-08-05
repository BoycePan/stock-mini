package handler

import (
	"strconv"

	"wx-app-stock-backend/pkg/cninfo"
	"wx-app-stock-backend/pkg/errcode"
	"wx-app-stock-backend/pkg/response"
	"wx-app-stock-backend/pkg/sina"
	"wx-app-stock-backend/repository"

	"github.com/gin-gonic/gin"
)

// NewsHandler 新闻接口处理器。
type NewsHandler struct {
	newsRepo *repository.NewsRepo
}

func NewNewsHandler(newsRepo *repository.NewsRepo) *NewsHandler {
	return &NewsHandler{newsRepo: newsRepo}
}

// StockNews GET /api/v1/stock/:code/news?page=1
// 获取个股相关新闻（新浪个股新闻页）。
func (h *NewsHandler) StockNews(c *gin.Context) {
	code := c.Param("code")
	if code == "" {
		response.Error(errcode.InvalidParam, "股票代码不能为空").Write(c)
		return
	}

	page := 1
	if p, err := strconv.Atoi(c.DefaultQuery("page", "1")); err == nil && p > 0 {
		page = p
	}

	items, err := sina.FetchStockNews(c.Request.Context(), code, page)
	if err != nil {
		response.Error(errcode.ServerError, err.Error()).Write(c)
		return
	}

	// 异步存库
	go h.saveNews(code, items)

	response.Success(gin.H{
		"code":  code,
		"count": len(items),
		"news":  items,
	}).Write(c)
}

// FeedNews GET /api/v1/news/feed?q=A股&count=20
// 通用财经新闻（新浪 feed）。
func (h *NewsHandler) FeedNews(c *gin.Context) {
	q := c.DefaultQuery("q", "A股")
	count := 20
	if n, err := strconv.Atoi(c.DefaultQuery("count", "20")); err == nil && n > 0 && n <= 100 {
		count = n
	}

	items, err := sina.FetchFeedNews(c.Request.Context(), q, count)
	if err != nil {
		response.Error(errcode.ServerError, err.Error()).Write(c)
		return
	}

	// 异步存库（stock_code 为空 = 通用新闻）
	go h.saveNews("", items)

	response.Success(gin.H{
		"keyword": q,
		"count":   len(items),
		"news":    items,
	}).Write(c)
}

// Announcements GET /api/v1/stock/:code/announcements?page=1&size=20
// 获取个股公告（巨潮资讯）。
func (h *NewsHandler) Announcements(c *gin.Context) {
	code := c.Param("code")
	if code == "" {
		response.Error(errcode.InvalidParam, "股票代码不能为空").Write(c)
		return
	}

	page := 1
	if p, err := strconv.Atoi(c.DefaultQuery("page", "1")); err == nil && p > 0 {
		page = p
	}
	size := 20
	if s, err := strconv.Atoi(c.DefaultQuery("size", "20")); err == nil && s > 0 && s <= 100 {
		size = s
	}

	items, err := cninfo.FetchAnnouncements(c.Request.Context(), code, page, size)
	if err != nil {
		response.Error(errcode.ServerError, err.Error()).Write(c)
		return
	}

	// 异步存库
	go h.saveNews(code, items)

	response.Success(gin.H{
		"code":  code,
		"page":  page,
		"count": len(items),
		"items": items,
	}).Write(c)
}

// saveNews 异步保存新闻到 news_feed 表（自动去重）。
func (h *NewsHandler) saveNews(code string, items interface{}) {
	var rows []repository.NewsRow
	switch v := items.(type) {
	case []sina.NewsItem:
		for _, n := range v {
			rows = append(rows, repository.NewsRow{
				StockCode:   code,
				Title:       n.Title,
				Summary:     n.Summary,
				URL:         n.URL,
				Source:      n.Source,
				PublishedAt: n.Time,
			})
		}
	case []cninfo.Announcement:
		for _, a := range v {
			rows = append(rows, repository.NewsRow{
				StockCode:   code,
				Title:       a.Title,
				URL:         a.URL,
				Source:      "巨潮资讯",
				PublishedAt: a.Time,
			})
		}
	}
	if len(rows) > 0 {
		h.newsRepo.BatchSave(rows)
	}
}
