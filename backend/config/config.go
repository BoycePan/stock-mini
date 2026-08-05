package config

import (
	"os"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Server   ServerConfig   `yaml:"server"`
	Database DatabaseConfig `yaml:"database"`
	WeChat   WeChatConfig   `yaml:"wechat"`
	JWT      JWTConfig      `yaml:"jwt"`
	Stock    StockConfig    `yaml:"stock"` // 股票数据源配置
}

type ServerConfig struct {
	Port string `yaml:"port"`
}

type DatabaseConfig struct {
	Host     string `yaml:"host"`
	Port     string `yaml:"port"`
	User     string `yaml:"user"`
	Password string `yaml:"password"`
	Name     string `yaml:"name"`
}

type WeChatConfig struct {
	AppID     string `yaml:"app_id"`
	AppSecret string `yaml:"app_secret"`
}

type JWTConfig struct {
	Secret      string `yaml:"secret"`
	ExpireHours int    `yaml:"expire_hours"`
}

func Load() *Config {
	path := os.Getenv("CONFIG_PATH")
	if path == "" {
		path = "config.yaml"
	}

	data, err := os.ReadFile(path)
	if err != nil {
		panic("读取配置文件失败: " + err.Error())
	}

	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		panic("解析配置文件失败: " + err.Error())
	}

	//applyEnvOverrides(&cfg)
	return &cfg
}

// StockConfig 股票数据源配置，通过 config.yaml 的 stock 段控制。
//
// 每个数据源可以单独启用/禁用，以及调整限流和重试参数。
// 生产环境建议只开 sina + eastmoney，同花顺有反爬风险。
type StockConfig struct {
	Sina      StockSourceConfig `yaml:"sina"`      // 新浪财经 API
	Eastmoney StockSourceConfig `yaml:"eastmoney"` // 东方财富 API
	Cninfo    StockSourceConfig `yaml:"cninfo"`    // 巨潮资讯 API
	THS       StockSourceConfig `yaml:"ths"`       // 同花顺 API（高风险）
}

// StockSourceConfig 单个数据源配置。
type StockSourceConfig struct {
	Enabled    bool    `yaml:"enabled"`     // 是否启用
	RateLimit  float64 `yaml:"rate_limit"`  // 最小请求间隔（秒），0 表示不限流
	MaxRetries int     `yaml:"max_retries"` // 最大重试次数
	Timeout    int     `yaml:"timeout"`     // 超时时间（秒），默认 30
}

func applyEnvOverrides(cfg *Config) {
	if v := os.Getenv("SERVER_PORT"); v != "" {
		cfg.Server.Port = v
	}
	if v := os.Getenv("DB_HOST"); v != "" {
		cfg.Database.Host = v
	}
	if v := os.Getenv("DB_PORT"); v != "" {
		cfg.Database.Port = v
	}
	if v := os.Getenv("DB_USER"); v != "" {
		cfg.Database.User = v
	}
	if v := os.Getenv("DB_PASSWORD"); v != "" {
		cfg.Database.Password = v
	}
	if v := os.Getenv("DB_NAME"); v != "" {
		cfg.Database.Name = v
	}
	if v := os.Getenv("WECHAT_APP_ID"); v != "" {
		cfg.WeChat.AppID = v
	}
	if v := os.Getenv("WECHAT_APP_SECRET"); v != "" {
		cfg.WeChat.AppSecret = v
	}
	if v := os.Getenv("JWT_SECRET"); v != "" {
		cfg.JWT.Secret = v
	}
}
