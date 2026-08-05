package repository

import (
	"time"
	"wx-app-stock-backend/model"

	"github.com/jmoiron/sqlx"
)

type UserRepo struct {
	db *sqlx.DB
}

func NewUserRepo(db *sqlx.DB) *UserRepo {
	return &UserRepo{db: db}
}

func (r *UserRepo) FindByOpenID(openid string) (*model.User, error) {
	var u model.User
	err := r.db.Get(&u, "SELECT * FROM users WHERE openid = $1", openid)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (r *UserRepo) Create(u *model.User) error {
	now := time.Now()
	u.CreatedAt = now
	u.UpdatedAt = now
	u.Status = 1

	return r.db.QueryRow(
		`INSERT INTO users (openid, unionid, session_key, status, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
		u.OpenID, u.UnionID, u.SessionKey, u.Status, u.CreatedAt, u.UpdatedAt,
	).Scan(&u.ID)
}

func (r *UserRepo) UpdateLogin(u *model.User) error {
	now := time.Now()
	_, err := r.db.Exec(
		`UPDATE users SET session_key = $1, unionid = COALESCE($2, unionid),
		 last_login_at = $3, updated_at = $4 WHERE id = $5`,
		u.SessionKey, u.UnionID, now, now, u.ID,
	)
	return err
}
