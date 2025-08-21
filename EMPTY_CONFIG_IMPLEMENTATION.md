# MCP Mail Tool - 空配置支援實現文檔

## 概述

本文檔記錄了對MCP Mail Tool進行的修改，使其支援空字串參數初始化，以便在不提供真實郵件憑證的情況下也能創建MCP Client並獲取工具列表。

## 需求背景

原始需求：
- 需要一開始先建立MCP Client去取得Tool list
- 之後實際要針對不同使用者狀況才用不同的header去啟動MCP Client  
- 原本的程式不支援這些參數都是空字串

## 實現方案

### 核心策略
1. **分離初始化與操作**：允許空配置初始化MCP服務，但在實際郵件操作時進行驗證
2. **虛擬服務創建**：為空配置創建虛擬的SMTP和IMAP服務，避免初始化錯誤
3. **操作時驗證**：在每個實際郵件操作前檢查配置有效性
4. **友善錯誤處理**：提供清楚的錯誤訊息指導用戶

## 修改詳情

### 1. 環境變數驗證更新

**檔案**: `src/tools/mail.ts`  
**位置**: 行 104-147

```typescript
// 修改前
const missingVars = requiredVars.filter(varName => !process.env[varName]);

// 修改後  
const missingVars = requiredVars.filter(varName => process.env[varName] === undefined);
```

**變更說明**:
- 原本檢查 `!process.env[varName]` 會拒絕空字串
- 改為只檢查 `=== undefined`，允許空字串通過驗證
- 更新錯誤訊息說明支援空字串用於初始MCP client設定

### 2. 郵件配置建立更新

**檔案**: `src/tools/mail.ts`  
**位置**: 行 51-82

```typescript
// 修改前
host: process.env.SMTP_HOST!,
user: process.env.SMTP_USER!,
pass: process.env.SMTP_PASS!,

// 修改後
host: process.env.SMTP_HOST || '',
user: process.env.SMTP_USER || '',
pass: process.env.SMTP_PASS || '',
```

**變更說明**:
- 移除強制非空斷言 (`!`)
- 使用 `|| ''` 提供空字串預設值

### 3. 郵件服務初始化改進

**檔案**: `src/tools/mail-service.ts`  
**位置**: 行 110-137

```typescript
// 新增方法
private isEmptyConfig(): boolean {
  return !this.config.smtp.host || !this.config.smtp.auth.user || 
         !this.config.imap.host || !this.config.imap.auth.user;
}

private validateConfigForOperation(): void {
  if (this.isEmptyConfig()) {
    throw new Error('郵件配置為空，無法執行郵件操作。請使用有效的郵件配置重新初始化MCP Client。');
  }
}
```

**變更說明**:
- 空配置時創建虛擬SMTP傳輸器 (`streamTransport: true`)
- 創建虛擬IMAP客戶端，避免連接錯誤
- 新增配置驗證方法用於操作前檢查

### 4. 操作級別驗證

**檔案**: `src/tools/mail-service.ts`  
**修改的方法**:

```typescript
// 在以下方法開頭加入驗證
async sendMail(mailInfo: MailInfo): Promise<...> {
  this.validateConfigForOperation(); // ← 新增
  // ... 原有邏輯
}

async getFolders(): Promise<string[]> {
  this.validateConfigForOperation(); // ← 新增
  // ... 原有邏輯
}

// 同樣適用於：searchMails, getMailDetail, testSmtpConnection 等
```

### 5. SSE服務器更新

**檔案**: `src/sse-server.ts`  
**位置**: 行 89-116

```typescript
// 修改前
for (const header of requiredHeaders) {
  if (!config[header as keyof MailConfig]) {
    throw new Error(`Missing required header: ${header}`);
  }
}

// 修改後
for (const header of requiredHeaders) {
  if (config[header as keyof MailConfig] === undefined) {
    throw new Error(`Missing required header: ${header}. Empty strings are allowed for initial MCP client setup.`);
  }
}
```

```typescript
// 修改前
Object.entries(config).forEach(([key, value]) => {
  if (value) {
    process.env[key] = value;
  }
});

// 修改後
Object.entries(config).forEach(([key, value]) => {
  process.env[key] = value || '';
});
```

## 測試驗證

### 基本功能測試

建立測試腳本驗證空配置支援：

```javascript
// 設置空環境變數
process.env.SMTP_HOST = '';
process.env.SMTP_USER = '';
// ... 其他參數

// 測試MCP初始化
const mailMCP = new MailMCP();
// ✓ 應該成功創建實例
// ✓ 應該成功註冊工具
// ✓ 應該能獲取工具列表
```

### SSE模式測試

```bash
# 啟動SSE服務器
node dist/sse-server.js --port 22102

# 測試空標頭連接
curl -H "SMTP_HOST: " -H "SMTP_USER: " ... "http://localhost:22102/sse"
# ✓ 應該返回200狀態碼
```

## 使用流程

### 1. 初始化階段
```bash
# 設置空環境變數或空HTTP標頭
export SMTP_HOST=""
export SMTP_USER=""
# ... 其他參數

# 啟動MCP Client
node dist/index.js
```

### 2. 工具列表獲取
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list"
}
```
✓ 成功返回所有可用工具

### 3. 實際操作（需要有效配置）
```json
{
  "jsonrpc": "2.0", 
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "sendSimpleMail",
    "arguments": {
      "to": "user@example.com",
      "subject": "Test"
    }
  }
}
```
❌ 返回友善錯誤：「郵件配置為空，無法執行郵件操作」

## 向後兼容性

✅ **完全向後兼容**
- 原有的有效配置使用方式不受影響
- 所有現有功能保持正常運作
- 錯誤處理更加友善和明確

## 檔案變更清單

| 檔案 | 變更類型 | 說明 |
|------|----------|------|
| `src/tools/mail.ts` | 修改 | 環境變數驗證邏輯，配置建立邏輯 |
| `src/tools/mail-service.ts` | 修改 | 新增空配置處理，操作驗證 |
| `src/sse-server.ts` | 修改 | HTTP標頭驗證邏輯 |

## 注意事項

### 安全性
- 空配置僅用於工具列表獲取，不會執行實際操作
- 敏感操作仍需要有效憑證
- 錯誤訊息不會洩露配置資訊

### 效能影響
- 空配置使用虛擬傳輸器，記憶體佔用極小
- 不會建立實際網路連接，無網路開銷
- 初始化時間幾乎無影響

### 故障排除

**常見問題1**: 工具調用失敗
```
錯誤: 郵件配置為空，無法執行郵件操作
解決: 使用有效的郵件配置重新初始化MCP Client
```

**常見問題2**: SSE連接被拒絕
```
錯誤: Missing required header: SMTP_HOST
解決: 確保所有必要的HTTP標頭都有設置（可以是空字串）
```

## 後續建議

1. **文檔更新**: 更新README和使用說明，說明新的空配置支援
2. **範例程式**: 提供空配置初始化的範例代碼
3. **測試補強**: 加入自動化測試確保空配置功能穩定
4. **監控**: 考慮加入日誌記錄追蹤空配置的使用情況

## 聯絡資訊

如有問題或需要進一步說明，請聯絡開發團隊。

---
*文檔建立時間: 2025-08-20*  
*實現者: Claude Code*  
*版本: 1.0*