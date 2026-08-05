package repository

import (
	"fmt"
	"time"

	"wx-app-stock-backend/model"

	"github.com/jmoiron/sqlx"
)

// StockInfoRepo stock_info 表的操作。
type StockInfoRepo struct {
	db *sqlx.DB
}

func NewStockInfoRepo(db *sqlx.DB) *StockInfoRepo {
	return &StockInfoRepo{db: db}
}

// Upsert 插入或更新单条股票信息。
func (r *StockInfoRepo) Upsert(info *model.StockInfo) error {
	info.UpdatedAt = time.Now()
	_, err := r.db.NamedExec(`
		INSERT INTO stock_info (code, name, type, market, board, industry, is_active, updated_at)
		VALUES (:code, :name, :type, :market, :board, :industry, :is_active, :updated_at)
		ON CONFLICT (code) DO UPDATE SET
			name       = EXCLUDED.name,
			type       = EXCLUDED.type,
			market     = EXCLUDED.market,
			board      = EXCLUDED.board,
			industry   = EXCLUDED.industry,
			is_active  = EXCLUDED.is_active,
			updated_at = EXCLUDED.updated_at
	`, info)
	if err != nil {
		return fmt.Errorf("upsert stock_info 失败(code=%s): %w", info.Code, err)
	}
	return nil
}

// BatchUpsert 批量 upsert 股票信息。
func (r *StockInfoRepo) BatchUpsert(infos []model.StockInfo) error {
	if len(infos) == 0 {
		return nil
	}
	tx, err := r.db.Beginx()
	if err != nil {
		return fmt.Errorf("开启事务失败: %w", err)
	}
	defer tx.Rollback()

	for i := range infos {
		infos[i].UpdatedAt = time.Now()
		if _, err := tx.NamedExec(`
			INSERT INTO stock_info (code, name, type, market, board, industry, is_active, updated_at)
			VALUES (:code, :name, :type, :market, :board, :industry, :is_active, :updated_at)
			ON CONFLICT (code) DO UPDATE SET
				name       = EXCLUDED.name,
				type       = EXCLUDED.type,
				market     = EXCLUDED.market,
				board      = EXCLUDED.board,
				industry   = EXCLUDED.industry,
				is_active  = EXCLUDED.is_active,
				updated_at = EXCLUDED.updated_at
		`, infos[i]); err != nil {
			return fmt.Errorf("批量写入 stock_info 第%d条失败(code=%s): %w", i+1, infos[i].Code, err)
		}
	}
	return tx.Commit()
}

// GetAll 获取全量股票信息。
func (r *StockInfoRepo) GetAll() ([]model.StockInfo, error) {
	var infos []model.StockInfo
	err := r.db.Select(&infos, `SELECT * FROM stock_info WHERE is_active=true ORDER BY code`)
	if err != nil {
		return nil, fmt.Errorf("查询全量 stock_info 失败: %w", err)
	}
	return infos, nil
}

// Search 按代码或名称搜索，最多返回 limit 条。
// 优先级：代码精确匹配 > 代码前缀 > 名称前缀 > 名称包含
func (r *StockInfoRepo) Search(keyword string, limit int) ([]model.StockInfo, error) {
	if limit <= 0 {
		limit = 20
	}
	var infos []model.StockInfo
	err := r.db.Select(&infos, `
		SELECT * FROM stock_info
		WHERE is_active = true
		  AND (code = $1 OR code LIKE $2 OR name LIKE $3 OR name LIKE $4)
		ORDER BY
			CASE
				WHEN code = $1 THEN 1
				WHEN name LIKE $3 THEN 2
				WHEN code LIKE $2 THEN 3
				ELSE 4
			END,
			code
		LIMIT $5
	`, keyword, keyword+"%", keyword+"%", "%"+keyword+"%", limit)
	if err != nil {
		return nil, fmt.Errorf("搜索股票失败: %w", err)
	}
	return infos, nil
}
