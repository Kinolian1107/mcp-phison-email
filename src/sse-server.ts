#!/usr/bin/env node

import express from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { MailMCP } from './tools/mail.js';
import { ProcessManager } from './tools/process-manager.js';
import { Request, Response } from 'express';

// 隱藏密碼的工具函數
function maskPassword(password: string | undefined): string {
  if (!password) return '';
  return password.length > 0 ? '*'.repeat(8) : '';
}

// 安全日誌輸出
function logConfigSafely(config: any, label: string) {
  const safeConfig = JSON.parse(JSON.stringify(config));
  if (safeConfig.auth && safeConfig.auth.pass) {
    safeConfig.auth.pass = maskPassword(safeConfig.auth.pass);
  }
  if (safeConfig.pass) {
    safeConfig.pass = maskPassword(safeConfig.pass);
  }
  console.log(`${label}:`, JSON.stringify(safeConfig, null, 2));
}

interface MailConfig {
  SMTP_HOST: string;
  SMTP_PORT: string;
  SMTP_SECURE: string;
  SMTP_USER: string;
  SMTP_PASS: string;
  SMTP_ALLOW_UNAUTHORIZED_CERT?: string;
  IMAP_HOST: string;
  IMAP_PORT: string;
  IMAP_SECURE: string;
  IMAP_USER: string;
  IMAP_PASS: string;
  DEFAULT_FROM_NAME?: string;
  DEFAULT_FROM_EMAIL?: string;
}

class MailSSEServer {
  private app: express.Application;
  private transports: Map<string, { transport: SSEServerTransport; mailMCP: MailMCP }> = new Map();
  private processManager: ProcessManager;

  constructor() {
    this.app = express();
    this.app.use(express.json());
    this.processManager = new ProcessManager();
    this.setupRoutes();
  }

  private extractConfigFromHeaders(req: Request): MailConfig {
    // Helper function to get header value with case-insensitive lookup
    const getHeader = (name: string): string | undefined => {
      // Try exact name first
      let value = req.headers[name] as string;
      if (value) return value;
      
      // Try lowercase
      value = req.headers[name.toLowerCase()] as string;
      if (value) return value;
      
      // Try uppercase
      value = req.headers[name.toUpperCase()] as string;
      if (value) return value;
      
      return undefined;
    };

    const config: MailConfig = {
      SMTP_HOST: getHeader('SMTP_HOST') || '',
      SMTP_PORT: getHeader('SMTP_PORT') || '',
      SMTP_SECURE: getHeader('SMTP_SECURE') || '',
      SMTP_USER: getHeader('SMTP_USER') || '',
      SMTP_PASS: getHeader('SMTP_PASS') || '',
      SMTP_ALLOW_UNAUTHORIZED_CERT: getHeader('SMTP_ALLOW_UNAUTHORIZED_CERT') || '',
      IMAP_HOST: getHeader('IMAP_HOST') || '',
      IMAP_PORT: getHeader('IMAP_PORT') || '',
      IMAP_SECURE: getHeader('IMAP_SECURE') || '',
      IMAP_USER: getHeader('IMAP_USER') || '',
      IMAP_PASS: getHeader('IMAP_PASS') || '',
      DEFAULT_FROM_NAME: getHeader('DEFAULT_FROM_NAME') || '',
      DEFAULT_FROM_EMAIL: getHeader('DEFAULT_FROM_EMAIL') || '',
    };

    // Validate required headers (allow empty strings for initial setup)
    const requiredHeaders = [
      'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
      'IMAP_HOST', 'IMAP_USER', 'IMAP_PASS'
    ];

    for (const header of requiredHeaders) {
      if (config[header as keyof MailConfig] === undefined) {
        throw new Error(`Missing required header: ${header}. Empty strings are allowed for initial MCP client setup.`);
      }
    }

    return config;
  }

  private setupRoutes() {
    // SSE endpoint for establishing connections
    this.app.get('/sse', async (req: Request, res: Response) => {
      try {
        console.log('新的SSE連線請求');

        // Extract configuration from headers
        const config = this.extractConfigFromHeaders(req);

        // Set environment variables for this session (including empty strings)
        Object.entries(config).forEach(([key, value]) => {
          process.env[key] = value || '';
        });

        // Create SSE transport
        const transport = new SSEServerTransport('/messages', res);
        const sessionId = transport.sessionId;

        // Create MailMCP instance with the configuration
        const mailMCP = new MailMCP();

        // Store the transport and mailMCP instance
        this.transports.set(sessionId, { transport, mailMCP });

        // Handle connection cleanup
        res.on('close', () => {
          console.log(`SSE連線已關閉，會話ID: ${sessionId}`);
          const entry = this.transports.get(sessionId);
          if (entry) {
            entry.mailMCP.close();
            this.transports.delete(sessionId);
          }
        });

        // Connect the mail MCP to the transport
        await mailMCP.connectToTransport(transport);

        console.log(`SSE連線已建立，會話ID: ${sessionId}`);

      } catch (error) {
        console.error('建立SSE連線錯誤:', error);
        res.status(400).json({ 
          error: error instanceof Error ? error.message : '未知錯誤' 
        });
      }
    });

    // Message endpoint for handling client messages
    this.app.post('/messages', async (req: Request, res: Response) => {
      try {
        const sessionId = req.query.sessionId as string;
        
        if (!sessionId) {
          res.status(400).json({ error: '缺少sessionId查詢參數' });
          return;
        }

        const entry = this.transports.get(sessionId);
        if (!entry) {
          res.status(404).json({ error: '找不到會話' });
          return;
        }

        await entry.transport.handlePostMessage(req, res, req.body);

      } catch (error) {
        console.error('處理訊息錯誤:', error);
        res.status(500).json({ 
          error: error instanceof Error ? error.message : '未知錯誤' 
        });
      }
    });

    // 健康檢查端點
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({ 
        status: 'OK', 
        activeConnections: this.transports.size,
        timestamp: new Date().toISOString()
      });
    });
  }

  public async start(port: number = 3000, host: string = '0.0.0.0') {
    // Check process mutex
    if (!await this.processManager.checkAndCreateLock()) {
      console.log('無法創建MCP實例，程序退出');
      process.exit(1);
    }

    return new Promise<void>((resolve, reject) => {
      const server = this.app.listen(port, host, () => {
        console.log(`Mail MCP SSE 伺服器運行於 ${host}:${port}`);
        console.log(`SSE 端點: http://${host}:${port}/sse`);
        console.log(`訊息端點: http://${host}:${port}/messages`);
        resolve();
      });

      server.on('error', (error) => {
        reject(error);
      });

      // Handle graceful shutdown
      process.on('SIGINT', async () => {
        console.log('正在關閉郵件MCP SSE服務...');
        
        // Close all active connections
        for (const [sessionId, entry] of this.transports) {
          console.log(`Closing session: ${sessionId}`);
          await entry.mailMCP.close();
        }
        
        server.close(() => {
          process.exit(0);
        });
      });

      process.on('SIGTERM', async () => {
        console.log('正在關閉郵件MCP SSE服務...');
        
        // Close all active connections
        for (const [sessionId, entry] of this.transports) {
          console.log(`Closing session: ${sessionId}`);
          await entry.mailMCP.close();
        }
        
        server.close(() => {
          process.exit(0);
        });
      });
    });
  }
}

// 解析命令行參數
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    port: 3000,
    host: '0.0.0.0'
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' || args[i] === '-p') {
      config.port = parseInt(args[i + 1]) || 3000;
      i++;
    } else if (args[i] === '--host' || args[i] === '-h') {
      config.host = args[i + 1] || '0.0.0.0';
      i++;
    } else if (args[i] === '--help') {
      console.log(`
使用方式: node sse-server.js [選項]

選項:
  -p, --port <port>    指定端口號 (預設: 3000)
  -h, --host <host>    指定主機地址 (預設: 0.0.0.0)
  --help              顯示此幫助訊息

環境變數:
  PORT                 端口號 (被命令行參數覆蓋)
  HOST                 主機地址 (被命令行參數覆蓋)

範例:
  node sse-server.js --port 8080 --host localhost
  node sse-server.js -p 3001 -h 0.0.0.0
`);
      process.exit(0);
    }
  }

  // 環境變數作為後備
  if (process.env.PORT) {
    config.port = parseInt(process.env.PORT) || config.port;
  }
  if (process.env.HOST) {
    config.host = process.env.HOST || config.host;
  }

  return config;
}

// 啟動SSE伺服器
async function main() {
  const config = parseArgs();
  const server = new MailSSEServer();
  
  try {
    await server.start(config.port, config.host);
  } catch (error) {
    console.error('啟動SSE伺服器失敗:', error);
    process.exit(1);
  }
}

// 啟動應用
main().catch(error => {
  console.error('SSE服務啟動失敗:', error);
  process.exit(1);
});