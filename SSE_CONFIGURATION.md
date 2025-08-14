# MCP Mail Tool - SSE 配置指南

本文檔說明如何將MCP Mail Tool從stdio模式遷移到SSE (Server-Sent Events) 模式，並使用自定義HTTP頭進行配置。

## 概述

**改動內容：**
1. 從stdio傳輸切換到SSE傳輸
2. 配置從環境變量改為HTTP自定義頭
3. MCP服務器作為HTTP服務運行，支持多客戶端連接

## 新的架構

### 傳輸方式變化
- **之前**: stdio（標準輸入/輸出）
- **現在**: SSE（Server-Sent Events）+ HTTP POST

### 配置方式變化
- **之前**: 通過MCP配置文件的`env`部分傳遞環境變量
- **現在**: 通過HTTP請求頭傳遞配置信息

## 新的MCP配置格式

### 服務器配置

SSE服務器支持通過命令行參數配置：

```bash
python bridging_mail_mcp_sse.py --port 3000 --host 0.0.0.0
```

## HTTP 頭配置

當MCP客戶端連接到SSE服務器時，需要在HTTP請求中包含以下自定義頭：

### 必需的HTTP頭

| HTTP頭 | 對應原環境變量 | 說明 |
|--------|---------------|------|
| `SMTP_HOST` | `SMTP_HOST` | SMTP服務器地址 |
| `SMTP_USER` | `SMTP_USER` | SMTP用戶名 |
| `SMTP_PASS` | `SMTP_PASS` | SMTP密碼 |
| `IMAP_HOST` | `IMAP_HOST` | IMAP服務器地址 |
| `IMAP_USER` | `IMAP_USER` | IMAP用戶名 |
| `IMAP_PASS` | `IMAP_PASS` | IMAP密碼 |

### 可選的HTTP頭

| HTTP頭 | 對應原環境變量 | 默認值 | 說明 |
|--------|---------------|-------|------|
| `SMTP_PORT` | `SMTP_PORT` | `587` | SMTP端口 |
| `SMTP_SECURE` | `SMTP_SECURE` | `true` | 是否使用SSL/TLS |
| `SMTP_ALLOW_UNAUTHORIZED_CERT` | `SMTP_ALLOW_UNAUTHORIZED_CERT` | `false` | 是否允許未授權證書 |
| `IMAP_PORT` | `IMAP_PORT` | `993` | IMAP端口 |
| `IMAP_SECURE` | `IMAP_SECURE` | `true` | 是否使用SSL/TLS |
| `DEFAULT_FROM_NAME` | `DEFAULT_FROM_NAME` | 從SMTP_USER提取 | 默認發件人姓名 |
| `DEFAULT_FROM_EMAIL` | `DEFAULT_FROM_EMAIL` | SMTP_USER | 默認發件人郵箱 |

## 服務器端點

SSE服務器提供以下端點：

### 主要端點
- `GET /sse` - 建立SSE連接（需要配置頭）
- `POST /messages` - 處理MCP消息（需要sessionId參數）

### 輔助端點  
- `GET /health` - 服務器健康檢查

## 啟動和運行

### 1. 構建項目
```bash
cd /path/to/mcp-mail
npm install
npm run build
```

### 2. 啟動SSE服務器

**方式1: 通過Python橋接腳本（推薦）**
```bash
python bridging_mail_mcp_sse.py
```

**方式2: 直接啟動Node.js服務器**
```bash
npm run start:sse
```

**方式3: 開發模式**
```bash
npm run dev:sse
```

### 3. 配置端口（可選）
```bash
# 設置自定義端口
export MCP_SSE_PORT=3001
python bridging_mail_mcp_sse.py
```

## 客戶端連接示例

### 使用curl測試連接

**建立SSE連接:**
```bash
curl -N -H "SMTP_HOST: mail.example.com" \
     -H "SMTP_PORT: 25" \
     -H "SMTP_SECURE: false" \
     -H "SMTP_USER: user@example.com" \
     -H "SMTP_PASS: password" \
     -H "SMTP_ALLOW_UNAUTHORIZED_CERT: false" \
     -H "IMAP_HOST: mail.example.com" \
     -H "IMAP_PORT: 993" \
     -H "IMAP_SECURE: true" \
     -H "IMAP_USER: user@example.com" \
     -H "IMAP_PASS: password" \
     -H "DEFAULT_FROM_NAME: emample_user" \
     -H "DEFAULT_FROM_EMAIL: mail.example.com" \
     "http://localhost:3000/sse"
```

**發送消息:**
```bash
curl -X POST \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
     "http://localhost:3000/messages?sessionId=YOUR_SESSION_ID"
```

## 兼容性說明

### 向後兼容
- 原有的stdio版本仍然可用（`bridging_mail_mcp.py`）
- 舊的配置格式仍然支持

### 遷移建議
1. 保留原有的stdio配置作為備份
2. 創建新的SSE配置進行測試
3. 驗證功能正常後切換到SSE版本

## 故障排除

### 常見問題

**1. "Missing required header" 錯誤**
- 確認所有必需的HTTP頭都已正確設置
- 檢查頭名稱拼寫是否正確（使用小寫，用連字符分隔）

**2. "Session not found" 錯誤**  
- 確認sessionId參數正確傳遞給/messages端點
- 檢查SSE連接是否仍然活躍

**3. 端口沖突**
- 使用`MCP_SSE_PORT`環境變量指定其他端口
- 檢查防火墻設置

**4. 構建失敗**
- 確認已安裝所有依賴: `npm install`
- 確認TypeScript編譯成功: `npm run build`

### 調試模式

啟用詳細日志：
```bash
# Linux/macOS
DEBUG=* python bridging_mail_mcp_sse.py

# Windows
set DEBUG=* && python bridging_mail_mcp_sse.py
```

## 安全注意事項

1. **憑據保護**: HTTP頭中的敏感信息（如密碼）在傳輸過程中需要使用HTTPS加密
2. **網絡安全**: 生產環境中應使用HTTPS而非HTTP
3. **訪問控制**: 考慮添加認證機制限制服務器訪問
4. **日志安全**: 確保服務器日志不記錄敏感的HTTP頭信息

## 性能特性

### SSE的優勢
- **多客戶端支持**: 支持同時連接多個MCP客戶端
- **會話管理**: 每個連接獨立管理，不會相互影響
- **實時通信**: 支持服務器向客戶端推送實時消息
- **連接恢覆**: 支持連接斷開後的自動重連

### 資源使用
- 每個活躍連接消耗約1-2MB內存
- CPU使用率與並發連接數和郵件操作頻率相關
- 建議生產環境限制最大並發連接數