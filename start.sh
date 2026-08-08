#!/usr/bin/env bash
# agent-proxy 一键启动脚本
# 用法: ./start.sh          前台启动（Ctrl+C 停止）
#       ./start.sh -d        后台启动
#       ./start.sh stop      停止后台进程
#       ./start.sh status    查看状态
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(pwd)"
PID_FILE="$ROOT/.run/agent-proxy.pid"
LOG_FILE="$ROOT/.run/agent-proxy.log"
mkdir -p "$ROOT/.run"

# ---------- 颜色 ----------
C_GREEN='\033[0;32m'; C_RED='\033[0;31m'; C_YELLOW='\033[1;33m'; C_OFF='\033[0m'
info()  { printf "${C_GREEN}✔${C_OFF} %s\n" "$1"; }
warn()  { printf "${C_YELLOW}!${C_OFF} %s\n" "$1"; }
err()   { printf "${C_RED}✘${C_OFF} %s\n" "$1" >&2; }

# ---------- 加载 .env ----------
if [[ -f "$ROOT/.env" ]]; then set -a; . "$ROOT/.env"; set +a; fi
: "${DB_PATH:=$ROOT/.run/agent-proxy.db}"
: "${PORT:=8787}"
export DB_PATH PORT

PID_FILE="$ROOT/.run/agent-proxy.pid"
is_running() {
  [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

# stop / status 短路，跳过依赖/建表/构建
case "${1:-run}" in
  stop)
    if is_running; then
      kill "$(cat "$PID_FILE")" 2>/dev/null || true
      rm -f "$PID_FILE"; info "已停止"
    else warn "进程未在运行"; fi
    exit 0 ;;
  status)
    if is_running; then info "运行中 (PID $(cat "$PID_FILE")) → http://localhost:${PORT}"
    else warn "未运行"; fi
    exit 0 ;;
esac

# ---------- 前置检查 ----------
command -v node  >/dev/null || { err "未找到 node"; exit 1; }
command -v pnpm  >/dev/null || { err "未找到 pnpm，请先安装: npm i -g pnpm"; exit 1; }

# ---------- 依赖安装 ----------
if [[ ! -d "$ROOT/node_modules" ]] || [[ ! -d "$ROOT/node_modules/hono" ]]; then
  info "安装依赖 (pnpm install)…"
  pnpm install --silent
fi
# esbuild / better-sqlite3 需要原生编译权限
if [[ -d "$ROOT/node_modules/esbuild" ]] && [[ ! -f "$ROOT/node_modules/esbuild/bin/esbuild" ]]; then
  pnpm rebuild esbuild >/dev/null 2>&1 || true
fi
if [[ -d "$ROOT/node_modules/better-sqlite3" ]] && [[ ! -f "$ROOT/node_modules/better-sqlite3/build/Release/better_sqlite3.node" ]]; then
  pnpm rebuild better-sqlite3 >/dev/null 2>&1 || true
fi
# ABI 自愈：electron 打包会把原生模块重编为 Electron ABI，node 启动前需对齐回 Node ABI
if [[ -d "$ROOT/node_modules/better-sqlite3" ]] && ! node -e "require('better-sqlite3')" >/dev/null 2>&1; then
  info "better-sqlite3 为 Electron ABI，重建为 Node ABI…"
  pnpm rebuild better-sqlite3 >/dev/null 2>&1 || warn "重建 better-sqlite3 失败，继续尝试启动"
fi

# ---------- 数据库 ----------
# SQLite：建表在应用启动时自动完成（src/server/db/migrate.ts），这里仅确保目录存在
mkdir -p "$(dirname "$DB_PATH")"
info "SQLite 数据库: ${DB_PATH}（首次启动自动建表）"

# ---------- 构建前端 ----------
if [[ ! -f "$ROOT/web/dist/index.html" ]]; then
  info "构建前端 (pnpm build:web)…"
  pnpm run build:web --silent
fi
info "前端已就绪"

# ---------- 进程管理 ----------
if is_running; then
  warn "已有进程在运行 (PID $(cat "$PID_FILE"))，先执行 ./start.sh stop"
  exit 1
fi

MODE="${1:-run}"
info "启动 LocalGate → http://localhost:${PORT}  (管理后台 / API 代理同端口)"

if [[ "$MODE" == "-d" ]]; then
  # 后台
  nohup pnpm exec tsx "$ROOT/src/server/index.ts" > "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  sleep 2
  if is_running; then
    info "后台启动成功 (PID $(cat "$PID_FILE"))"
    echo "    日志: tail -f ${LOG_FILE}"
    echo "    停止: ./start.sh stop"
  else
    err "启动失败，查看日志: ${LOG_FILE}"
    tail -20 "${LOG_FILE}" || true
    exit 1
  fi
else
  # 前台
  info "前台运行，Ctrl+C 停止。日志同时写入 ${LOG_FILE}"
  exec pnpm exec tsx "$ROOT/src/server/index.ts" 2>&1 | tee "${LOG_FILE}"
fi
