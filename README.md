# Mail MCP 工具

[![Node.js](https://img.shields.io/badge/Node.js-18.x-38a169?style=flat-square)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-2b6cb0?style=flat-square)](https://www.typescriptlang.org/)

[English Version (README-EN.md)](README-EN.md)

## 這是什麽

這是一個基於 MCP (Model Context Protocol) 的郵件工具，它能讓 AI 模型通過標準化接口訪問電子郵件服務。

簡單來說，它讓 AI 助手能夠執行各種郵件操作，如發送郵件、閱讀收件箱、處理附件等，無需用戶手動輸入覆雜的API調用或切換到郵件客戶端。

<details>
<summary><b>支持的功能</b> (點擊展開)</summary>

- **郵件發送**：普通文本郵件、HTML郵件、帶附件郵件、群發郵件
- **郵件接收與查詢**：獲取文件夾列表、列出郵件、高級搜索、獲取郵件詳情
- **郵件管理**：標記已讀/未讀、刪除郵件、移動郵件
- **附件管理**：查看附件列表、下載附件、查看附件內容
- **聯系人管理**：獲取聯系人列表、搜索聯系人
</details>

<details>
<summary><b>功能特點</b> (點擊展開)</summary>

以下是 Mail MCP 工具的一些核心特點：

- **高級搜索功能**：支持多文件夾、關鍵詞、日期範圍、發件人、收件人等覆雜條件搜索
- **智能聯系人管理**：自動從郵件歷史中提取聯系人信息，包括聯系頻率分析
- **內容範圍控制**：可以分段查看大型郵件，避免加載過多內容
- **多種郵件格式**：支持純文本和HTML格式郵件的發送和顯示
- **附件處理能力**：智能識別附件類型，支持文本、圖片等不同類型的附件預覽
- **安全可靠**：本地處理所有郵件操作，不通過第三方服務器轉發敏感信息

通過簡單的自然語言指令，AI 可以幫助你完成上述所有操作，無需手動編寫API調用或在郵件客戶端中執行覆雜操作。
</details>

## 快速上手

### 0. 環境準備

<details>
<summary>如果你之前沒有使用過 Node.js (點擊展開)</summary>

1. 安裝 Node.js 和 npm
   - 訪問 [Node.js 官網](https://nodejs.org/)
   - 下載並安裝 LTS（長期支持）版本
   - 安裝時選擇默認選項即可，安裝包會同時安裝 Node.js 和 npm

2. 驗證安裝
   - 安裝完成後，打開命令提示符（CMD）或 PowerShell
   - 輸入以下命令確認安裝成功：
     ```bash
     node --version
     npm --version
     ```
   - 如果顯示版本號，則表示安裝成功

</details>

### 1. 構建項目

```bash
npm install
npm run build
```

### 2. 啟動服務

```bash
1. SSE
node dist/sse-server.js --port 22102 --host localhost

2. Stdio
{
	"mcpServers": {
		"phison-mail-mcp": {
			"command": "node",
			"args": [
				"dist/index.js"
			],
			"env": {
				"SMTP_HOST": "mail.phison.com",
				"SMTP_PORT": "25",
				"SMTP_SECURE": "false",
				"SMTP_USER": "example@phison.com",
				"SMTP_PASS": "example",
				"SMTP_ALLOW_UNAUTHORIZED_CERT": "false",
				"IMAP_HOST": "mail.phison.com",
				"IMAP_PORT": "993",
				"IMAP_SECURE": "true",
				"IMAP_USER": "example@phison.com",
				"IMAP_PASS": "example",
				"DEFAULT_FROM_NAME": "example",
				"DEFAULT_FROM_EMAIL": "example@phison.com"
			}
		}
	}
}

```

配置好郵件服務器信息後，就可以開始使用了。

<details>
<summary>使用示例 (點擊展開)</summary>

你可以要求 AI 執行以下操作：
- "列出我的郵箱文件夾"
- "顯示收件箱中的最新5封郵件"
- "發送一封主題為'測試郵件'的郵件給example@example.com"
- "測試SMTP連接"（新增功能，可測試郵件服務器連接狀態）
- "搜索包含'發票'關鍵詞的郵件"
- "查看UID為1234的郵件詳情"
- "下載郵件中的附件"
</details>

## 工作原理

<details>
<summary>技術實現細節 (點擊展開)</summary>

本工具基於 **MCP (Model Context Protocol)** 標準實現，作為 AI 模型與電子郵件服務之間的橋梁。它使用 **nodemailer** 和 **node-imap** 作為底層郵件客戶端，並通過 **Zod** 進行請求驗證和類型檢查。

主要技術組件包括：
- **SMTP 客戶端**：負責所有郵件發送功能，支持HTML內容和附件，**特別支持端口25的非TLS/SSL連接**
- **IMAP 客戶端**：負責連接郵箱服務器，獲取郵件列表、詳情和附件
- **郵件解析器**：使用 **mailparser** 解析覆雜的電子郵件格式
- **內容處理**：智能處理HTML和純文本內容，並支持分段加載大型郵件
- **聯系人提取**：從郵件歷史中自動提取和整理聯系人信息
- **連接測試**：內置SMTP連接測試功能，可驗證郵件服務器配置

每個郵件操作都被封裝為標準化的 MCP 工具，接收結構化參數並返回格式化結果。所有數據都經過處理，以確保以人類可讀的格式呈現，使 AI 模型能夠輕松理解電子郵件的內容結構。
</details>


---

由 kino_lian 開發維護
