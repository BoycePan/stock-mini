//go:build ignore

// 数据库迁移小工具 — 读取 SQL 文件并在目标库执行。
// 用法: go run cmd/migrate/main.go
//
// psql 没装时的替代方案，复用项目已有的数据库连接。
package main

import (
	"fmt"
	"log"
	"os"
	"strings"

	"wx-app-stock-backend/config"
	"wx-app-stock-backend/repository"
)

func main() {
	cfg := config.Load()

	db, err := repository.NewDB(cfg)
	if err != nil {
		log.Fatalf("数据库连接失败: %v", err)
	}
	defer db.Close()
	log.Printf("已连接: %s:%s/%s", cfg.Database.Host, cfg.Database.Port, cfg.Database.Name)

	sqlBytes, err := os.ReadFile("migrations/001_stock_tables.sql")
	if err != nil {
		log.Fatalf("读取SQL文件失败: %v", err)
	}

	statements := splitStatements(string(sqlBytes))
	log.Printf("共 %d 条语句，开始执行...", len(statements))

	for i, stmt := range statements {
		if _, err := db.Exec(stmt); err != nil {
			log.Printf("[%d/%d] 跳过: %v", i+1, len(statements), err)
		} else {
			log.Printf("[%d/%d] OK", i+1, len(statements))
		}
	}

	// 打印建好的表
	rows, err := db.Query(`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename`)
	if err != nil {
		log.Fatal(err)
	}
	defer rows.Close()

	fmt.Println("\n当前 public schema 表:")
	for rows.Next() {
		var name string
		rows.Scan(&name)
		fmt.Printf("  - %s\n", name)
	}
	fmt.Println("\n迁移完成。")
}

// splitStatements 按分号拆 SQL，自动跳过纯注释块和空行。
func splitStatements(sql string) []string {
	var result []string
	for _, stmt := range strings.Split(sql, ";") {
		lines := strings.Split(strings.TrimSpace(stmt), "\n")
		// 过滤掉纯注释行
		var meaningful []string
		for _, line := range lines {
			trimmed := strings.TrimSpace(line)
			if trimmed == "" || strings.HasPrefix(trimmed, "--") {
				continue
			}
			meaningful = append(meaningful, line)
		}
		if len(meaningful) > 0 {
			result = append(result, strings.Join(meaningful, "\n"))
		}
	}
	return result
}
