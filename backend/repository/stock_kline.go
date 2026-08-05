package repository

import (
	"fmt"
	"time"

	"wx-app-stock-backend/model"

	"github.com/jmoiron/sqlx"
)

// StockKLineRepo stock_kline 表的数据库操作。
//
// sqlx 的 NamedExec 可以根据 struct tag 自动映射字段，
// 比手写 VALUES($1,$2,$3...) 更安全、更易维护。
type StockKLineRepo struct {
	db *sqlx.DB
}

func NewStockKLineRepo(db *sqlx.DB) *StockKLineRepo {
	return &StockKLineRepo{db: db}
}

// BatchUpsert 批量插入或更新 K 线数据。
//
// PostgreSQL 的 ON CONFLICT 语法：当 (code, scale, trade_date) 冲突时，
// 更新价格和成交量字段（收盘后数据一般不变，但偶尔会有修正）。
//
// sqlx.Named 会根据 struct 的 `db` tag 生成 INSERT 语句的列名和占位符，
// 例如 INSERT INTO stock_kline (code,scale,trade_date,open,...) VALUES (:code,:scale,...)
func (r *StockKLineRepo) BatchUpsert(klines []model.StockKLine) error {
	if len(klines) == 0 {
		return nil
	}

	// ON CONFLICT ... DO UPDATE: 冲突时更新所有价格字段
	query := `
		INSERT INTO stock_kline (
			code, scale, trade_date, open, high, low, close,
			volume, amount, turnover, pct_change, change_amt, amplitude, created_at
		) VALUES (
			:code, :scale, :trade_date, :open, :high, :low, :close,
			:volume, :amount, :turnover, :pct_change, :change_amt, :amplitude, :created_at
		)
		ON CONFLICT (code, scale, trade_date) DO UPDATE SET
			open       = EXCLUDED.open,
			high       = EXCLUDED.high,
			low        = EXCLUDED.low,
			close      = EXCLUDED.close,
			volume     = EXCLUDED.volume,
			amount     = EXCLUDED.amount,
			turnover   = EXCLUDED.turnover,
			pct_change = EXCLUDED.pct_change,
			change_amt = EXCLUDED.change_amt,
			amplitude  = EXCLUDED.amplitude,
			created_at = EXCLUDED.created_at
	`

	// 使用事务批量执行，避免逐条提交的性能损耗
	tx, err := r.db.Beginx()
	if err != nil {
		return fmt.Errorf("开启事务失败: %w", err)
	}
	defer tx.Rollback() // 如果没 Commit，Rollback 是安全的 no-op

	for i := range klines {
		klines[i].CreatedAt = time.Now()
		if _, err := tx.NamedExec(query, klines[i]); err != nil {
			return fmt.Errorf("批量写入第%d条失败(code=%s): %w", i+1, klines[i].Code, err)
		}
	}

	return tx.Commit()
}

// QueryByCode 查询某只股票指定周期的 K 线。
// limit 控制返回条数，倒序拿最新数据。
func (r *StockKLineRepo) QueryByCode(code, scale string, limit int) ([]model.StockKLine, error) {
	var klines []model.StockKLine
	err := r.db.Select(&klines,
		`SELECT * FROM stock_kline
		 WHERE code=$1 AND scale=$2
		 ORDER BY trade_date DESC LIMIT $3`,
		code, scale, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("查询K线失败(code=%s): %w", code, err)
	}
	return klines, nil
}

// GetLatestDate 获取某只股票在库中最新的交易日期。
// 返回空字符串表示库中无数据。
func (r *StockKLineRepo) GetLatestDate(code, scale string) (string, error) {
	var date string
	err := r.db.Get(&date,
		`SELECT trade_date FROM stock_kline
		 WHERE code=$1 AND scale=$2
		 ORDER BY trade_date DESC LIMIT 1`,
		code, scale,
	)
	if err != nil {
		// sql.ErrNoRows 在 sqlx 中表现为 err == sql.ErrNoRows
		// 没有数据不算错误，返回空字符串
		return "", nil
	}
	return date, nil
}
