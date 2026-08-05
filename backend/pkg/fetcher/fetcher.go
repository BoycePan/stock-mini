// Package fetcher 提供统一的 HTTP 客户端封装，用于调用各股票数据源 API。
//
// 解决的问题：
//  1. 多编码：新浪/巨潮等接口返回 GBK/GB2312/UTF-8，需要自动识别并转 UTF-8
//  2. JSONP 去壳：同花顺、新浪 feed 返回 callback({...})，需要提取纯 JSON
//  3. 重试+退避：网络抖动时自动重试，指数退避（1s → 2s → 4s）
//  4. 限流：各数据源有独立速率限制，避免被封 IP
//  5. 超时控制：避免单次请求卡死整个流程
package fetcher

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"golang.org/x/net/html/charset"
	"golang.org/x/text/transform"
	"golang.org/x/time/rate"
)

// DataSource 代表一个外部数据源，各自有独立的限流器和超时配置。
// 每个数据源一个实例，互不影响。
type DataSource struct {
	Name       string        // 数据源名称，用于日志标识
	BaseURL    string        // 基础 URL（可选）
	Limiter    *rate.Limiter // 令牌桶限流器，控制每秒请求数
	UserAgent  string        // 请求时使用的 User-Agent
	Referer    string        // 请求时使用的 Referer
	Timeout    time.Duration // 单次请求超时时间
	MaxRetries int           // 最大重试次数（不含首次请求）
	RetryBase  time.Duration // 重试退避基础间隔，实际等待 = RetryBase * 2^attempt
}

// FetchResult 是请求返回的统一结构。
type FetchResult struct {
	Body       []byte // 解码后的响应体（已是 UTF-8）
	StatusCode int    // HTTP 状态码
	Headers    http.Header
	Elapsed    time.Duration // 请求耗时
}

// ----- 构造 & 预设 -----

// NewSource 创建一个带默认值的数据源。
// limiter 传 nil 表示不限流。
func NewSource(name string, limiter *rate.Limiter) *DataSource {
	return &DataSource{
		Name:       name,
		Limiter:    limiter,
		UserAgent:  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
		Referer:    "https://finance.sina.com.cn",
		Timeout:    30 * time.Second,
		MaxRetries: 3,
		RetryBase:  1 * time.Second,
	}
}

// NewRateLimiter 创建一个令牌桶限流器。
// interval 是两次请求最小间隔，burst 是突发允许的请求数（通常填 1）。
//
// 例如：NewRateLimiter(4*time.Second, 1) 表示每 4 秒最多发 1 个请求（东方财富）。
func NewRateLimiter(interval time.Duration, burst int) *rate.Limiter {
	return rate.NewLimiter(rate.Every(interval), burst)
}

// ----- 核心方法 -----

// Get 发送 GET 请求，自动处理编码和重试。
//
// 参数：
//
//	ctx  - 用于取消和超时控制
//	url  - 完整 URL（带 query string）
//
// 返回：解码后的 FetchResult，或者最后一次失败的 error
func (s *DataSource) Get(ctx context.Context, url string) (*FetchResult, error) {
	return s.doWithRetry(ctx, http.MethodGet, url, nil)
}

// GetRaw 发送 GET 请求但跳过编码转换，原样返回字节。
// 用于 JSONP 接口（需要先去壳再转 JSON）。
func (s *DataSource) GetRaw(ctx context.Context, url string) (*FetchResult, error) {
	return s.doWithRetryRaw(ctx, http.MethodGet, url, nil)
}

// PostForm 发送 POST 请求，Content-Type=application/x-www-form-urlencoded。
// 用于巨潮资讯等 POST 接口。
func (s *DataSource) PostForm(ctx context.Context, url string, body string) (*FetchResult, error) {
	return s.doWithRetry(ctx, http.MethodPost, url, strings.NewReader(body))
}

// doWithRetry 带重试的请求，自动解码编码。
func (s *DataSource) doWithRetry(ctx context.Context, method, url string, body io.Reader) (*FetchResult, error) {
	var lastErr error
	for attempt := 0; attempt <= s.MaxRetries; attempt++ {
		if attempt > 0 {
			// 指数退避: 1s → 2s → 4s
			wait := s.RetryBase * (1 << (attempt - 1))
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(wait):
			}
		}

		// 等待令牌桶放行（如果设置了限流器）
		if s.Limiter != nil {
			if err := s.Limiter.Wait(ctx); err != nil {
				return nil, err
			}
		}

		result, err := s.doRequest(ctx, method, url, body, true)
		if err == nil {
			return result, nil
		}
		lastErr = err
	}
	return nil, fmt.Errorf("fetcher[%s] 重试%d次后仍然失败: %w", s.Name, s.MaxRetries, lastErr)
}

// doWithRetryRaw 同上但不做编码转换（用于 JSONP）。
func (s *DataSource) doWithRetryRaw(ctx context.Context, method, url string, body io.Reader) (*FetchResult, error) {
	var lastErr error
	for attempt := 0; attempt <= s.MaxRetries; attempt++ {
		if attempt > 0 {
			wait := s.RetryBase * (1 << (attempt - 1))
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(wait):
			}
		}

		if s.Limiter != nil {
			if err := s.Limiter.Wait(ctx); err != nil {
				return nil, err
			}
		}

		result, err := s.doRequest(ctx, method, url, body, false)
		if err == nil {
			return result, nil
		}
		lastErr = err
	}
	return nil, fmt.Errorf("fetcher[%s] 重试%d次后仍然失败: %w", s.Name, s.MaxRetries, lastErr)
}

// doRequest 发起单次 HTTP 请求。
// autoDecode=true 时自动检测编码并转 UTF-8。
func (s *DataSource) doRequest(ctx context.Context, method, url string, body io.Reader, autoDecode bool) (*FetchResult, error) {
	// 如果 body 是 *strings.Reader，需要重新包装（重试时 Reader 已被消耗）
	var bodyBytes []byte
	if body != nil {
		var err error
		bodyBytes, err = io.ReadAll(body)
		if err != nil {
			return nil, fmt.Errorf("读取请求体失败: %w", err)
		}
	}

	req, err := http.NewRequestWithContext(ctx, method, url, nil)
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}

	// 如果有请求体，重新设置
	if bodyBytes != nil {
		req.Body = io.NopCloser(bytes.NewReader(bodyBytes))
		req.ContentLength = int64(len(bodyBytes))
		if method == http.MethodPost {
			req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		}
	}

	// 设置请求头
	if s.UserAgent != "" {
		req.Header.Set("User-Agent", s.UserAgent)
	}
	if s.Referer != "" {
		req.Header.Set("Referer", s.Referer)
	}

	start := time.Now()

	// 每个 DataSource 用自己的 http.Client，方便单独配超时
	client := &http.Client{Timeout: s.Timeout}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()

	elapsed := time.Since(start)

	if autoDecode {
		// 自动检测编码（根据 Content-Type header 或 HTML meta 标签）并转 UTF-8
		utf8Body, err := decodeToUTF8(resp)
		if err != nil {
			return nil, fmt.Errorf("编码转换失败: %w", err)
		}
		return &FetchResult{Body: utf8Body, StatusCode: resp.StatusCode, Headers: resp.Header, Elapsed: elapsed}, nil
	}

	// 不转码，原样读取
	rawBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取响应失败: %w", err)
	}
	return &FetchResult{Body: rawBody, StatusCode: resp.StatusCode, Headers: resp.Header, Elapsed: elapsed}, nil
}

// ----- 编码转换 -----

// decodeToUTF8 自动检测响应的字符编码并转换为 UTF-8。
// golang.org/x/net/html/charset 会根据 Content-Type 和 HTML meta 标签推断编码。
func decodeToUTF8(resp *http.Response) ([]byte, error) {
	// charset.DetermineEncoding 读取前 1024 字节判断编码
	// 返回的 reader 会包含全部内容（已预读的部分 + 剩余部分），且已做解码
	utf8Reader, err := charset.NewReader(resp.Body, resp.Header.Get("Content-Type"))
	if err != nil {
		return nil, fmt.Errorf("检测编码失败: %w", err)
	}
	return io.ReadAll(utf8Reader)
}

// ----- JSONP 处理 -----

// StripJSONP 从 JSONP 响应中提取纯 JSON。
func StripJSONP(raw []byte) ([]byte, error) {
	s := strings.TrimSpace(string(raw))

	if strings.HasPrefix(s, "[") || strings.HasPrefix(s, "{") {
		return []byte(s), nil
	}

	// 找第一个 {，然后找匹配的 }（简单括号计数）
	s = strings.TrimPrefix(s, "try{")
	start := strings.Index(s, "{")
	if start < 0 {
		return nil, fmt.Errorf("无法解析 JSONP 格式: %s", s[:min(len(s), 80)])
	}

	// 从第一个 { 开始计数括号，找到匹配的 }
	depth := 0
	for i := start; i < len(s); i++ {
		switch s[i] {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return []byte(s[start : i+1]), nil
			}
		}
	}

	return nil, fmt.Errorf("JSONP 括号不匹配")
}

// ----- 编码快捷转换 -----

// DecodeBytes 手动将字节从指定编码转为 UTF-8。
// 用于已知编码的场景（如新浪实时行情固定 GBK）。
//
// encoding 取值：gbk, gb2312, gb18030（golang.org/x/text 支持的中文编码）
func DecodeBytes(raw []byte, encoding string) ([]byte, error) {
	enc, _ := charset.Lookup(encoding)
	if enc == nil {
		return raw, nil // 无法识别编码则不转换，原样返回
	}
	reader := transform.NewReader(bytes.NewReader(raw), enc.NewDecoder())
	return io.ReadAll(reader)
}

// ----- 数据源预设（预定义常用源的配置） -----

// NewSinaSource 新浪财经数据源：间隔 1s，重试 3 次
func NewSinaSource() *DataSource {
	s := NewSource("sina", NewRateLimiter(1*time.Second, 1))
	s.MaxRetries = 3
	return s
}

// NewEastmoneySource 东方财富数据源：间隔 4s，重试 5 次（最严格）
func NewEastmoneySource() *DataSource {
	s := NewSource("eastmoney", NewRateLimiter(4*time.Second, 1))
	s.MaxRetries = 5
	return s
}

// NewEastmoneySearchSource 东方财富搜索接口：间隔 0.5s（比 K 线接口宽松）
func NewEastmoneySearchSource() *DataSource {
	s := NewSource("eastmoney_search", NewRateLimiter(500*time.Millisecond, 1))
	s.MaxRetries = 1
	return s
}

// NewCninfoSource 巨潮资讯数据源：不限流（官方平台，但单线程调用）
func NewCninfoSource() *DataSource {
	s := NewSource("cninfo", nil)
	s.UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
	s.Referer = "http://www.cninfo.com.cn/"
	s.MaxRetries = 1
	return s
}

// NewTHSSource 同花顺数据源：间隔 0.5s，失败冷却 3s
// 注意：同花顺有 TLS 指纹检测，可能需要额外处理
func NewTHSSource() *DataSource {
	s := NewSource("10jqka", NewRateLimiter(500*time.Millisecond, 1))
	s.Referer = "https://q.10jqka.com.cn/"
	s.MaxRetries = 3
	s.RetryBase = 2 * time.Second
	return s
}
