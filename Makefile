# Agent Proxy — 跨平台打包 Makefile
#
# 常用：
#   make            全流程：安装依赖 → 重编原生模块 → 构建 → 打包当前平台
#   make run        开发态直接启动桌面壳（DB 走 .run/）
#   make dist       仅打包当前平台（需先 make build）
#   make dist-mac   打包 macOS arm64 + x64（仅 macOS 可执行）
#   make dist-win   打包 Windows x64（仅 Windows 可执行）
#   make dist-linux 打包 Linux x64（仅 Linux 可执行）
#   make dist-all   打包当前平台全部架构（macOS = arm64+x64）
#   make clean      清理产物

.PHONY: all deps rebuild build run dist dist-mac dist-win dist-linux dist-all clean open

PKG      := pnpm
VERSION  := $(shell node -p "require('./package.json').version")
RELEASE  := release

all: deps rebuild build dist

## 安装依赖（含 electron / electron-builder / @electron/rebuild）
deps:
	$(PKG) install

## 按 Electron ABI 重编译 better-sqlite3 等原生模块（必须，否则 NODE_MODULE_VERSION mismatch）
rebuild:
	$(PKG) exec electron-rebuild -w better-sqlite3

## 构建服务端(tsc) + 前端(vite)
build:
	$(PKG) run build

## 开发态：直接运行桌面壳（先确保原生模块为 Electron ABI）
run: rebuild
	env -u ELECTRON_RUN_AS_NODE $(PKG) run electron

## 打包：当前平台默认架构
dist:
	$(PKG) run dist
	@echo ""
	@echo "✔ 打包完成，产物见 $(RELEASE)/"
	@ls -lh $(RELEASE) 2>/dev/null || true

## 打包 macOS arm64 + x64（Universal 需两台机器或 CI）
dist-mac:
	$(PKG) exec electron-builder --mac --arm64 --x64
	@echo "✔ macOS 产物见 $(RELEASE)/"

## 打包 Windows x64（NSIS 安装包）
dist-win:
	$(PKG) exec electron-builder --win --x64
	@echo "✔ Windows 产物见 $(RELEASE)/"

## 打包 Linux x64（AppImage）
dist-linux:
	$(PKG) exec electron-builder --linux --x64
	@echo "✔ Linux 产物见 $(RELEASE)/"

## 打包当前平台所有架构
dist-all:
	$(PKG) exec electron-builder
	@echo "✔ 产物见 $(RELEASE)/"
	@ls -lh $(RELEASE) 2>/dev/null || true

## 打开最新的 dmg（macOS）
open:
	@open "$$(ls -1 $(RELEASE)/*.dmg | head -1)"

## 清理
clean:
	rm -rf dist web/dist $(RELEASE)
