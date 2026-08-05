package errcode

// 通用错误码
const (
	Success      = 200
	ServerError  = 500
	InvalidParam = 400
	Unauthorized = 401
	Forbidden    = 403
	NotFound     = 404

	// 认证相关 1xxx
	TokenInvalid = 1001
	TokenMissing = 1002
	WxLoginFail  = 1003
)

var messages = map[int]string{
	Success:      "success",
	ServerError:  "server error",
	InvalidParam: "param error",
	Unauthorized: "unauthorized",
	Forbidden:    "forbidden",
	NotFound:     "not found",
	TokenInvalid: "token 无效或已过期",
	TokenMissing: "缺少 token",
	WxLoginFail:  "微信登录失败",
}

func Msg(code int) string {
	if m, ok := messages[code]; ok {
		return m
	}
	return "unknown error"
}
