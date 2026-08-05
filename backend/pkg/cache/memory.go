// Package cache 提供通用内存缓存，用于分钟线和实时行情的临时存储。
//
// 设计原则：
//   - 简单优先：不引入 Redis/Memcached，直接进程内存
//   - TTL 自动过期：Get 时检查，过期自动清理
//   - 并发安全：读写锁保护
//   - 分钟线缓存周期短（30-60s），不会撑爆内存
package cache

import (
	"sync"
	"time"
)

// Item 是缓存中的一条记录。
type Item[T any] struct {
	Value     T         // 缓存的数据（泛型，可以是 []byte、struct 等）
	ExpiresAt time.Time // 过期时间，time.Time 的零值表示永不过期
}

// MemoryCache 是一个泛型内存缓存。
// T 是缓存值的类型，例如 []byte 或自定义 struct。
// 使用 sync.RWMutex 保护，支持多 goroutine 并发读写。
type MemoryCache[T any] struct {
	mu    sync.RWMutex
	items map[string]*Item[T]
}

// New 创建一个新的内存缓存实例。
//
// 用法示例：
//
//	klineCache := cache.New[[]byte]()
//	quoteCache := cache.New[QuoteData]()
func New[T any]() *MemoryCache[T] {
	return &MemoryCache[T]{
		items: make(map[string]*Item[T]),
	}
}

// Get 从缓存中取值。返回值和"是否存在且未过期"。
// 如果 key 不存在或已过期，返回零值和 false。
func (c *MemoryCache[T]) Get(key string) (T, bool) {
	c.mu.RLock()
	item, ok := c.items[key]
	c.mu.RUnlock()

	if !ok {
		var zero T // 泛型的零值，比如 []byte 的零值是 nil
		return zero, false
	}

	// 检查是否过期（零值 = 永不过期）
	if !item.ExpiresAt.IsZero() && time.Now().After(item.ExpiresAt) {
		// 过期了，异步清理（不等锁竞争）
		go c.delete(key)
		var zero T
		return zero, false
	}

	return item.Value, true
}

// Set 写入缓存，ttl 是有效时长。
// 例如 Set("key", data, 30*time.Second)。
func (c *MemoryCache[T]) Set(key string, value T, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.items[key] = &Item[T]{
		Value:     value,
		ExpiresAt: time.Now().Add(ttl),
	}
}

// SetForever 写入永不过期的缓存。
func (c *MemoryCache[T]) SetForever(key string, value T) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.items[key] = &Item[T]{
		Value:     value,
		ExpiresAt: time.Time{}, // 零值 = 永不过期
	}
}

// delete 删除一个 key（不加锁，由调用方或异步调用）。
func (c *MemoryCache[T]) delete(key string) {
	c.mu.Lock()
	delete(c.items, key)
	c.mu.Unlock()
}

// Delete 删除指定 key。
func (c *MemoryCache[T]) Delete(key string) {
	c.delete(key)
}

// Len 返回当前缓存条目数（包括过期但未清理的）。
func (c *MemoryCache[T]) Len() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.items)
}

// Clear 清空全部缓存。
func (c *MemoryCache[T]) Clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.items = make(map[string]*Item[T])
}
