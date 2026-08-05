package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"wx-app-stock-backend/config"
	"wx-app-stock-backend/model"
	"wx-app-stock-backend/repository"

	"github.com/golang-jwt/jwt/v5"
)

type AuthService struct {
	cfg      *config.Config
	userRepo *repository.UserRepo
}

func NewAuthService(cfg *config.Config, userRepo *repository.UserRepo) *AuthService {
	return &AuthService{cfg: cfg, userRepo: userRepo}
}

type LoginResult struct {
	Token     string      `json:"token"`
	ExpiresIn int64       `json:"expires_in"`
	User      *model.User `json:"user"`
}

type wechatSession struct {
	OpenID     string `json:"openid"`
	SessionKey string `json:"session_key"`
	UnionID    string `json:"unionid"`
	ErrCode    int    `json:"errcode"`
	ErrMsg     string `json:"errmsg"`
}

type jwtClaims struct {
	UserID int64  `json:"user_id"`
	OpenID string `json:"openid"`
	jwt.RegisteredClaims
}

func (s *AuthService) Login(code string) (*LoginResult, error) {
	session, err := s.code2Session(code)
	if err != nil {
		return nil, fmt.Errorf("微信登录失败: %w", err)
	}

	user, err := s.userRepo.FindByOpenID(session.OpenID)
	if err != nil {
		user = &model.User{
			OpenID:     session.OpenID,
			SessionKey: &session.SessionKey,
		}
		if session.UnionID != "" {
			user.UnionID = &session.UnionID
		}
		if err := s.userRepo.Create(user); err != nil {
			return nil, fmt.Errorf("创建用户失败: %w", err)
		}
	} else {
		user.SessionKey = &session.SessionKey
		if session.UnionID != "" {
			user.UnionID = &session.UnionID
		}
		if err := s.userRepo.UpdateLogin(user); err != nil {
			return nil, fmt.Errorf("更新登录信息失败: %w", err)
		}
	}

	expireHours := s.cfg.JWT.ExpireHours
	if expireHours <= 0 {
		expireHours = 24
	}
	expireAt := time.Now().Add(time.Duration(expireHours) * time.Hour)

	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwtClaims{
		UserID: user.ID,
		OpenID: user.OpenID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expireAt),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}).SignedString([]byte(s.cfg.JWT.Secret))
	if err != nil {
		return nil, fmt.Errorf("生成 token 失败: %w", err)
	}

	return &LoginResult{
		Token:     token,
		ExpiresIn: int64(expireHours * 3600),
		User:      user,
	}, nil
}

func (s *AuthService) code2Session(code string) (*wechatSession, error) {
	url := fmt.Sprintf(
		"https://api.weixin.qq.com/sns/jscode2session?appid=%s&secret=%s&js_code=%s&grant_type=authorization_code",
		s.cfg.WeChat.AppID, s.cfg.WeChat.AppSecret, code,
	)

	resp, err := http.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var session wechatSession
	if err := json.NewDecoder(resp.Body).Decode(&session); err != nil {
		return nil, err
	}

	if session.ErrCode != 0 {
		return nil, errors.New(session.ErrMsg)
	}

	return &session, nil
}
