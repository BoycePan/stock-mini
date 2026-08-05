package repository

import (
	"fmt"

	"github.com/jmoiron/sqlx"
)

// NewsRepo 新闻/公告数据访问。
type NewsRepo struct {
	db *sqlx.DB
}

func NewNewsRepo(db *sqlx.DB) *NewsRepo {
	return &NewsRepo{db: db}
}

// NewsRow 对应 news_feed 表的一行。
type NewsRow struct {
	StockCode   string `db:"stock_code"`
	Title       string `db:"title"`
	Summary     string `db:"summary"`
	URL         string `db:"url"`
	Source      string `db:"source"`
	PublishedAt string `db:"published_at"` // "2026-08-05 10:30" 或 "2026-08-05"
}

// BatchSave 批量插入新闻，冲突（同 stock_code + title + published_at）则跳过。
func (r *NewsRepo) BatchSave(rows []NewsRow) error {
	if len(rows) == 0 {
		return nil
	}

	tx, err := r.db.Beginx()
	if err != nil {
		return fmt.Errorf("开启事务失败: %w", err)
	}
	defer tx.Rollback()

	for _, row := range rows {
		_, err := tx.Exec(`
			INSERT INTO news_feed (stock_code, title, summary, url, source, published_at)
			VALUES ($1, $2, $3, $4, $5, $6::timestamptz)
			ON CONFLICT DO NOTHING
		`, row.StockCode, row.Title, row.Summary, row.URL, row.Source, row.PublishedAt)
		if err != nil {
			return fmt.Errorf("写入新闻失败: %w", err)
		}
	}

	return tx.Commit()
}

// QueryByStock 查询某只股票的历史新闻，按发布时间倒序。
func (r *NewsRepo) QueryByStock(code string, limit int) ([]NewsRow, error) {
	if limit <= 0 {
		limit = 50
	}
	var rows []NewsRow
	err := r.db.Select(&rows, `
		SELECT stock_code, title, summary, url, source,
		       to_char(published_at, 'YYYY-MM-DD HH24:MI') AS published_at
		FROM news_feed
		WHERE stock_code = $1
		ORDER BY published_at DESC
		LIMIT $2
	`, code, limit)
	if err != nil {
		return nil, fmt.Errorf("查询新闻失败: %w", err)
	}
	return rows, nil
}
