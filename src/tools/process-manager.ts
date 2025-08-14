import * as fs from 'fs';
import * as path from 'path';

// 鎖檔案路徑設定
const LOCK_FILE = path.join(process.cwd(), '.mcp-mail.lock');

export class ProcessManager {
  private instanceId: string;

  constructor() {
    // 產生唯一實例ID
    this.instanceId = Date.now().toString();
    
    // 註冊程序退出處理
    this.registerCleanup();
  }

  private registerCleanup(): void {
    // 註冊多個訊號以確保清理
    process.on('SIGINT', () => this.cleanup());
    process.on('SIGTERM', () => this.cleanup());
    process.on('exit', () => this.cleanup());
  }

  private cleanup(): void {
    try {
      if (fs.existsSync(LOCK_FILE)) {
        const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
        // 只清理自己的鎖檔案
        if (lockData.instanceId === this.instanceId) {
          fs.unlinkSync(LOCK_FILE);
          console.log('已清理程序鎖檔案');
        }
      }
    } catch (error) {
      console.error('清理鎖檔案時出錯:', error);
    }
  }

  private async waitForProcessExit(pid: number, timeout: number = 5000): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      try {
        process.kill(pid, 0);
        // 程序還在運行，等待100ms
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (e) {
        // 程序已退出
        return true;
      }
    }
    return false;
  }

  public async checkAndCreateLock(): Promise<boolean> {
    try {
      // 檢查鎖檔案是否存在
      if (fs.existsSync(LOCK_FILE)) {
        const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
        
        try {
          // 檢查程序是否還在運行
          process.kill(lockData.pid, 0);
          console.log('檢測到已有MCP實例運行，發送終止訊號');
          // 發送終止訊號
          process.kill(lockData.pid, 'SIGTERM');
          
          // 等待舊程序退出
          console.log('等待舊實例退出...');
          const exited = await this.waitForProcessExit(lockData.pid);
          if (!exited) {
            console.error('等待舊實例退出逾時');
            return false;
          }
          
          // 刪除舊的鎖檔案
          fs.unlinkSync(LOCK_FILE);
        } catch (e) {
          // 程序不存在，刪除過期的鎖檔案
          console.log('檢測到過期的鎖檔案，將建立新實例');
          fs.unlinkSync(LOCK_FILE);
        }
      }

      // 建立新的鎖檔案
      fs.writeFileSync(LOCK_FILE, JSON.stringify({
        pid: process.pid,
        instanceId: this.instanceId,
        timestamp: Date.now()
      }));

      console.log('已建立MCP實例鎖檔案');
      return true;
    } catch (error) {
      console.error('處理鎖檔案時出錯:', error);
      return false;
    }
  }
} 