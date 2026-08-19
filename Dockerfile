# ── 构建阶段：编译 server (tsc) + 前端 (vite) ──
# 基础镜像走 DaoCloud 加速（Docker Hub 直连超时）；换回官方源可用 library/node:22-bookworm-slim
FROM docker.m.daocloud.io/library/node:22-bookworm-slim AS build
# better-sqlite3 原生模块编译兜底工具链（无预编译时本地构建）
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
# npm 包也走国内镜像
RUN pnpm config set registry https://registry.npmmirror.com
WORKDIR /app

# 跳过 Electron 二进制下载（桌面壳不需要，省 ~100MB）
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

COPY package.json pnpm-lock.yaml ./
# pnpm onlyBuiltDependencies 允许 better-sqlite3/esbuild 跑 install 脚本（electron 跳过二进制下载）
RUN pnpm config set dangerouslyAllowAllBuilds true && pnpm install --frozen-lockfile

COPY . .
RUN pnpm build:server && pnpm build:web

# 裁掉 devDependencies（electron/vite/tsc 等），只留运行时依赖
RUN pnpm prune --prod


# ── 运行阶段 ──
FROM docker.m.daocloud.io/library/node:22-bookworm-slim
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    DB_PATH=/data/agent-proxy.db

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
COPY package.json ./

# SQLite 数据目录（挂载卷持久化）
RUN mkdir -p /data
VOLUME /data

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server/index.js"]
