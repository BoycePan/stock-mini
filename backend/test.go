package main

import "errors"

func test(us string) (string, error) {
	if v := "test"; us == v {
		// 报错
		return "success", errors.New("XXXXXXXX")
	}

	return us, nil
}
