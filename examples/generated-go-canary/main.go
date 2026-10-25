package main

import (
	"fmt"
	"net/http"
	"os"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	http.HandleFunc("/health", func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusNoContent)
	})
	http.HandleFunc("/", func(response http.ResponseWriter, _ *http.Request) {
		_, _ = fmt.Fprintln(response, "generated Go recipe is running")
	})
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		panic(err)
	}
}
