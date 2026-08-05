// Package model 定义数据库表对应的结构体。
//
// Go 的 ORM 不是主流方式，这里用 sqlx 的 struct tag 直接映射列名。
// `db:"column_name"` 告诉 sqlx 如何把数据库列映射到 struct 字段。
// `json:"field_name"` 告诉 Gin 如何序列化 JSON。
package model

import "time"

// StockKLine 对应 stock_kline 表。
// 主键：(Code, Scale, TradeDate)
//
// 注意：TradeDate 用 time.Time 是因为 pgx 驱动把 PostgreSQL DATE 类型扫成 time.Time。
// API 返回时在 handler 层格式化为 "2006-01-02"。
type StockKLine struct {
	Code      string    `db:"code"       json:"code"`       // 股票/指数代码
	Scale     string    `db:"scale"      json:"scale"`      // 1d/1w/1mon
	TradeDate time.Time `db:"trade_date" json:"-"`          // 交易日期（pgx 扫出来是 time.Time, json:"-" 不直接暴露）
	Open      float64   `db:"open"       json:"open"`       // 开盘价
	High      float64   `db:"high"       json:"high"`       // 最高价
	Low       float64   `db:"low"        json:"low"`        // 最低价
	Close     float64   `db:"close"      json:"close"`      // 收盘价
	Volume    int64     `db:"volume"     json:"volume"`     // 成交量（股）
	Amount    float64   `db:"amount"     json:"amount"`     // 成交额（元），新浪日线不返回，需东财补充
	Turnover  float64   `db:"turnover"   json:"turnover"`   // 换手率（%），同上
	PctChange float64   `db:"pct_change" json:"pct_change"` // 涨跌幅（%），本地计算
	ChangeAmt float64   `db:"change_amt" json:"change_amt"` // 涨跌额，本地计算
	Amplitude float64   `db:"amplitude"  json:"amplitude"`  // 振幅（%），本地计算
	CreatedAt time.Time `db:"created_at" json:"-"`          // 入库时间（不暴露给前端）
}

// StockInfo 对应 stock_info 表。
type StockInfo struct {
	Code      string    `db:"code"       json:"code"`      // 6 位代码
	Name      string    `db:"name"       json:"name"`      // 股票名称
	Type      string    `db:"type"       json:"type"`      // stock/index
	Market    string    `db:"market"     json:"market"`    // sh/sz/bj
	Board     string    `db:"board"      json:"board"`     // main/chinext/star
	Industry  string    `db:"industry"   json:"industry"`  // 行业分类
	IsActive  bool      `db:"is_active"  json:"is_active"` // 是否活跃
	UpdatedAt time.Time `db:"updated_at" json:"-"`         // 更新时间
}
