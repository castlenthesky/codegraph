package main

import (
	"fmt"
	"taint-wrangler/test/fixtures/code_examples/go/services/greeting"
)

func main() {
	username := "TESTING_USER"
	result := greeting.GreetUser(username)
	fmt.Println(result)
}
