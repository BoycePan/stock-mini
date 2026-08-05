package repository

import (
	"fmt"
	"net/url"

	"wx-app-stock-backend/config"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/jmoiron/sqlx"
)

// NewDB 创建数据库连接
// Go 的惯例：NewXxx 是构造函数，返回指针和 error
func NewDB(cfg *config.Config) (*sqlx.DB, error) {
	// URL 编码密码里的特殊字符（比如 @）
	password := url.QueryEscape(cfg.Database.Password)

	dsn := fmt.Sprintf(
		"postgres://%s:%s@%s:%s/%s?sslmode=disable",
		cfg.Database.User, password, cfg.Database.Host, cfg.Database.Port, cfg.Database.Name,
	)

	// sqlx.Connect 等价于 sql.Open + Ping，一步完成
	db, err := sqlx.Connect("pgx", dsn)
	if err != nil {
		return nil, fmt.Errorf("连接数据库失败: %w", err)
	}

	// 配置连接池
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)

	return db, nil
}
