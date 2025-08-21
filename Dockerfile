FROM node:lts-alpine AS builder

WORKDIR /app

# 複製 package.json 和 package-lock.json 使用 * 可以同時複製 package.json 和 package-lock.json
COPY package*.json ./

RUN npm install

# 複製所有專案原始碼到工作目錄 因為有 .dockerignore，所以 node_modules 不會被複製
COPY . .

# For tsc Permission denied
RUN chmod +x /app/node_modules/.bin/tsc

RUN npm run build

FROM node:lts-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 8299

ENTRYPOINT ["node", "dist/sse-server.js", "--port", "8299", "--host", "0.0.0.0"]
