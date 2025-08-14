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
    console.log('無法建立MCP實例，程序退出');
    process.exit(1);
  }

  // 實例化郵件MCP並連接到stdio傳輸
  const mailMCP = new MailMCP();
  await mailMCP.connectToStdio();

  // 處理程序退出
  process.on('SIGINT', async () => {
    console.log('正在關閉郵件MCP服務...');
    await mailMCP.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('正在關閉郵件MCP服務...');
    await mailMCP.close();
    process.exit(0);
  });
}

// 啟動應用
main().catch(error => {
  console.error('MCP服務啟動失敗:', error);
  process.exit(1);
}); 