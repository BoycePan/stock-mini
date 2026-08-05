package model

import "time"

type User struct {
	ID          int64      `db:"id"          json:"id"`
	OpenID      string     `db:"openid"      json:"-"`
	UnionID     *string    `db:"unionid"     json:"-"`
	SessionKey  *string    `db:"session_key" json:"-"`
	Nickname    *string    `db:"nickname"    json:"nickname"`
	AvatarURL   *string    `db:"avatar_url"  json:"avatar_url"`
	PhoneEnc    *string    `db:"phone_enc"   json:"-"`
	Status      int        `db:"status"      json:"status"`
	LastLoginAt *time.Time `db:"last_login_at" json:"last_login_at"`
	CreatedAt   time.Time  `db:"created_at"  json:"created_at"`
	UpdatedAt   time.Time  `db:"updated_at"  json:"updated_at"`
}
