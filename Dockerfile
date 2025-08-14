# MCP Phison Mail Docker Configuration
FROM node:lts-alpine

WORKDIR /app

# Copy package files and TypeScript config
COPY package*.json tsconfig.json ./

# Install deps without running build scripts
RUN npm install --ignore-scripts

# Copy source files
COPY . .

# Build the TypeScript code
RUN npm run build

# Entry point runs the Node server
ENTRYPOINT ["node", "dist/sse-server.js --port 8299 --host localhost"]

EXPOSE 8299