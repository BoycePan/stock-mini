package sina

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"time"

	"wx-app-stock-backend/pkg/fetcher"
)

// ---------- 数据结构 ----------

// StockInfo 股票基本信息（对应 stock_info 表）。
type StockInfo struct {
	Code     string `json:"code"`     // 6 位代码
	Name     string `json:"name"`     // 股票名称
	Market   string `json:"market"`   // sh / sz / bj
	Board    string `json:"board"`    // main / chinext / star（由代码前缀推断）
	Industry string `json:"industry"` // 行业分类（来自行业 API）
}

// sinaStockRaw 新浪股票列表 API 返回的原始记录。
type sinaStockRaw struct {
	Code string `json:"code"` // 可能不足 6 位，如 "1"
	Name string `json:"name"`
}

// ---------- API ----------

// FetchStockList 从新浪拉取沪深 A 股全量股票列表。
//
// 接口分页，沪市 (sh_a) 和深市 (sz_a) 分别拉，每页 80 条。
// 间隔 150ms 避免被限流（EXTERNAL_API_ANALYSIS.md 2.2节）。
//
// 返回 stock_info 格式的结构，其中 Industry 字段为空（需要单独调行业 API）。
func FetchStockList(ctx context.Context) ([]StockInfo, error) {
	if client == nil {
		return nil, fmt.Errorf("sina 未初始化，请先调用 Init()")
	}

	var all []StockInfo

	// 沪市 (sh_a) 和深市 (sz_a) 分别拉取
	for _, node := range []string{"sh_a", "sz_a"} {
		for page := 1; page < 100; page++ { // 最多 100 页，足够覆盖全市场
			url := fmt.Sprintf(
				"%s?page=%d&num=80&sort=symbol&asc=1&node=%s&symbol=&_s_r_a=auto",
				stockListURL, page, node,
			)

			resp, err := client.Get(ctx, url)
			if err != nil {
				return nil, fmt.Errorf("拉取股票列表失败(node=%s, page=%d): %w", node, page, err)
			}

			var raw []sinaStockRaw
			if err := json.Unmarshal(resp.Body, &raw); err != nil {
				return nil, fmt.Errorf("解析股票列表 JSON 失败: %w", err)
			}

			if len(raw) == 0 {
				break
			}

			for _, r := range raw {
				// code 补零到 6 位
				code := fmt.Sprintf("%06s", r.Code)
				all = append(all, StockInfo{
					Code:   code,
					Name:   r.Name,
					Market: marketFromCode(code),
					Board:  boardFromCode(code),
				})
			}

			// 页数不足 80 说明是最后一页
			if len(raw) < 80 {
				break
			}

			// 间隔 150ms（EXTERNAL_API_ANALYSIS.md 原文: time.sleep(0.15)）
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(150 * time.Millisecond):
			}
		}
	}

	return all, nil
}

// FetchIndustryMap 拉取行业分类映射（新浪老接口，GBK 编码）。
//
// 返回 map[code]industry，例如 {"600001": "银行"}。
//
// 解析方式：正则 new_XXXX:"X,行业名,X,..." → parts[1]=行业名, parts[8:]+=股票
// 文档：EXTERNAL_API_ANALYSIS.md 2.3节
func FetchIndustryMap(ctx context.Context) (map[string]string, error) {
	if client == nil {
		return nil, fmt.Errorf("sina 未初始化，请先调用 Init()")
	}

	// 行业接口固定 GBK，用 GetRaw 拿原始字节再手动解码
	resp, err := client.GetRaw(ctx, industryURL)
	if err != nil {
		return nil, fmt.Errorf("拉取行业分类失败: %w", err)
	}

	// GBK → UTF-8
	utf8Body, err := decodeGBKLocal(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("行业分类编码转换失败: %w", err)
	}

	return parseIndustryHTML(string(utf8Body)), nil
}

// ---------- 内部解析 ----------

// newSinaHyPattern 匹配 new_XXXX:"内容" 条目
// 每组: "new_\w+":"([^"]+)"
var newSinaHyPattern = regexp.MustCompile(`"new_\w+":"([^"]+)"`)

// parseIndustryHTML 从 HTML 正文中提取行业→股票映射。
//
// 每行格式: new_XXXX:"X,行业名,X,X,X,X,X,X,sh600001,股票名,价格,涨跌幅,..."
//
//   - parts[1]  = 行业名
//   - parts[8:] = 每 4 字段一组: (代码, 名称, 价格, 涨跌幅)
//   - 代码去掉 sh/sz/bj 前缀，补零到 6 位
func parseIndustryHTML(html string) map[string]string {
	result := make(map[string]string)

	matches := newSinaHyPattern.FindAllStringSubmatch(html, -1)
	for _, m := range matches {
		if len(m) < 2 {
			continue
		}
		content := m[1] // 引号内逗号分隔的完整行

		parts := splitCSV(content)
		if len(parts) < 9 {
			continue
		}

		industry := parts[1]

		// parts[8:] 每 4 个一组是 (代码, 名称, 价格, 涨跌幅)
		for i := 8; i+3 < len(parts); i += 4 {
			rawCode := parts[i]
			// 去掉 sh/sz/bj 前缀
			code := stripMarketPrefix(rawCode)
			// 补零到 6 位
			code = fmt.Sprintf("%06s", code)
			result[code] = industry
		}
	}

	return result
}

// splitCSV 简单按逗号切分 CSV 行（不处理引号内逗号，够用就行）。
func splitCSV(line string) []string {
	parts := make([]string, 0)
	for _, s := range regexp.MustCompile(",").Split(line, -1) {
		parts = append(parts, s)
	}
	return parts
}

// stripMarketPrefix 去掉 sh_/sz_/bj 前缀，只保留纯代码部分。
// 例: "sh600001" → "600001"
func stripMarketPrefix(s string) string {
	if len(s) > 2 && (s[:2] == "sh" || s[:2] == "sz" || s[:2] == "bj") {
		return s[2:]
	}
	return s
}

// ---------- 工具函数 ----------

// marketFromCode 根据首位判断市场。
//
//	6 → sh (上海)
//	0/3 → sz (深圳)
//	4/8 → bj (北京/新三板)
func marketFromCode(code string) string {
	if len(code) == 0 {
		return ""
	}
	switch code[0] {
	case '6', '9':
		return "sh"
	case '0', '3':
		return "sz"
	case '4', '8':
		return "bj"
	default:
		return ""
	}
}

// boardFromCode 根据代码前缀判断板块。
//
//	300xxx → chinext (创业板)
//	688xxx → star（科创板）
//	其他   → main（主板）
func boardFromCode(code string) string {
	if len(code) < 3 {
		return "main"
	}
	switch {
	case code[:3] == "300", code[:3] == "301":
		return "chinext"
	case code[:3] == "688":
		return "star"
	default:
		return "main"
	}
}

// decodeGBKLocal 本地 GBK 解码（调用 fetcher.DecodeBytes）。
func decodeGBKLocal(raw []byte) ([]byte, error) {
	// fetcher.DecodeBytes 使用 golang.org/x/text 的编码表
	return fetcher.DecodeBytes(raw, "gbk")
}
