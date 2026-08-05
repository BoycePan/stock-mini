package ths

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"wx-app-stock-backend/pkg/cache"

	"wx-app-stock-backend/pkg/fetcher"
)

// ---------- 数据结构 ----------

// BoardInfo 概念板块基本信息。
type BoardInfo struct {
	Cid       int     `json:"cid"`        // 同花顺概念ID
	PlateCode string  `json:"plate_code"` // 板块代码，如 "885333"
	PlateName string  `json:"plate_name"` // 板块名称，如 "人工智能"
	PctChg    float64 `json:"pct_chg"`    // 当日涨跌幅(%)
}

// BoardKLine 板块日K线。
type BoardKLine struct {
	Date   string  `json:"date"`
	Open   float64 `json:"open"`
	High   float64 `json:"high"`
	Low    float64 `json:"low"`
	Close  float64 `json:"close"`
	Volume int64   `json:"volume"`
	Amount float64 `json:"amount"` // 成交额(元)
}

// boardKlineCache 板块K线缓存，TTL 60s
var boardKlineCache = cache.New[[]BoardKLine]()

// ---------- API ----------

// FetchBoardList 拉取概念板块列表，按涨跌幅降序取前 topN 个。
func FetchBoardList(ctx context.Context, topN int) ([]BoardInfo, error) {
	if client == nil {
		return nil, fmt.Errorf("ths 未初始化")
	}
	if topN <= 0 {
		topN = 60
	}

	resp, err := client.Get(ctx, boardListURL)
	if err != nil {
		return nil, fmt.Errorf("拉取板块列表失败: %w", err)
	}

	boards, err := parseBoardList(resp.Body)
	if err != nil {
		return nil, err
	}

	// 按涨跌幅降序排列
	sort.Slice(boards, func(i, j int) bool {
		return boards[i].PctChg > boards[j].PctChg
	})

	if len(boards) > topN {
		boards = boards[:topN]
	}

	return boards, nil
}

// FetchBoardKLine 拉取板块日K线（最近 N 根）。
func FetchBoardKLine(ctx context.Context, plateCode string, count int) ([]BoardKLine, error) {
	if client == nil {
		return nil, fmt.Errorf("ths 未初始化")
	}
	if count <= 0 {
		count = 30
	}

	cacheKey := fmt.Sprintf("%s:%d", plateCode, count)
	if cached, ok := boardKlineCache.Get(cacheKey); ok {
		return cached, nil
	}

	url := buildKlineURL(plateCode)
	resp, err := client.GetRaw(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("拉取板块K线失败(%s): %w", plateCode, err)
	}

	jsonBytes, err := fetcher.StripJSONP(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("板块K线JSONP解析失败: %w", err)
	}

	klines, err := parseBoardKLine(jsonBytes, count)
	if err != nil {
		return nil, err
	}
	boardKlineCache.Set(cacheKey, klines, 60*time.Second)
	return klines, nil
}

// FetchMembers 拉取概念板块成分股（返回 6 位股票代码）。
func FetchMembers(ctx context.Context, cid int) ([]string, error) {
	if client == nil {
		return nil, fmt.Errorf("ths 未初始化")
	}

	url := buildMembersURL(cid)
	resp, err := client.Get(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("拉取成分股失败(cid=%d): %w", cid, err)
	}

	return parseMembers(string(resp.Body)), nil
}

// ---------- 解析函数 ----------

// gnSectionPattern 匹配 HTML 中 id="gnSection" 的 value 属性。
var gnSectionPattern = regexp.MustCompile(`id="gnSection"[^>]*value='([^']*)'`)

// parseBoardList 从板块首页 HTML 中提取板块列表 JSON。
func parseBoardList(html []byte) ([]BoardInfo, error) {
	matches := gnSectionPattern.FindSubmatch(html)
	if len(matches) < 2 {
		return nil, fmt.Errorf("未找到 gnSection 字段")
	}

	// 字段值是 JSON object，key 是序号
	// 注意：cid 在 JSON 中是字符串 "300188"，但 BoardInfo.Cid 是 int
	var raw map[string]struct {
		PlateCode string  `json:"platecode"`
		PlateName string  `json:"platename"`
		Cid       string  `json:"cid"`    // JSON 里是字符串
		PctChg    float64 `json:"199112"` // 涨跌幅字段名是数字
	}

	if err := json.Unmarshal(matches[1], &raw); err != nil {
		return nil, fmt.Errorf("板块列表JSON解析失败: %w", err)
	}

	var boards []BoardInfo
	for _, v := range raw {
		cid := 0
		fmt.Sscanf(v.Cid, "%d", &cid)
		boards = append(boards, BoardInfo{
			Cid:       cid,
			PlateCode: v.PlateCode,
			PlateName: v.PlateName,
			PctChg:    v.PctChg,
		})
	}

	return boards, nil
}

// parseBoardKLine 解析板块K线JSON。
//
// 原始格式: {"data": "20240701,2082.87,2165.45,2082.87,2149.13,2455052600,39598884000;..."}
// K线字段: date, open, high, low, close, volume, amount（7个字段）
func parseBoardKLine(jsonBytes []byte, count int) ([]BoardKLine, error) {
	var raw struct {
		Data string `json:"data"`
	}
	if err := json.Unmarshal(jsonBytes, &raw); err != nil {
		return nil, fmt.Errorf("板块K线JSON解析失败: %w", err)
	}

	if raw.Data == "" {
		return nil, nil
	}

	lines := strings.Split(raw.Data, ";")
	var klines []BoardKLine

	// 从后往前取（最新的在最后）
	start := len(lines) - count
	if start < 0 {
		start = 0
	}

	for _, line := range lines[start:] {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		parts := strings.Split(line, ",")
		if len(parts) < 7 {
			continue
		}

		// date: YYYYMMDD → YYYY-MM-DD
		date := parts[0]
		if len(date) == 8 {
			date = date[:4] + "-" + date[4:6] + "-" + date[6:8]
		}

		klines = append(klines, BoardKLine{
			Date:   date,
			Open:   parseFloat(parts[1]),
			High:   parseFloat(parts[2]),
			Low:    parseFloat(parts[3]),
			Close:  parseFloat(parts[4]),
			Volume: parseInt64(parts[5]),
			Amount: parseFloat(parts[6]),
		})
	}

	return klines, nil
}

// stockCodePattern 匹配 HTML 中 <td><a>XXXXXX</a></td> 包裹的 6 位股票代码
var stockCodePattern = regexp.MustCompile(`<td[^>]*>\s*<a[^>]*>\s*(\d{6})\s*</a>\s*</td>`)

// parseMembers 从成分股HTML页面提取股票代码。
// 只保留 0/3/6 开头的A股代码。
func parseMembers(html string) []string {
	seen := make(map[string]bool)
	var codes []string

	for _, match := range stockCodePattern.FindAllStringSubmatch(html, -1) {
		if len(match) < 2 {
			continue
		}
		code := match[1]
		if seen[code] || len(code) != 6 {
			continue
		}
		// 只保留A股: 0/3/6 开头
		if code[0] == '0' || code[0] == '3' || code[0] == '6' {
			seen[code] = true
			codes = append(codes, code)
		}
	}

	return codes
}

// ---------- 工具 ----------

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
