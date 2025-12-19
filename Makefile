SHELL := /bin/sh
.DEFAULT_GOAL := help

BUN ?= bun

.PHONY: help install test lint clean

help: ## Show targets
	@grep -E '^[a-zA-Z_-]+:.*?##' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "%-16s %s\n", $$1, $$2}'

install: ## Install dependencies
	$(BUN) install

lint: ## Run lint (if configured)
	$(BUN) lint || true

test: ## Run tests
	$(BUN) test

clean: ## Remove temp and build artifacts
	rm -rf node_modules .harness-todo.json
