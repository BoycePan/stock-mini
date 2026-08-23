-- ============================================================
-- RSS 新闻源管理后台 · 线上表结构迁移（幂等，可重复执行）
-- 用途：给已存在的 rss_source 表新增「软删除 + 拉取状态」列，
--       配合 MgrController 的数据源管理接口。
-- 兼容：PostgreSQL（与后端同库）
-- 执行：psql "postgresql://root:...@host:5432/gu_yu_stock" -f scripts/rss_source_manage_migration.sql
-- 说明：
--   - ADD COLUMN IF NOT EXISTS：列已存在则跳过，重复执行安全；
--   - 仅新增列，不修改/删除任何现有数据；deleted 默认 FALSE（存量行视为未删）。
--   - 部署顺序：先在本库执行本脚本，再发布新代码（findEnabled() 会用到 deleted 列）。
-- ============================================================

ALTER TABLE rss_source ADD COLUMN IF NOT EXISTS deleted         BOOLEAN      NOT NULL DEFAULT FALSE;
ALTER TABLE rss_source ADD COLUMN IF NOT EXISTS last_status     VARCHAR(16);
ALTER TABLE rss_source ADD COLUMN IF NOT EXISTS last_error      VARCHAR(512);
ALTER TABLE rss_source ADD COLUMN IF NOT EXISTS last_fetch_at   TIMESTAMP;
ALTER TABLE rss_source ADD COLUMN IF NOT EXISTS last_item_count INT;

COMMENT ON COLUMN rss_source.deleted         IS '软删除标记：true 表示已删除（列表默认不展示，findEnabled 跳过）';
COMMENT ON COLUMN rss_source.last_status     IS '最近一次拉取状态：ok / fail（null=尚未拉取过）';
COMMENT ON COLUMN rss_source.last_error      IS '最近一次拉取失败原因（成功时为空）';
COMMENT ON COLUMN rss_source.last_fetch_at   IS '最近一次拉取时间';
COMMENT ON COLUMN rss_source.last_item_count IS '最近一次拉取解析出的条目数';
