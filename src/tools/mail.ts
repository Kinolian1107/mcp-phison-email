import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z } from 'zod';
import { MailService, MailConfig, MailInfo, MailSearchOptions, MailItem } from './mail-service.js';
import path from 'path';
import fs from 'fs';

export class MailMCP {
  private server: McpServer;
  private mailService: MailService | null = null;
  private isConnected: boolean = false;

  constructor() {
    // 初始化MCP服務器
    this.server = new McpServer({
      name: "phison-mail-mcp",
      version: "1.0.0"
    });

    // 註冊工具
    this.registerTools();
  }

  /**
   * 連接到傳輸層並初始化郵件服務
   * 支援stdio和SSE等不同傳輸方式
   */
  public async connectToTransport(transport: Transport): Promise<void> {
    if (this.isConnected) {
      throw new Error('MailMCP is already connected to a transport');
    }

    try {
      // 驗證環境變數並初始化郵件服務
      this.validateEnvironmentVariables();
      const config = this.createMailConfigFromEnv();
      this.mailService = new MailService(config);

      // 連接到傳輸層
      await this.server.connect(transport);
      this.isConnected = true;

      console.log('MailMCP successfully connected to transport');
    } catch (error) {
      console.error('Failed to connect MailMCP to transport:', error);
      throw error;
    }
  }

  /**
   * 從環境變數建立郵件設定
   * 處理空字串配置以支援初始化MCP Client
   */
  private createMailConfigFromEnv(): MailConfig {
    const config: MailConfig = {
      smtp: {
        host: process.env.SMTP_HOST || '',
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER || '',
          pass: process.env.SMTP_PASS || '',
        }
      },
      imap: {
        host: process.env.IMAP_HOST || '',
        port: parseInt(process.env.IMAP_PORT || '993'),
        secure: process.env.IMAP_SECURE === 'true',
        auth: {
          user: process.env.IMAP_USER || '',
          pass: process.env.IMAP_PASS || '',
        }
      },
      defaults: {
        fromName: process.env.DEFAULT_FROM_NAME || process.env.SMTP_USER?.split('@')[0] || '',
        fromEmail: process.env.DEFAULT_FROM_EMAIL || process.env.SMTP_USER || '',
      }
    };

    return config;
  }

  /**
   * 使用stdio傳輸的便捷方法（向後相容）
   */
  public async connectToStdio(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.connectToTransport(transport);
  }

  /**
   * 確保郵件服務已初始化
   */
  private ensureMailService(): MailService {
    if (!this.mailService || !this.isConnected) {
      throw new Error('MailMCP is not connected. Call connectToTransport() first.');
    }
    return this.mailService;
  }

  /**
   * 驗證必要的環境變數是否已設定
   * 支援空字串以允許初始化MCP Client並獲取工具列表
   */
  private validateEnvironmentVariables(): void {
    const requiredVars = [
      'SMTP_HOST',
      'SMTP_USER',
      'SMTP_PASS',
      'IMAP_HOST',
      'IMAP_USER',
      'IMAP_PASS'
    ];

    // 檢查環境變數是否存在（允許空字串）
    const missingVars = requiredVars.filter(varName => process.env[varName] === undefined);

    if (missingVars.length > 0) {
      const errorMessage = `
Missing required environment variables:
${missingVars.join('\n')}

Please set these variables in your .env file:
SMTP_HOST=your.smtp.server
SMTP_PORT=587 (or your server port, 25 for non-TLS)
SMTP_SECURE=true/false (set to false for port 25)
SMTP_USER=your.email@domain.com
SMTP_PASS=your_password

IMAP_HOST=your.imap.server
IMAP_PORT=993 (or your server port)
IMAP_SECURE=true/false
IMAP_USER=your.email@domain.com
IMAP_PASS=your_password

Optional variables:
DEFAULT_FROM_NAME=Your Name
DEFAULT_FROM_EMAIL=your.email@domain.com
SMTP_ALLOW_UNAUTHORIZED_CERT=true/false (控制SSL證書驗證，true=允許未授權證書，false=嚴格驗證)

Note: For port 25 (non-TLS SMTP), set SMTP_SECURE=false
Note: Set SMTP_ALLOW_UNAUTHORIZED_CERT=true if you have SSL certificate issues
Note: Empty strings are allowed for initial MCP client setup
`;
      console.error(errorMessage);
      throw new Error('Missing required environment variables');
    }

    // 驗證端口號
    const smtpPort = parseInt(process.env.SMTP_PORT || '587');
    const imapPort = parseInt(process.env.IMAP_PORT || '993');

    if (isNaN(smtpPort) || smtpPort <= 0 || smtpPort > 65535) {
      throw new Error('Invalid SMTP_PORT. Must be a number between 1 and 65535');
    }

    if (isNaN(imapPort) || imapPort <= 0 || imapPort > 65535) {
      throw new Error('Invalid IMAP_PORT. Must be a number between 1 and 65535');
    }

    // 驗證25端口的特殊設定
    if (smtpPort === 25) {
      const smtpSecure = process.env.SMTP_SECURE;
      if (smtpSecure === 'true') {
        console.warn('Warning: Port 25 detected but SMTP_SECURE=true. For port 25, it is recommended to set SMTP_SECURE=false for non-TLS connections.');
      }
    }
  }

  /**
   * 註冊所有MCP工具
   */
  private registerTools(): void {
    // 郵件發送相關工具
    this.registerSendingTools();
    
    // 郵件接收和查詢相關工具
    this.registerReceivingTools();
    
    // 郵件資料夾管理工具
    this.registerFolderTools();
    
    // 郵件標記工具
    this.registerFlagTools();
  }

  /**
   * 注冊郵件發送相關工具
   */
  private registerSendingTools(): void {
    // 群發郵件工具
    this.server.tool(
      "sendBulkMail",
      "Send bulk emails to multiple recipients with automatic batching and rate limiting. Supports text, HTML content, and attachments. Processes recipients in batches to avoid server limits.",
      {
        to: z.array(z.string()),
        cc: z.array(z.string()).optional(),
        bcc: z.array(z.string()).optional(),
        subject: z.string(),
        text: z.string().optional(),
        html: z.string().optional(),
        attachments: z.array(
          z.object({
            filename: z.string(),
            content: z.union([z.string(), z.instanceof(Buffer)]),
            contentType: z.string().optional()
          })
        ).optional()
      },
      async (params) => {
        try {
          if (!params.text && !params.html) {
            return {
              content: [
                { type: "text", text: `郵件內容不能為空，請提供text或html參數。` }
              ]
            };
          }
          
          console.log(`開始群發郵件，收件人數量: ${params.to.length}`);
          
          const results = [];
          let successCount = 0;
          let failureCount = 0;
          
          // 分批發送，每批最多10個收件人
          const batchSize = 10;
          for (let i = 0; i < params.to.length; i += batchSize) {
            const batch = params.to.slice(i, i + batchSize);
            
            try {
              const result = await this.ensureMailService().sendMail({
                to: batch,
                cc: params.cc,
                bcc: params.bcc,
                subject: params.subject,
                text: params.text,
                html: params.html,
                attachments: params.attachments
              });
              
              results.push(result);
              
              if (result.success) {
                successCount += batch.length;
              } else {
                failureCount += batch.length;
              }
              
              // 添加延遲，避免郵件服務器限制
              if (i + batchSize < params.to.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            } catch (error) {
              console.error(`發送批次 ${i / batchSize + 1} 時出錯:`, error);
              failureCount += batch.length;
            }
          }
          
          return {
            content: [
              { 
                type: "text", 
                text: `群發郵件完成。\n成功: ${successCount}個收件人\n失敗: ${failureCount}個收件人\n\n${
                  failureCount > 0 ? '部分郵件發送失敗，可能是由於郵件服務器限制或收件人地址無效。' : ''
                }`
              }
            ]
          };
        } catch (error) {
          return {
            content: [
              { type: "text", text: `群發郵件時發生錯誤: ${error instanceof Error ? error.message : String(error)}` }
            ]
          };
        }
      }
    );
    
    this.server.tool(
      "sendMail",
      "Send emails to one or more recipients with support for CC, BCC, text/HTML content, and file attachments. Provides comprehensive email sending functionality.",
      {
        to: z.array(z.string()),
        cc: z.string().or(z.array(z.string())).optional(),
        bcc: z.string().or(z.array(z.string())).optional(),
        subject: z.string(),
        text: z.string().optional(),
        html: z.string().optional(),
        useHtml: z.boolean().default(false),
        attachments: z.array(
          z.object({
            filename: z.string(),
            content: z.union([z.string(), z.instanceof(Buffer)]),
            contentType: z.string().optional()
          })
        ).optional()
      },
      async (params) => {
        try {
          // 檢查內容是否提供
          if (!params.text && !params.html) {
            return {
              content: [
                { type: "text", text: `郵件內容不能為空，請提供text或html參數。` }
              ]
            };
          }
          
          // 如果指定使用HTML但沒有提供HTML內容，自動轉換
          if (params.useHtml && !params.html && params.text) {
            // 簡單轉換文本為HTML
            params.html = params.text
              .split('\n')
              .map(line => `<p>${line}</p>`)
              .join('');
          }
          
          // 處理收件人信息，確保to字段一定存在
          const to = params.to;
          
          const mailInfo: MailInfo = {
            to: to,
            subject: params.subject,
            attachments: params.attachments
          };
          
          // 處理抄送和密送信息
          if (params.cc) {
            mailInfo.cc = typeof params.cc === 'string' ? params.cc : params.cc;
          }
          
          if (params.bcc) {
            mailInfo.bcc = typeof params.bcc === 'string' ? params.bcc : params.bcc;
          }
          
          // 設置郵件內容
          if (params.html || (params.useHtml && params.text)) {
            mailInfo.html = params.html || params.text?.split('\n').map(line => `<p>${line}</p>`).join('');
          } else {
            mailInfo.text = params.text;
          }
          
          const result = await this.ensureMailService().sendMail(mailInfo);
          
          if (result.success) {
            return {
              content: [
                { type: "text", text: `郵件發送成功，消息ID: ${result.messageId}\n\n提示：如果需要等待對方回覆，可以使用 waitForReply 工具。` }
              ]
            };
          } else {
            return {
              content: [
                { type: "text", text: `郵件發送失敗: ${result.error}` }
              ]
            };
          }
        } catch (error) {
          return {
            content: [
              { type: "text", text: `發送郵件時發生錯誤: ${error instanceof Error ? error.message : String(error)}` }
            ]
          };
        }
      }
    );

    // 發送簡單郵件工具（保留原有實現）
    this.server.tool(
      "sendSimpleMail",
      "Send a simple text email to a single recipient. A simplified version of sendMail for quick, basic email sending.",
      {
        to: z.string(),
        subject: z.string(),
        body: z.string()
      },
      async ({ to, subject, body }) => {
        try {
          const result = await this.ensureMailService().sendMail({
            to,
            subject,
            text: body
          });
          
          if (result.success) {
            return {
              content: [
                { type: "text", text: `簡單郵件發送成功，消息ID: ${result.messageId}\n\n提示：如果需要等待對方回覆，可以使用 waitForReply 工具。` }
              ]
            };
          } else {
            return {
              content: [
                { type: "text", text: `簡單郵件發送失敗: ${result.error}` }
              ]
            };
          }
        } catch (error) {
          return {
            content: [
              { type: "text", text: `發送簡單郵件時發生錯誤: ${error instanceof Error ? error.message : String(error)}` }
            ]
          };
        }
      }
    );

    // 添加專門的HTML郵件發送工具
    this.server.tool(
      "sendHtmlMail",
      "Send an HTML-formatted email to a single recipient with support for CC, BCC, and file attachments. Ideal for rich content emails.",
      {
        to: z.string(),
        cc: z.string().optional(),
        bcc: z.string().optional(),
        subject: z.string(),
        html: z.string(),
        attachments: z.array(
          z.object({
            filename: z.string(),
            content: z.union([z.string(), z.instanceof(Buffer)]),
            contentType: z.string().optional()
          })
        ).optional()
      },
      async (params) => {
        try {
          const mailInfo: MailInfo = {
            to: params.to,
            subject: params.subject,
            html: params.html
          };
          
          if (params.cc) {
            mailInfo.cc = params.cc;
          }
          
          if (params.bcc) {
            mailInfo.bcc = params.bcc;
          }
          
          if (params.attachments) {
            mailInfo.attachments = params.attachments;
          }
          
          const result = await this.ensureMailService().sendMail(mailInfo);
          
          if (result.success) {
            return {
              content: [
                { type: "text", text: `HTML郵件發送成功，消息ID: ${result.messageId}\n\n提示：如果需要等待對方回覆，可以使用 waitForReply 工具。` }
              ]
            };
          } else {
            return {
              content: [
                { type: "text", text: `HTML郵件發送失敗: ${result.error}` }
              ]
            };
          }
        } catch (error) {
          return {
            content: [
              { type: "text", text: `發送HTML郵件時發生錯誤: ${error instanceof Error ? error.message : String(error)}` }
            ]
          };
        }
      }
    );
  }

  /**
   * 注冊郵件接收和查詢相關工具
   */
  private registerReceivingTools(): void {
    // 等待新郵件回覆
    // 此工具用於等待用戶的郵件回覆。可以多次調用此工具，建議在調用前先檢查現有郵件列表。
    this.server.tool(
      "waitForReply",
      "Wait for new email replies in a specific folder for a specified timeout period. Monitors for incoming emails and returns them when detected.",
      {
        folder: z.string().default('INBOX'),
        timeout: z.number().default(3 * 60 * 60 * 1000)
      },
      async ({ folder, timeout }) => {
        try {
          const result = await this.ensureMailService().waitForNewReply(folder, timeout);
          
          // 如果是未讀郵件警告
          if (result && typeof result === 'object' && 'type' in result && result.type === 'unread_warning') {
            let warningText = `⚠️ 檢測到${result.mails.length}封最近5分鐘內的未讀郵件。\n`;
            warningText += `請先處理（閱讀或回覆）這些郵件，再繼續等待新回覆：\n\n`;
            
            result.mails.forEach((mail, index) => {
              const fromStr = mail.from.map(f => f.name ? `${f.name} <${f.address}>` : f.address).join(', ');
              warningText += `${index + 1}. 主題: ${mail.subject}\n`;
              warningText += `   發件人: ${fromStr}\n`;
              warningText += `   時間: ${mail.date.toLocaleString()}\n`;
              warningText += `   UID: ${mail.uid}\n\n`;
            });
            
            warningText += `提示：\n`;
            warningText += `1. 使用 markAsRead 工具將郵件標記為已讀\n`;
            warningText += `2. 使用 getEmailDetail 工具查看郵件詳情\n`;
            warningText += `3. 處理完這些郵件後，再次調用 waitForReply 工具等待新回覆\n`;
            
            return {
              content: [
                { type: "text", text: warningText }
              ]
            };
          }
          
          // 如果超時
          if (!result) {
            return {
              content: [
                { type: "text", text: `等待郵件回覆超時（${timeout / 1000}秒）` }
              ]
            };
          }

          // 收到新郵件
          const email = result as MailItem;  // 添加類型斷言
          const fromStr = email.from.map(f => f.name ? `${f.name} <${f.address}>` : f.address).join(', ');
          const date = email.date.toLocaleString();
          const status = email.isRead ? '已讀' : '未讀';
          const attachmentInfo = email.hasAttachments ? '📎' : '';
          
          let resultText = `收到新郵件！\n\n`;
          resultText += `[${status}] ${attachmentInfo} 來自: ${fromStr}\n`;
          resultText += `主題: ${email.subject}\n`;
          resultText += `時間: ${date}\n`;
          resultText += `UID: ${email.uid}\n\n`;
          
          if (email.textBody) {
            resultText += `內容:\n${email.textBody}\n\n`;
          }
          
          return {
            content: [
              { type: "text", text: resultText }
            ]
          };
        } catch (error) {
          return {
            content: [
              { type: "text", text: `等待郵件回覆時發生錯誤: ${error instanceof Error ? error.message : String(error)}` }
            ]
          };
        }
      }
    );

    // 高級郵件搜索 - 支持多文件夾和覆雜條件
    this.server.tool(
      "searchEmails",
      "Search for emails across multiple folders using keywords, date ranges, sender/recipient filters. Provides comprehensive email search capabilities.",
      {
        keywords: z.string().optional(),
        folders: z.array(z.string()).optional(),
        startDate: z.union([z.date(), z.string().datetime({ message: "startDate 必須是有效的 ISO 8601 日期時間字符串或 Date 對象" })]).optional(),
        endDate: z.union([z.date(), z.string().datetime({ message: "endDate 必須是有效的 ISO 8601 日期時間字符串或 Date 對象" })]).optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        subject: z.string().optional(),
        hasAttachment: z.boolean().optional(),
        maxResults: z.number().default(50),
        includeBody: z.boolean().default(false)
      },
      async (params) => {
        try {
          console.log(`開始執行高級郵件搜索，關鍵詞: ${params.keywords || '無'}`);
          
          // 處理日期字符串
          const startDate = typeof params.startDate === 'string' ? new Date(params.startDate) : params.startDate;
          const endDate = typeof params.endDate === 'string' ? new Date(params.endDate) : params.endDate;

          const emails = await this.ensureMailService().advancedSearchMails({
            folders: params.folders,
            keywords: params.keywords,
            startDate: startDate,
            endDate: endDate,
            from: params.from,
            to: params.to,
            subject: params.subject,
            hasAttachment: params.hasAttachment,
            maxResults: params.maxResults,
            includeBody: params.includeBody
          });
          
          // 轉換為人類可讀格式
          if (emails.length === 0) {
            return {
              content: [
                { type: "text", text: `沒有找到符合條件的郵件。` }
              ]
            };
          }
          
          const searchTerms = [];
          if (params.keywords) searchTerms.push(`關鍵詞"${params.keywords}"`);
          if (params.from) searchTerms.push(`發件人包含"${params.from}"`);
          if (params.to) searchTerms.push(`收件人包含"${params.to}"`);
          if (params.subject) searchTerms.push(`主題包含"${params.subject}"`);
          if (startDate) searchTerms.push(`開始日期${startDate.toLocaleDateString()}`);
          if (endDate) searchTerms.push(`結束日期${endDate.toLocaleDateString()}`);
          if (params.hasAttachment) searchTerms.push(`包含附件`);
          
          const searchDescription = searchTerms.length > 0 
            ? `搜索條件: ${searchTerms.join(', ')}` 
            : '所有郵件';
          
          let resultText = `🔍 郵件搜索結果 (${emails.length}封郵件)\n${searchDescription}\n\n`;
          
          emails.forEach((email, index) => {
            const fromStr = email.from.map(f => f.name ? `${f.name} <${f.address}>` : f.address).join(', ');
            const date = email.date.toLocaleString();
            const status = email.isRead ? '已讀' : '未讀';
            const attachmentInfo = email.hasAttachments ? '有' : '';
            const folder = email.folder;
            
            resultText += `${index + 1}. [${status}] ${attachmentInfo} 來自: ${fromStr}\n`;
            resultText += `   主題: ${email.subject}\n`;
            resultText += `   時間: ${date}\n`;
            resultText += `   文件夾: ${folder}\n`;
            resultText += `   UID: ${email.uid}\n\n`;
          });
          
          resultText += `使用 getEmailDetail 工具並提供 UID 和 folder 可以查看郵件詳情。`;
          
          return {
            content: [
              { type: "text", text: resultText }
            ]
          };
        } catch (error) {
          return {
            content: [
              { type: "text", text: `搜索郵件時發生錯誤: ${error instanceof Error ? error.message : String(error)}` }
            ]
          };
        }
      }
    );

    // 獲取收件箱郵件列表
    this.server.tool(
      "listEmails",
      "List emails from a specific folder with pagination and read status filtering. Returns email summaries including subject, sender, date, and read status.",
      {
        folder: z.string().default('INBOX'),
        limit: z.number().default(20),
        readStatus: z.enum(['read', 'unread', 'all']).default('all'),
        from: z.string().optional(),
        to: z.string().optional(),
        subject: z.string().optional(),
        fromDate: z.union([z.date(), z.string().datetime({ message: "fromDate 必須是有效的 ISO 8601 日期時間字符串或 Date 對象" })]).optional(),
        toDate: z.union([z.date(), z.string().datetime({ message: "toDate 必須是有效的 ISO 8601 日期時間字符串或 Date 對象" })]).optional(),
        hasAttachments: z.boolean().optional()
      },
      async (params) => {
        try {
          // 處理日期字符串
          const fromDate = typeof params.fromDate === 'string' ? new Date(params.fromDate) : params.fromDate;
          const toDate = typeof params.toDate === 'string' ? new Date(params.toDate) : params.toDate;
          
          const options: MailSearchOptions = {
            folder: params.folder,
            limit: params.limit,
            readStatus: params.readStatus,
            from: params.from,
            to: params.to,
            subject: params.subject,
            fromDate: fromDate,
            toDate: toDate,
            hasAttachments: params.hasAttachments
          };

          const emails = await this.ensureMailService().searchMails(options);
          
          // 轉換為人類可讀格式
          if (emails.length === 0) {
            return {
              content: [
                { type: "text", text: `在${params.folder}文件夾中沒有找到符合條件的郵件。` }
              ]
            };
          }
          
          let resultText = `在${params.folder}文件夾中找到了${emails.length}封郵件：\n\n`;
          
          emails.forEach((email, index) => {
            const fromStr = email.from.map(f => f.name ? `${f.name} <${f.address}>` : f.address).join(', ');
            const date = email.date.toLocaleString();
            const status = email.isRead ? '已讀' : '未讀';
            const attachmentInfo = email.hasAttachments ? '📎' : '';
            
            resultText += `${index + 1}. [${status}] ${attachmentInfo} 來自: ${fromStr}\n`;
            resultText += `   主題: ${email.subject}\n`;
            resultText += `   時間: ${date}\n`;
            resultText += `   UID: ${email.uid}\n\n`;
          });
          
          resultText += `使用 getEmailDetail 工具並提供 UID 可以查看郵件詳情。`;
          
          return {
            content: [
              { type: "text", text: resultText }
            ]
          };
        } catch (error) {
          return {
            content: [
              { type: "text", text: `獲取郵件列表時發生錯誤: ${error instanceof Error ? error.message : String(error)}` }
            ]
          };
        }
      }
    );

    // 獲取通訊錄
    this.server.tool(
      "getContacts",
      "Extract contact information from email history with frequency analysis. Searches through email addresses and provides contact usage statistics.",
      {
        maxResults: z.number().default(50),
        searchTerm: z.string().optional()
      },
      async (params) => {
        try {
          const result = await this.ensureMailService().getContacts({
            maxResults: params.maxResults,
            searchTerm: params.searchTerm
          });
          
          const contacts = result.contacts;
          
          // 轉換為人類可讀格式
          if (contacts.length === 0) {
            const message = params.searchTerm 
              ? `沒有找到包含"${params.searchTerm}"的聯系人。` 
              : `沒有找到任何聯系人。`;
            
            return {
              content: [
                { type: "text", text: message }
              ]
            };
          }
          
          const header = params.searchTerm 
            ? `📋 搜索結果: 包含"${params.searchTerm}"的聯系人 (${contacts.length}個):\n\n` 
            : `📋 聯系人列表 (${contacts.length}個):\n\n`;
          
          let resultText = header;
          
          contacts.forEach((contact, index) => {
            const name = contact.name || '(無名稱)';
            const frequency = contact.frequency;
            const lastContact = contact.lastContact ? contact.lastContact.toLocaleDateString() : '未知';
            
            resultText += `${index + 1}. ${name} <${contact.email}>\n`;
            resultText += `   郵件頻率: ${frequency}次\n`;
            resultText += `   最後聯系: ${lastContact}\n\n`;
          });
          
          return {
            content: [
              { type: "text", text: resultText }
            ]
          };
        } catch (error) {
          return {
            content: [
              { type: "text", text: `獲取聯系人時發生錯誤: ${error instanceof Error ? error.message : String(error)}` }
            ]
          };
        }
      }
    );

    // 獲取郵件詳情
    this.server.tool(
      "getEmailDetail",
      "Get detailed information about a specific email including full content, headers, attachments list. Supports content range limiting for large emails.",
      {
        uid: z.number(),
        folder: z.string().default('INBOX'),
        contentRange: z.object({
          start: z.number().default(0),
          end: z.number().default(2000)
        }).optional()
      },
      async ({ uid, folder, contentRange }) => {
        try {
          // 對於QQ郵箱的特殊處理，先嘗試獲取郵件詳情
          const numericUid = Number(uid);
          let email = await this.ensureMailService().getMailDetail(numericUid, folder);
          
          // 如果正常獲取失敗，嘗試通過搜索來獲取指定UID的郵件
          if (!email) {
            console.log(`通過常規方法獲取郵件詳情失敗，嘗試使用搜索方法獲取UID為${numericUid}的郵件`);
            const searchResults = await this.ensureMailService().searchMails({ 
              folder: folder,
              limit: 50 // 搜索更多郵件以提高找到目標的可能性
            });
            
            // 從搜索結果中找到指定UID的郵件
            const foundEmail = searchResults.find(e => e.uid === numericUid);
            if (foundEmail) {
              console.log(`在搜索結果中找到了UID為${numericUid}的郵件`);
              email = foundEmail;
              
              // 嘗試獲取郵件正文（如果沒有）
              if (!email.textBody && !email.htmlBody) {
                console.log(`郵件沒有正文內容，嘗試單獨獲取正文`);
                try {
                  // 這里可以添加額外的嘗試獲取正文的邏輯
                  // ...
                } catch (e) {
                  console.error('獲取郵件正文時出錯:', e);
                }
              }
            }
          }
          
          if (!email) {
            return {
              content: [
                { type: "text", text: `未找到UID為${numericUid}的郵件` }
              ]
            };
          }
          
          // 轉換為人類可讀格式
          const fromStr = email.from.map(f => f.name ? `${f.name} <${f.address}>` : f.address).join(', ');
          const toStr = email.to.map(t => t.name ? `${t.name} <${t.address}>` : t.address).join(', ');
          const ccStr = email.cc ? email.cc.map(c => c.name ? `${c.name} <${c.address}>` : c.address).join(', ') : '';
          const date = email.date.toLocaleString();
          const status = email.isRead ? '已讀' : '未讀';
          
          let resultText = `📧 郵件詳情 (UID: ${email.uid})\n\n`;
          resultText += `主題: ${email.subject}\n`;
          resultText += `發件人: ${fromStr}\n`;
          resultText += `收件人: ${toStr}\n`;
          if (ccStr) resultText += `抄送: ${ccStr}\n`;
          resultText += `日期: ${date}\n`;
          resultText += `狀態: ${status}\n`;
          resultText += `文件夾: ${email.folder}\n`;
          
          if (email.hasAttachments && email.attachments && email.attachments.length > 0) {
            resultText += `\n📎 附件 (${email.attachments.length}個):\n`;
            email.attachments.forEach((att, index) => {
              const sizeInKB = Math.round(att.size / 1024);
              resultText += `${index + 1}. ${att.filename} (${sizeInKB} KB, ${att.contentType})\n`;
            });
          }
          
          // 獲取郵件內容
          let content = '';
          if (email.textBody) {
            content = email.textBody;
          } else if (email.htmlBody) {
            // 簡單的HTML轉文本處理
            content = '(HTML內容，顯示純文本版本)\n\n' + 
              email.htmlBody
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<\/p>/gi, '\n\n')
                .replace(/<[^>]*>/g, '');
          } else {
            content = '(郵件沒有文本內容或內容無法獲取)\n\n' +
              '可能原因：\n' +
              '1. QQ郵箱IMAP訪問限制\n' +
              '2. 郵件內容格式特殊\n' +
              '建議直接在QQ郵箱網頁或客戶端查看完整內容';
          }
          
          // 計算內容總長度
          const totalLength = content.length;
          
          // 設置默認範圍
          const start = contentRange?.start || 0;
          const end = Math.min(contentRange?.end || 2000, totalLength);
          
          // 根據範圍截取內容
          const selectedContent = content.substring(start, end);
          
          resultText += `\n📄 內容 (${start+1}-${end}/${totalLength}字符):\n\n`;
          resultText += selectedContent;
          
          // 如果有更多內容，添加提示
          if (end < totalLength) {
            resultText += `\n\n[...]\n\n(內容過長，僅顯示前${end}個字符。使用contentRange參數可查看更多內容，例如查看${end+1}-${Math.min(end+2000, totalLength)}範圍：contentRange.start=${end}, contentRange.end=${Math.min(end+2000, totalLength)})`;
          }
          
          return {
            content: [
              { type: "text", text: resultText }
            ]
          };
        } catch (error) {
          return {
            content: [
              { type: "text", text: `獲取郵件詳情時發生錯誤: ${error instanceof Error ? error.message : String(error)}` }
            ]
          };
        }
      }
    );

    // 刪除郵件
    this.server.tool(
      "deleteEmail",
      "Delete a specific email from a folder using its UID. Permanently removes the email from the mail server.",
      {
        uid: z.number(),
        folder: z.string().default('INBOX')
      },
      async ({ uid, folder }) => {
        try {
          const numericUid = Number(uid);
          const success = await this.ensureMailService().deleteMail(numericUid, folder);
          
          if (success) {
            return {
              content: [
                { type: "text", text: `郵件(UID: ${numericUid})已從${folder}文件夾中刪除` }
              ]
            };
          } else {
            return {
              content: [
                { type: "text", text: `刪除郵件(UID: ${numericUid})失敗` }
              ]
            };
          }
        } catch (error) {
          return {
            content: [
              { type: "text", text: `刪除郵件時發生錯誤: ${error instanceof Error ? error.message : String(error)}` }
            ]
          };
        }
      }
    );

    // 移動郵件到其他文件夾
    this.server.tool(
      "moveEmail",
      "Move an email from one folder to another using its UID. Useful for organizing emails into different mailbox folders.",
      {
        uid: z.number(),
        sourceFolder: z.string(),
        targetFolder: z.string()
      },
      async ({ uid, sourceFolder, targetFolder }) => {
        try {
          const numericUid = Number(uid);
          const success = await this.ensureMailService().moveMail(numericUid, sourceFolder, targetFolder);
          
          if (success) {
            return {
              content: [
                { type: "text", text: `郵件(UID: ${numericUid})已成功從"${sourceFolder}"移動到"${targetFolder}"文件夾` }
              ]
            };
          } else {
            return {
              content: [
                { type: "text", text: `移動郵件(UID: ${numericUid})失敗` }
              ]
            };
          }
        } catch (error) {
          return {
            content: [
              { type: "text", text: `移動郵件時發生錯誤: ${error instanceof Error ? error.message : String(error)}` }
            ]
          };
        }
      }
    );

    // 添加獲取附件工具
    this.server.tool(
      "getAttachment",
      "Download and view email attachments by email UID and attachment index. Supports various attachment types with content preview capabilities.",
      {
        uid: z.number(),
        folder: z.string().default('INBOX'),
        attachmentIndex: z.number(),
        saveToFile: z.boolean().default(true)
      },
      async (params) => {
        try {
          const attachment = await this.ensureMailService().getAttachment(
            params.uid, 
            params.folder, 
            params.attachmentIndex
          );
          
          if (!attachment) {
            return {
              content: [
                { type: "text", text: `未找到UID為${params.uid}的郵件的第${params.attachmentIndex}個附件` }
              ]
            };
          }
          
          // 根據是否保存到文件處理附件
          if (params.saveToFile) {
            // 創建附件保存目錄
            const downloadDir = path.join(process.cwd(), 'downloads');
            if (!fs.existsSync(downloadDir)) {
              fs.mkdirSync(downloadDir, { recursive: true });
            }
            
            // 生成安全的文件名（去除非法字符）
            const safeFilename = attachment.filename.replace(/[/\\?%*:|"<>]/g, '-');
            const filePath = path.join(downloadDir, safeFilename);
            
            // 寫入文件
            fs.writeFileSync(filePath, attachment.content);
            
            return {
              content: [
                { 
                  type: "text", 
                  text: `附件 "${attachment.filename}" 已下載保存至 ${filePath}\n類型: ${attachment.contentType}\n大小: ${Math.round(attachment.content.length / 1024)} KB` 
                }
              ]
            };
          } else {
            // 根據內容類型處理內容
            if (attachment.contentType.startsWith('text/') || 
                attachment.contentType === 'application/json') {
              // 文本文件顯示內容
              const textContent = attachment.content.toString('utf-8');
              return {
                content: [
                  { 
                    type: "text", 
                    text: `📎 附件 "${attachment.filename}" (${attachment.contentType})\n\n${textContent.substring(0, 10000)}${textContent.length > 10000 ? '\n\n[內容過長，已截斷]' : ''}` 
                  }
                ]
              };
            } else if (attachment.contentType.startsWith('image/')) {
              // 圖片文件提供Base64編碼
              const base64Content = attachment.content.toString('base64');
              return {
                content: [
                  { 
                    type: "text", 
                    text: `📎 圖片附件 "${attachment.filename}" (${attachment.contentType})\n大小: ${Math.round(attachment.content.length / 1024)} KB\n\n[圖片內容已轉為Base64編碼，可用於在線預覽]` 
                  }
                ]
              };
            } else {
              // 其他二進制文件
              return {
                content: [
                  { 
                    type: "text", 
                    text: `📎 二進制附件 "${attachment.filename}" (${attachment.contentType})\n大小: ${Math.round(attachment.content.length / 1024)} KB\n\n[二進制內容無法直接顯示]` 
                  }
                ]
              };
            }
          }
        } catch (error) {
          return {
            content: [
              { type: "text", text: `獲取附件時發生錯誤: ${error instanceof Error ? error.message : String(error)}` }
            ]
          };
        }
      }
    );
  }

  /**
   * 注冊文件夾管理工具
   */
  private registerFolderTools(): void {
    // 獲取所有郵件文件夾
    this.server.tool(
      "listFolders",
      "List all available email folders/mailboxes in the email account. Returns folder names and hierarchy for navigation.",
      { random_string: z.string().optional() },
      async () => {
        try {
          const folders = await this.ensureMailService().getFolders();
          
          if (folders.length === 0) {
            return {
              content: [
                { type: "text", text: "沒有找到郵件文件夾。" }
              ]
            };
          }
          
          let resultText = `📁 郵件文件夾列表 (${folders.length}個):\n\n`;
          folders.forEach((folder, index) => {
            resultText += `${index + 1}. ${folder}\n`;
          });
          
          return {
            content: [
              { type: "text", text: resultText }
            ]
          };
        } catch (error) {
          return {
            content: [
              { type: "text", text: `獲取郵件文件夾列表時發生錯誤: ${error instanceof Error ? error.message : String(error)}` }
            ]
          };
        }
      }
    );
  }

  /**
   * 注冊郵件標記工具
   */
  private registerFlagTools(): void {
    // 批量將郵件標記為已讀
    this.server.tool(
      "markMultipleAsRead",
      "Mark multiple emails as read using their UIDs. Batch operation for efficiently updating read status of several emails at once.",
      {
        uids: z.array(z.number()),
        folder: z.string().default('INBOX')
      },
      async ({ uids, folder }) => {
        try {
          const numericUids = uids.map(uid => Number(uid));
          const success = await this.ensureMailService().markMultipleAsRead(numericUids, folder);
          
          if (success) {
            return {
              content: [
                { type: "text", text: `已將 ${uids.length} 封郵件標記為已讀` }
              ]
            };
          } else {
            return {
              content: [
                { type: "text", text: `批量標記郵件為已讀失敗` }
              ]
            };
          }
        } catch (error) {
          return {
            content: [
              { type: "text", text: `批量標記郵件為已讀時發生錯誤: ${error instanceof Error ? error.message : String(error)}` }
            ]
          };
        }
      }
    );

    // 批量將郵件標記為未讀
    this.server.tool(
      "markMultipleAsUnread",
      "Mark multiple emails as unread using their UIDs. Batch operation for efficiently updating unread status of several emails at once.",
      {
        uids: z.array(z.number()),
        folder: z.string().default('INBOX')
      },
      async ({ uids, folder }) => {
        try {
          const numericUids = uids.map(uid => Number(uid));
          const success = await this.ensureMailService().markMultipleAsUnread(numericUids, folder);
          
          if (success) {
            return {
              content: [
                { type: "text", text: `已將 ${uids.length} 封郵件標記為未讀` }
              ]
            };
          } else {
            return {
              content: [
                { type: "text", text: `批量標記郵件為未讀失敗` }
              ]
            };
          }
        } catch (error) {
          return {
            content: [
              { type: "text", text: `批量標記郵件為未讀時發生錯誤: ${error instanceof Error ? error.message : String(error)}` }
            ]
          };
        }
      }
    );

    // 將郵件標記為已讀
    this.server.tool(
      "markAsRead",
      "Mark a specific email as read using its UID. Updates the read status flag on the email server.",
      {
        uid: z.number(),
        folder: z.string().default('INBOX')
      },
      async ({ uid, folder }) => {
        try {
          const numericUid = Number(uid);
          const success = await this.ensureMailService().markAsRead(numericUid, folder);
          
          if (success) {
            return {
              content: [
                { type: "text", text: `郵件(UID: ${uid})已標記為已讀` }
              ]
            };
          } else {
            return {
              content: [
                { type: "text", text: `標記郵件(UID: ${uid})為已讀失敗` }
              ]
            };
          }
        } catch (error) {
          return {
            content: [
              { type: "text", text: `標記郵件為已讀時發生錯誤: ${error instanceof Error ? error.message : String(error)}` }
            ]
          };
        }
      }
    );

    // 將郵件標記為未讀
    this.server.tool(
      "markAsUnread",
      "Mark a specific email as unread using its UID. Updates the unread status flag on the email server.",
      {
        uid: z.number(),
        folder: z.string().default('INBOX')
      },
      async ({ uid, folder }) => {
        try {
          const numericUid = Number(uid);
          const success = await this.ensureMailService().markAsUnread(numericUid, folder);
          
          if (success) {
            return {
              content: [
                { type: "text", text: `郵件(UID: ${uid})已標記為未讀` }
              ]
            };
          } else {
            return {
              content: [
                { type: "text", text: `標記郵件(UID: ${uid})為未讀失敗` }
              ]
            };
          }
        } catch (error) {
          return {
            content: [
              { type: "text", text: `標記郵件為未讀時發生錯誤: ${error instanceof Error ? error.message : String(error)}` }
            ]
          };
        }
      }
    );

    // 測試SMTP連接
    this.server.tool(
      "testSmtpConnection",
      "Test the SMTP server connection and authentication. Validates email server configuration and provides troubleshooting information.",
      {},
      async () => {
        try {
          const result = await this.ensureMailService().testSmtpConnection();
          
          if (result.success) {
            return {
              content: [
                { type: "text", text: `✅ SMTP連接測試成功！\n\n配置信息：\n- 主機: ${result.config.host}\n- 端口: ${result.config.port}\n- 安全連接: ${result.config.secure ? '是' : '否'}` }
              ]
            };
          } else {
            return {
              content: [
                { type: "text", text: `❌ SMTP連接測試失敗！\n\n錯誤信息: ${result.error}\n\n當前配置：\n- 主機: ${result.config.host}\n- 端口: ${result.config.port}\n- 安全連接: ${result.config.secure ? '是' : '否'}\n\n請檢查您的SMTP配置是否正確。` }
              ]
            };
          }
        } catch (error) {
          return {
            content: [
              { type: "text", text: `測試SMTP連接時發生錯誤: ${error instanceof Error ? error.message : String(error)}` }
              ]
            };
        }
      }
    );
  }

  /**
   * 關閉所有連接
   */
  async close(): Promise<void> {
    if (this.mailService) {
      await this.ensureMailService().close();
    }
    this.isConnected = false;
  }
} 