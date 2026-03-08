FROM node:22-alpine AS builder

WORKDIR /app

# 升級 Alpine 系統套件以修復 OpenSSL 等安全性弱點 (CVE-2025-15467 等)
RUN apk update && apk upgrade --no-cache

# 複製 package.json 和 package-lock.json 使用 * 可以同時複製 package.json 和 package-lock.json
COPY package*.json ./

RUN npm install

# 複製所有專案原始碼到工作目錄 因為有 .dockerignore，所以 node_modules 不會被複製
COPY . .

# For tsc/esbuild Permission denied
RUN chmod +x /app/node_modules/.bin/tsc /app/node_modules/.bin/esbuild

RUN npm run build

FROM node:22-alpine

WORKDIR /app

# 升級 Alpine 系統套件以修復 OpenSSL 等安全性弱點 (CVE-2025-15467 等)
RUN apk update && apk upgrade --no-cache

COPY package*.json ./

# 安裝生產套件後移除 npm，避免 npm 內部套件 (tar, glob, minimatch, diff) 被 Trivy 掃描到
# 執行期只需要 node 執行環境，不需要 npm
RUN npm install --omit=dev && \
    npm cache clean --force && \
    rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/bin/npm \
           /usr/local/bin/npx

COPY --from=builder /app/dist ./dist

EXPOSE 8299

ENTRYPOINT ["node", "dist/sse-server.js", "--port", "8299", "--host", "0.0.0.0"]
