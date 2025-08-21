#!/usr/bin/env node

import { MailMCP } from './tools/mail.js';
import { ProcessManager } from './tools/process-manager.js';
import { config } from 'dotenv';

// 載入環境變數
config();

// 主函數
async function main() {
  // 建立程序管理器
  const processManager = new ProcessManager();

  // 檢查程序互斥
  if (!await processManager.checkAndCreateLock()) {
    console.log('Unable to create MCP instance, process exiting');
    process.exit(1);
  }

  // 實例化郵件MCP並連接到stdio傳輸
  const mailMCP = new MailMCP();
  await mailMCP.connectToStdio();

  // 處理程序退出
  process.on('SIGINT', async () => {
    console.log('Shutting down Mail MCP service...');
    await mailMCP.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('Shutting down Mail MCP service...');
    await mailMCP.close();
    process.exit(0);
  });
}

// 啟動應用
main().catch(error => {
  console.error('MCP service startup failed:', error);
  process.exit(1);
}); 