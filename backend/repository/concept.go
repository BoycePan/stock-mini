package repository

import (
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"
)

// ConceptRepo 概念板块数据访问。
type ConceptRepo struct {
	db *sqlx.DB
}

func NewConceptRepo(db *sqlx.DB) *ConceptRepo {
	return &ConceptRepo{db: db}
}

// ---------- concept_board ----------

// UpsertBoard 插入或更新单条概念板块。
func (r *ConceptRepo) UpsertBoard(plateCode, plateName string, cid int) error {
	_, err := r.db.Exec(`
		INSERT INTO concept_board (plate_code, plate_name, cid, updated_at)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (plate_code) DO UPDATE SET
			plate_name = EXCLUDED.plate_name,
			cid        = EXCLUDED.cid,
			updated_at = EXCLUDED.updated_at
	`, plateCode, plateName, cid, time.Now())
	if err != nil {
		return fmt.Errorf("upsert board %s 失败: %w", plateCode, err)
	}
	return nil
}

// ListBoards 获取所有概念板块。
func (r *ConceptRepo) ListBoards() ([]struct {
	PlateCode string `db:"plate_code" json:"plate_code"`
	PlateName string `db:"plate_name" json:"plate_name"`
	Cid       int    `db:"cid" json:"cid"`
}, error) {
	var boards []struct {
		PlateCode string `db:"plate_code" json:"plate_code"`
		PlateName string `db:"plate_name" json:"plate_name"`
		Cid       int    `db:"cid" json:"cid"`
	}
	err := r.db.Select(&boards, `SELECT plate_code, plate_name, cid FROM concept_board ORDER BY plate_code`)
	if err != nil {
		return nil, fmt.Errorf("查询板块列表失败: %w", err)
	}
	return boards, nil
}

// ---------- concept_stock ----------

// ReplaceMembers 全量替换某板块的成分股（先删后插）。
func (r *ConceptRepo) ReplaceMembers(plateCode string, stockCodes []string) error {
	if len(stockCodes) == 0 {
		return nil
	}
	tx, err := r.db.Beginx()
	if err != nil {
		return fmt.Errorf("开启事务失败: %w", err)
	}
	defer tx.Rollback()

	// 删旧
	if _, err := tx.Exec(`DELETE FROM concept_stock WHERE plate_code = $1`, plateCode); err != nil {
		return fmt.Errorf("删除旧成分股失败(%s): %w", plateCode, err)
	}

	// 批量插新
	for _, code := range stockCodes {
		if _, err := tx.Exec(
			`INSERT INTO concept_stock (plate_code, stock_code) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
			plateCode, code,
		); err != nil {
			return fmt.Errorf("插入成分股失败(%s,%s): %w", plateCode, code, err)
		}
	}
	return tx.Commit()
}

// GetMembers 查询某板块的成分股代码列表。
func (r *ConceptRepo) GetMembers(plateCode string) ([]string, error) {
	var codes []string
	err := r.db.Select(&codes,
		`SELECT stock_code FROM concept_stock WHERE plate_code = $1 ORDER BY stock_code`,
		plateCode,
	)
	if err != nil {
		return nil, fmt.Errorf("查询成分股失败(%s): %w", plateCode, err)
	}
	return codes, nil
}

// CountBoards 板块总数，用于判断是否需要首次采集。
func (r *ConceptRepo) CountBoards() (int, error) {
	var n int
	err := r.db.Get(&n, `SELECT count(*) FROM concept_board`)
	return n, err
}
