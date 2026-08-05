package response

import "fmt"

// BizError 业务异常。
// 对标 Java 的 BizException，携带错误码。
type BizError struct {
	Code int
	Msg  string
}

func (e *BizError) Error() string {
	return fmt.Sprintf("[%d] %s", e.Code, e.Msg)
}

func NewBizError(code int, msg string) *BizError {
	return &BizError{Code: code, Msg: msg}
}
