SHELL := /bin/sh
.DEFAULT_GOAL := help

BUN ?= bun
ENV_FILE ?= .env
ifneq (,$(wildcard $(ENV_FILE)))
include $(ENV_FILE)
ENV_VARS := $(shell sed -n 's/^\([A-Za-z0-9_][A-Za-z0-9_]*\)=.*/\1/p' $(ENV_FILE))
export $(ENV_VARS)
endif

.PHONY: help install test lint clean scenario scenario-inception

help: ## Show targets
	@grep -E '^[a-zA-Z_-]+:.*?##' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "%-16s %s\n", $$1, $$2}'

install: ## Install dependencies
	$(BUN) install

lint: ## Run lint (if configured)
	$(BUN) lint || true

test: ## Run tests
	$(BUN) test

scenario: ## Run a sample Steward scenario (list workspace files)
	@echo "== Steward scenario: list workspace files =="
	@echo "provider=azure model=$${STEWARD_AZURE_OPENAI_DEPLOYMENT:-gpt-5-mini}" && \
	STEWARD_ALLOW_EXECUTE=1 $(BUN) run src/cli.ts "List files in the workspace" --provider azure --model $${STEWARD_AZURE_OPENAI_DEPLOYMENT:-gpt-5-mini}

inception: ## Run a weirder scenario inside sandbox/ (go all meta!)
	@echo "== Steward scenario (sandbox): list files =="
	@echo "provider=azure model=$${STEWARD_AZURE_OPENAI_DEPLOYMENT:-gpt-5-mini} cwd=sandbox" && \
	cd sandbox && STEWARD_ALLOW_EXECUTE=1 $(BUN) run ../src/cli.ts "Create a bun project for an LLM harness to test models in an environment that mimics what GitHub Copilot sees, including common tools" --provider azure --model $${STEWARD_AZURE_OPENAI_DEPLOYMENT:-gpt-5-mini} --pretty

clean: ## Reset sandbox and remove temp and build artifacts
	git restore --staged --worktree --quiet sandbox || true
	git clean -fdx -- sandbox || true
	rm -rf node_modules .steward-todo.json .steward-log.jsonl sandbox/.steward-todo.json sandbox/.steward-log.jsonl
