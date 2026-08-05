package handler

import (
	"wx-app-stock-backend/pkg/errcode"
	"wx-app-stock-backend/pkg/response"
	"wx-app-stock-backend/service"

	"github.com/gin-gonic/gin"
)

type AuthHandler struct {
	authService *service.AuthService
}

func NewAuthHandler(authService *service.AuthService) *AuthHandler {
	return &AuthHandler{authService: authService}
}

type loginReq struct {
	Code string `json:"code" binding:"required"`
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req loginReq

	// 把 body JSON → req
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Error(errcode.InvalidParam, "code 不能为空").Write(c)
		return
	}

	result, err := h.authService.Login(req.Code)
	if err != nil {
		response.Error(errcode.WxLoginFail, err.Error()).Write(c)
		return
	}

	response.Success(result).Write(c)
}
