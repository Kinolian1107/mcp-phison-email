import nodemailer from 'nodemailer';
import IMAP from 'imap';
import { simpleParser, ParsedMail, AddressObject } from 'mailparser';
import { Readable } from 'stream';
import { promisify } from 'util';

// 隱藏密碼的工具函數
function maskPassword(password: string | undefined): string {
  if (!password) return '';
  return password.length > 0 ? '*'.repeat(8) : '';
}

// 安全日誌輸出 - 隱藏敏感資訊
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

// 郵件設定介面
export interface MailConfig {
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    auth: {
      user: string;
      pass: string;
    }
  },
  imap: {
    host: string;
    port: number;
    secure: boolean;
    auth: {
      user: string;
      pass: string;
    }
  },
  defaults: {
    fromName: string;
    fromEmail: string;
  }
}

// 郵件信息接口
export interface MailInfo {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
    contentType?: string;
  }>;
}

// 郵件查詢選項
export interface MailSearchOptions {
  folder?: string;
  readStatus?: 'read' | 'unread' | 'all';
  fromDate?: Date;
  toDate?: Date;
  from?: string;
  to?: string;
  subject?: string;
  hasAttachments?: boolean;
  limit?: number;
}

// 郵件項
export interface MailItem {
  id: string;
  uid: number;
  subject: string;
  from: { name?: string; address: string }[];
  to: { name?: string; address: string }[];
  cc?: { name?: string; address: string }[];
  date: Date;
  isRead: boolean;
  hasAttachments: boolean;
  attachments?: { filename: string; contentType: string; size: number }[];
  textBody?: string;
  htmlBody?: string;
  flags?: string[];
  size: number;
  folder: string;
}

// 地址信息接口
interface EmailAddress {
  name?: string;
  address: string;
}

export class MailService {
  private smtpTransporter: nodemailer.Transporter;
  private imapClient: IMAP;
  private config: MailConfig;
  private isImapConnected = false;

  /**
   * 檢查是否為空配置
   */
  private isEmptyConfig(): boolean {
    return !this.config.smtp.host || !this.config.smtp.auth.user || 
           !this.config.imap.host || !this.config.imap.auth.user;
  }

  /**
   * 驗證配置是否有效，用於實際郵件操作
   */
  private validateConfigForOperation(): void {
    if (this.isEmptyConfig()) {
      throw new Error('Mail configuration is empty, cannot perform email operations. Please reinitialize MCP Client with valid mail configuration.');
    }
  }

  constructor(config: MailConfig) {
    this.config = config;

    // 檢查是否為空配置（支援初始化MCP Client獲取工具列表）
    if (this.isEmptyConfig()) {
      console.log('Empty configuration detected, initializing MCP service only without establishing mail connection');
      // 為空配置創建虛擬傳輸器，避免初始化錯誤
      this.smtpTransporter = nodemailer.createTransport({
        streamTransport: true,
        newline: 'unix',
        buffer: true
      });
      
      // 為空配置創建虛擬IMAP客戶端
      this.imapClient = new IMAP({
        user: 'dummy',
        password: 'dummy',
        host: 'dummy',
        port: 993,
        tls: true,
        connTimeout: 1000,
        authTimeout: 1000
      });
      return;
    }

    // 根據使用者配置決定是否允許未授權的SSL證書
    const allowUnauthorizedCert = process.env.SMTP_ALLOW_UNAUTHORIZED_CERT === 'true';
    
    if (allowUnauthorizedCert) {
      // 如果使用者設定允許未授權證書，則設置環境變數為1（拒絕未授權證書，但允許連接）
      if (process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '1') {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1';
        console.log('User setting SMTP_ALLOW_UNAUTHORIZED_CERT=true, set NODE_TLS_REJECT_UNAUTHORIZED=1 (allow unauthorized certificate connections)');
      }
    } else {
      // 如果使用者設定不允許未授權證書，則設置為0（嚴格拒絕未授權證書）
      if (process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0') {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
        console.log('User setting SMTP_ALLOW_UNAUTHORIZED_CERT=false, set NODE_TLS_REJECT_UNAUTHORIZED=0 (strict SSL validation, reject unauthorized certificates)');
      }
    }

    // 創建SMTP傳輸器，特殊處理25端口
    const smtpConfig: any = {
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: {
        user: config.smtp.auth.user,
        pass: config.smtp.auth.pass,
      }
    };

    // 根據使用者配置決定SSL選項
    if (allowUnauthorizedCert) {
      // 強制設置所有SSL相關選項（允許未授權證書）
      smtpConfig.tls = {
        rejectUnauthorized: false,
        servername: config.smtp.host,
        checkServerIdentity: () => undefined
      };
      smtpConfig.allowUnauthorizedTls = true;
      smtpConfig.ignoreTLS = false;
    } else {
      // 使用嚴格SSL驗證
      smtpConfig.tls = {
        rejectUnauthorized: true,
        servername: config.smtp.host
      };
      smtpConfig.allowUnauthorizedTls = false;
      smtpConfig.ignoreTLS = false;
    }

    // 特殊處理25端口，不使用TLS/SSL
    if (config.smtp.port === 25) {
      smtpConfig.secure = false;
      smtpConfig.ignoreTLS = true;
      smtpConfig.requireTLS = false;
      smtpConfig.requireSSL = false;
      // 對於25端口，添加額外的配置以確保不使用加密
      smtpConfig.tls = false;
      smtpConfig.allowUnauthorizedTls = false;
      
      console.log('Port 25 detected, configured for non-TLS/SSL mode');
      logConfigSafely({
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.secure,
        ignoreTLS: smtpConfig.ignoreTLS
      }, 'SMTP Configuration');
    } else {
      // 對於其他端口，添加SSL證書處理
      console.log('Encrypted port detected, SSL certificate handling options configured');
      logConfigSafely({
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.secure,
        tls: smtpConfig.tls,
        allowUnauthorizedTls: smtpConfig.allowUnauthorizedTls
      }, 'SMTP Configuration');
    }

    logConfigSafely(smtpConfig, 'Final SMTP Configuration');

    this.smtpTransporter = nodemailer.createTransport(smtpConfig);

    // 創建IMAP客戶端
    this.imapClient = new IMAP({
      user: config.imap.auth.user,
      password: config.imap.auth.pass,
      host: config.imap.host,
      port: config.imap.port,
      tls: config.imap.secure,
      tlsOptions: { rejectUnauthorized: false },
    });

    // 監聽IMAP連接錯誤
    this.imapClient.on('error', (err: Error) => {
      console.error('IMAP Error:', err);
      this.isImapConnected = false;
    });
  }

  /**
   * 連接到IMAP服務器
   */
  async connectImap(): Promise<void> {
    if (this.isImapConnected) return;
    
    return new Promise((resolve, reject) => {
      this.imapClient.once('ready', () => {
        this.isImapConnected = true;
        resolve();
      });

      this.imapClient.once('error', (err: Error) => {
        reject(err);
      });

      this.imapClient.connect();
    });
  }

  /**
   * 關閉IMAP連接
   */
  closeImap(): void {
    if (this.isImapConnected) {
      this.imapClient.end();
      this.isImapConnected = false;
    }
  }

  /**
   * 發送郵件
   */
  async sendMail(mailInfo: MailInfo): Promise<{ success: boolean; messageId?: string; error?: string }> {
    this.validateConfigForOperation();
    try {
      const mailOptions = {
        from: {
          name: this.config.defaults.fromName,
          address: this.config.defaults.fromEmail,
        },
        to: mailInfo.to,
        cc: mailInfo.cc,
        bcc: mailInfo.bcc,
        subject: mailInfo.subject,
        text: mailInfo.text,
        html: mailInfo.html,
        attachments: mailInfo.attachments,
      };

      const info = await this.smtpTransporter.sendMail(mailOptions);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('Email sending error:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * 獲取郵箱文件夾列表
   */
  async getFolders(): Promise<string[]> {
    this.validateConfigForOperation();
    await this.connectImap();

    return new Promise((resolve, reject) => {
      this.imapClient.getBoxes((err, boxes) => {
        if (err) {
          reject(err);
          return;
        }

        const folderNames: string[] = [];
        
        // 遞歸遍歷所有郵件文件夾
        const processBoxes = (boxes: IMAP.MailBoxes, prefix = '') => {
          for (const name in boxes) {
            folderNames.push(prefix + name);
            if (boxes[name].children) {
              processBoxes(boxes[name].children, `${prefix}${name}${boxes[name].delimiter}`);
            }
          }
        };

        processBoxes(boxes);
        resolve(folderNames);
      });
    });
  }

  /**
   * 搜索郵件
   */
  async searchMails(options: MailSearchOptions = {}): Promise<MailItem[]> {
    this.validateConfigForOperation();
    await this.connectImap();

    const folder = options.folder || 'INBOX';
    const limit = options.limit || 20;

    return new Promise((resolve, reject) => {
      this.imapClient.openBox(folder, false, (err, box) => {
        if (err) {
          reject(err);
          return;
        }

        // 構建搜索條件
        const criteria: any[] = [];

        if (options.readStatus === 'read') {
          criteria.push('SEEN');
        } else if (options.readStatus === 'unread') {
          criteria.push('UNSEEN');
        }

        if (options.fromDate) {
          criteria.push(['SINCE', options.fromDate]);
        }

        if (options.toDate) {
          criteria.push(['BEFORE', options.toDate]);
        }

        if (options.from) {
          criteria.push(['FROM', options.from]);
        }

        if (options.to) {
          criteria.push(['TO', options.to]);
        }

        if (options.subject) {
          criteria.push(['SUBJECT', options.subject]);
        }

        if (criteria.length === 0) {
          criteria.push('ALL');
        }

        // 執行搜索
        this.imapClient.search(criteria, (err, uids) => {
          if (err) {
            reject(err);
            return;
          }

          if (uids.length === 0) {
            resolve([]);
            return;
          }

          // 限制結果數量
          const limitedUids = uids.slice(-Math.min(limit, uids.length));

          // 獲取郵件詳情
          const fetch = this.imapClient.fetch(limitedUids, {
            bodies: ['HEADER', 'TEXT'],
            struct: true,
            envelope: true,
            size: true,
            markSeen: false,
          });

          const messages: MailItem[] = [];

          fetch.on('message', (msg, seqno) => {
            const message: Partial<MailItem> = {
              id: '',
              uid: 0,
              folder,
              flags: [],
              subject: '',
              from: [],
              to: [],
              date: new Date(),
              isRead: false,
              hasAttachments: false,
              size: 0,
            };

            msg.on('body', (stream, info) => {
              let buffer = '';
              stream.on('data', (chunk) => {
                buffer += chunk.toString('utf8');
              });

              stream.once('end', () => {
                if (info.which === 'HEADER') {
                  const parsed = IMAP.parseHeader(buffer);
                  
                  message.subject = parsed.subject?.[0] || '';
                  message.from = this.parseAddressList(parsed.from);
                  message.to = this.parseAddressList(parsed.to);
                  message.cc = this.parseAddressList(parsed.cc);
                  
                  if (parsed.date && parsed.date[0]) {
                    message.date = new Date(parsed.date[0]);
                  }
                } else if (info.which === 'TEXT') {
                  const readable = new Readable();
                  readable.push(buffer);
                  readable.push(null);
                  
                  simpleParser(readable).then((parsed) => {
                    message.textBody = parsed.text || undefined;
                    message.htmlBody = parsed.html || undefined;
                    message.attachments = parsed.attachments.map(att => ({
                      filename: att.filename || 'unknown',
                      contentType: att.contentType,
                      size: att.size,
                    }));
                    message.hasAttachments = parsed.attachments.length > 0;
                  }).catch(err => {
                    console.error('Error parsing email content:', err);
                  });
                }
              });
            });

            msg.once('attributes', (attrs) => {
              message.uid = attrs.uid;
              message.id = attrs.uid.toString();
              message.flags = attrs.flags;
              message.isRead = attrs.flags.includes('\\Seen');
              message.size = attrs.size || 0;
              
              // 檢查是否有附件
              if (attrs.struct) {
                message.hasAttachments = this.checkHasAttachments(attrs.struct);
              }
            });

            msg.once('end', () => {
              messages.push(message as MailItem);
            });
          });

          fetch.once('error', (err) => {
            reject(err);
          });

          fetch.once('end', () => {
            resolve(messages);
          });
        });
      });
    });
  }

  /**
   * 獲取郵件詳情
   */
  async getMailDetail(uid: number | string, folder: string = 'INBOX'): Promise<MailItem | null> {
    this.validateConfigForOperation();
    await this.connectImap();

    // 確保 uid 為數字類型
    const numericUid = typeof uid === 'string' ? parseInt(uid, 10) : uid;

    return new Promise((resolve, reject) => {
      this.imapClient.openBox(folder, false, (err) => {
        if (err) {
          reject(err);
          return;
        }

        const fetch = this.imapClient.fetch([numericUid], {
          bodies: '',
          struct: true,
          markSeen: false,
        });

        let mailItem: MailItem | null = null;
        let attributes: any = null;
        let bodyParsed = false;
        let endReceived = false;

        // 檢查是否所有處理都已完成並可以返回結果
        const checkAndResolve = () => {
          if (bodyParsed && endReceived) {
            // 如果有屬性數據但mailItem還沒設置上，則現在設置
            if (attributes && mailItem) {
              mailItem.flags = attributes.flags;
              mailItem.isRead = attributes.flags.includes('\\Seen');
              mailItem.size = attributes.size || 0;
            }
            resolve(mailItem);
          }
        };

        fetch.on('message', (msg) => {
          msg.on('body', (stream) => {
            // 創建一個可讀流緩沖區
            let buffer = '';
            stream.on('data', (chunk) => {
              buffer += chunk.toString('utf8');
            });

            stream.once('end', () => {
              // 使用simpleParser解析郵件內容
              const readable = new Readable();
              readable.push(buffer);
              readable.push(null);

              simpleParser(readable).then((parsed: ParsedMail) => {
                // 處理發件人信息
                const from: EmailAddress[] = [];
                if (parsed.from && 'value' in parsed.from) {
                  from.push(...(parsed.from.value.map(addr => ({
                    name: addr.name || undefined,
                    address: addr.address || '',
                  }))));
                }

                // 處理收件人信息
                const to: EmailAddress[] = [];
                if (parsed.to && 'value' in parsed.to) {
                  to.push(...(parsed.to.value.map(addr => ({
                    name: addr.name || undefined,
                    address: addr.address || '',
                  }))));
                }

                // 處理抄送人信息
                const cc: EmailAddress[] = [];
                if (parsed.cc && 'value' in parsed.cc) {
                  cc.push(...(parsed.cc.value.map(addr => ({
                    name: addr.name || undefined,
                    address: addr.address || '',
                  }))));
                }

                mailItem = {
                  id: numericUid.toString(),
                  uid: numericUid,
                  subject: parsed.subject || '',
                  from,
                  to,
                  cc: cc.length > 0 ? cc : undefined,
                  date: parsed.date || new Date(),
                  isRead: false, // 將通過attributes更新
                  hasAttachments: parsed.attachments.length > 0,
                  attachments: parsed.attachments.map(att => ({
                    filename: att.filename || 'unknown',
                    contentType: att.contentType,
                    size: att.size,
                  })),
                  textBody: parsed.text || undefined,
                  htmlBody: parsed.html || undefined,
                  size: 0, // 將通過attributes更新
                  folder,
                };

                // 如果已經接收到屬性，現在應用它們
                if (attributes) {
                  mailItem.flags = attributes.flags;
                  mailItem.isRead = attributes.flags.includes('\\Seen');
                  mailItem.size = attributes.size || 0;
                }

                bodyParsed = true;
                checkAndResolve();
              }).catch(err => {
                console.error('Error parsing email details:', err);
                reject(err);
              });
            });
          });

          msg.once('attributes', (attrs) => {
            attributes = attrs;
            if (mailItem) {
              mailItem.flags = attrs.flags;
              mailItem.isRead = attrs.flags.includes('\\Seen');
              mailItem.size = attrs.size || 0;
            }
          });
        });

        fetch.once('error', (err) => {
          reject(err);
        });

        fetch.once('end', () => {
          endReceived = true;
          // 如果郵件沒有內容，或者處理過程中出現問題，嘗試確保至少返回空結果
          if (!bodyParsed && !mailItem) {
            console.log(`Email with UID ${numericUid} not found or email content is empty`);
          }
          checkAndResolve();
        });
      });
    });
  }

  /**
   * 將郵件標記為已讀
   */
  async markAsRead(uid: number | string, folder: string = 'INBOX'): Promise<boolean> {
    await this.connectImap();
    
    // 確保 uid 為數字類型
    const numericUid = typeof uid === 'string' ? parseInt(uid, 10) : uid;

    return new Promise((resolve, reject) => {
      this.imapClient.openBox(folder, false, (err) => {
        if (err) {
          reject(err);
          return;
        }

        this.imapClient.addFlags(numericUid, '\\Seen', (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(true);
        });
      });
    });
  }

  /**
   * 將郵件標記為未讀
   */
  async markAsUnread(uid: number | string, folder: string = 'INBOX'): Promise<boolean> {
    await this.connectImap();
    
    // 確保 uid 為數字類型
    const numericUid = typeof uid === 'string' ? parseInt(uid, 10) : uid;

    return new Promise((resolve, reject) => {
      this.imapClient.openBox(folder, false, (err) => {
        if (err) {
          reject(err);
          return;
        }

        this.imapClient.delFlags(numericUid, '\\Seen', (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(true);
        });
      });
    });
  }

  /**
   * 刪除郵件
   */
  async deleteMail(uid: number | string, folder: string = 'INBOX'): Promise<boolean> {
    await this.connectImap();
    
    // 確保 uid 為數字類型
    const numericUid = typeof uid === 'string' ? parseInt(uid, 10) : uid;

    return new Promise((resolve, reject) => {
      this.imapClient.openBox(folder, false, (err) => {
        if (err) {
          reject(err);
          return;
        }

        this.imapClient.addFlags(numericUid, '\\Deleted', (err) => {
          if (err) {
            reject(err);
            return;
          }

          this.imapClient.expunge((err) => {
            if (err) {
              reject(err);
              return;
            }
            resolve(true);
          });
        });
      });
    });
  }

  /**
   * 移動郵件到其他文件夾
   */
  async moveMail(uid: number | string, sourceFolder: string, targetFolder: string): Promise<boolean> {
    await this.connectImap();
    
    // 確保 uid 為數字類型
    const numericUid = typeof uid === 'string' ? parseInt(uid, 10) : uid;

    return new Promise((resolve, reject) => {
      this.imapClient.openBox(sourceFolder, false, (err) => {
        if (err) {
          reject(err);
          return;
        }

        this.imapClient.move(numericUid, targetFolder, (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(true);
        });
      });
    });
  }

  /**
   * 關閉所有連接
   */
  async close(): Promise<void> {
    this.closeImap();
    await promisify(this.smtpTransporter.close.bind(this.smtpTransporter))();
  }

  // 輔助方法：解析地址列表
  private parseAddressList(addresses?: string[]): EmailAddress[] {
    if (!addresses || addresses.length === 0) return [];
    
    return addresses.map(addr => {
      const match = addr.match(/(?:"?([^"]*)"?\s)?(?:<?(.+@[^>]+)>?)/);
      if (match) {
        const [, name, address] = match;
        return { name: name || undefined, address: address || '' };
      }
      return { address: addr };
    });
  }

  // 輔助方法：檢查是否有附件
  private checkHasAttachments(struct: any[]): boolean {
    if (!struct || !Array.isArray(struct)) return false;
    
    if (struct[0] && struct[0].disposition && struct[0].disposition.type.toLowerCase() === 'attachment') {
      return true;
    }
    
    for (const item of struct) {
      if (Array.isArray(item)) {
        if (this.checkHasAttachments(item)) {
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * 高級搜索郵件 - 支持多個文件夾和更覆雜的過濾條件
   */
  async advancedSearchMails(options: {
    folders?: string[];        // 要搜索的文件夾列表，默認為INBOX
    keywords?: string;         // 全文搜索關鍵詞
    startDate?: Date;          // 開始日期
    endDate?: Date;            // 結束日期
    from?: string;             // 發件人
    to?: string;               // 收件人
    subject?: string;          // 主題
    hasAttachment?: boolean;   // 是否有附件
    maxResults?: number;       // 最大結果數
    includeBody?: boolean;     // 是否包含郵件正文
  }): Promise<MailItem[]> {
    const allResults: MailItem[] = [];
    const folders = options.folders || ['INBOX'];
    const maxResults = options.maxResults || 100;
    
    console.log(`Performing advanced search, folders: ${folders.join(', ')}, keywords: ${options.keywords || 'none'}`);
    
    // 對每個文件夾執行搜索
    for (const folder of folders) {
      if (allResults.length >= maxResults) break;
      
      try {
        const folderResults = await this.searchMails({
          folder,
          readStatus: 'all',
          fromDate: options.startDate,
          toDate: options.endDate,
          from: options.from,
          to: options.to,
          subject: options.subject,
          hasAttachments: options.hasAttachment,
          limit: maxResults - allResults.length
        });
        
        // 如果包含關鍵詞，執行全文匹配
        if (options.keywords && options.keywords.trim() !== '') {
          const keywordLower = options.keywords.toLowerCase();
          const filteredResults = folderResults.filter(mail => {
            // 在主題、發件人、收件人中搜索
            const subjectMatch = mail.subject.toLowerCase().includes(keywordLower);
            const fromMatch = mail.from.some(f => 
              (f.name?.toLowerCase() || '').includes(keywordLower) || 
              f.address.toLowerCase().includes(keywordLower)
            );
            const toMatch = mail.to.some(t => 
              (t.name?.toLowerCase() || '').includes(keywordLower) || 
              t.address.toLowerCase().includes(keywordLower)
            );
            
            // 如果需要在正文中搜索，可能需要額外獲取郵件詳情
            let bodyMatch = false;
            if (options.includeBody) {
              bodyMatch = (mail.textBody?.toLowerCase() || '').includes(keywordLower) ||
                         (mail.htmlBody?.toLowerCase() || '').includes(keywordLower);
            }
            
            return subjectMatch || fromMatch || toMatch || bodyMatch;
          });
          
          allResults.push(...filteredResults);
        } else {
          allResults.push(...folderResults);
        }
      } catch (error) {
        console.error(`Error searching folder ${folder}:`, error);
        // 繼續搜索其他文件夾
      }
    }
    
    // 按日期降序排序（最新的郵件優先）
    allResults.sort((a, b) => b.date.getTime() - a.date.getTime());
    
    // 限制結果數量
    return allResults.slice(0, maxResults);
  }
  
  /**
   * 獲取通訊錄 - 基於郵件歷史提取聯系人信息
   */
  async getContacts(options: {
    maxResults?: number;   // 最大結果數
    includeGroups?: boolean; // 是否包含分組
    searchTerm?: string;   // 搜索詞
  } = {}): Promise<{
    contacts: {
      name?: string;
      email: string;
      frequency: number;   // 聯系頻率
      lastContact?: Date;  // 最後聯系時間
    }[];
  }> {
    const maxResults = options.maxResults || 100;
    const searchTerm = options.searchTerm?.toLowerCase() || '';
    
    // 從最近的郵件中提取聯系人
    const contactMap = new Map<string, {
      name?: string;
      email: string;
      frequency: number;
      lastContact?: Date;
    }>();
    
    // 從收件箱和已發送郵件中收集聯系人
    const folders = ['INBOX', 'Sent Messages'];
    
    for (const folder of folders) {
      try {
        const emails = await this.searchMails({
          folder,
          limit: 200, // 搜索足夠多的郵件以收集聯系人
        });
        
        emails.forEach(email => {
          // 處理收件箱中的發件人
          if (folder === 'INBOX') {
            email.from.forEach(sender => {
              if (sender.address === this.config.defaults.fromEmail) return; // 跳過自己
              
              const key = sender.address.toLowerCase();
              if (!contactMap.has(key)) {
                contactMap.set(key, {
                  name: sender.name,
                  email: sender.address,
                  frequency: 1,
                  lastContact: email.date
                });
              } else {
                const contact = contactMap.get(key)!;
                contact.frequency += 1;
                if (!contact.lastContact || email.date > contact.lastContact) {
                  contact.lastContact = email.date;
                }
              }
            });
          }
          
          // 處理已發送郵件中的收件人
          if (folder === 'Sent Messages') {
            email.to.forEach(recipient => {
              if (recipient.address === this.config.defaults.fromEmail) return; // 跳過自己
              
              const key = recipient.address.toLowerCase();
              if (!contactMap.has(key)) {
                contactMap.set(key, {
                  name: recipient.name,
                  email: recipient.address,
                  frequency: 1,
                  lastContact: email.date
                });
              } else {
                const contact = contactMap.get(key)!;
                contact.frequency += 1;
                if (!contact.lastContact || email.date > contact.lastContact) {
                  contact.lastContact = email.date;
                }
              }
            });
            
            // 如果有抄送人，也處理
            if (email.cc) {
              email.cc.forEach(cc => {
                if (cc.address === this.config.defaults.fromEmail) return; // 跳過自己
                
                const key = cc.address.toLowerCase();
                if (!contactMap.has(key)) {
                  contactMap.set(key, {
                    name: cc.name,
                    email: cc.address,
                    frequency: 1,
                    lastContact: email.date
                  });
                } else {
                  const contact = contactMap.get(key)!;
                  contact.frequency += 1;
                  if (!contact.lastContact || email.date > contact.lastContact) {
                    contact.lastContact = email.date;
                  }
                }
              });
            }
          }
        });
      } catch (error) {
        console.error(`Error collecting contacts from folder ${folder}:`, error);
        // 繼續處理其他文件夾
      }
    }
    
    // 轉換為數組並排序（頻率優先）
    let contacts = Array.from(contactMap.values());
    
    // 如果提供了搜索詞，進行過濾
    if (searchTerm) {
      contacts = contacts.filter(contact => 
        (contact.name?.toLowerCase() || '').includes(searchTerm) ||
        contact.email.toLowerCase().includes(searchTerm)
      );
    }
    
    // 按聯系頻率排序
    contacts.sort((a, b) => b.frequency - a.frequency);
    
    // 限制結果數
    contacts = contacts.slice(0, maxResults);
    
    return { contacts };
  }

  /**
   * 獲取郵件附件
   * @param uid 郵件UID
   * @param folder 文件夾名稱
   * @param attachmentIndex 附件索引
   * @returns 附件數據，包括文件名、內容和內容類型
   */
  async getAttachment(uid: number, folder: string = 'INBOX', attachmentIndex: number): Promise<{ filename: string; content: Buffer; contentType: string } | null> {
    await this.connectImap();
    console.log(`Getting attachment ${attachmentIndex} for UID ${uid}...`);

    return new Promise((resolve, reject) => {
      this.imapClient.openBox(folder, true, (err) => {
        if (err) {
          console.error(`Failed to open folder ${folder}:`, err);
          reject(err);
          return;
        }

        const f = this.imapClient.fetch(`${uid}`, { bodies: '', struct: true });
        
        let attachmentInfo: { partID: string; filename: string; contentType: string } | null = null;
        
        f.on('message', (msg, seqno) => {
          msg.on('body', (stream, info) => {
            // 這個事件處理器只是為了確保消息體被處理
            stream.on('data', () => {});
            stream.on('end', () => {});
          });

          msg.once('attributes', (attrs) => {
            try {
              const struct = attrs.struct;
              const attachments = this.findAttachmentParts(struct);
              
              if (attachments.length <= attachmentIndex) {
                console.log(`Attachment index ${attachmentIndex} out of range, total attachments: ${attachments.length}`);
                resolve(null);
                return;
              }
              
              attachmentInfo = attachments[attachmentIndex];
              console.log(`Found attachment info:`, attachmentInfo);
            } catch (error) {
              console.error(`Error parsing attachment structure:`, error);
              reject(error);
            }
          });
          
          msg.once('end', () => {
            if (!attachmentInfo) {
              console.log(`Attachment not found or attachment index invalid`);
              resolve(null);
              return;
            }
            
            // 獲取附件內容
            const attachmentFetch = this.imapClient.fetch(`${uid}`, { 
              bodies: [attachmentInfo.partID],
              struct: true 
            });
            
            let buffer = Buffer.alloc(0);
            
            attachmentFetch.on('message', (msg, seqno) => {
              msg.on('body', (stream, info) => {
                stream.on('data', (chunk) => {
                  buffer = Buffer.concat([buffer, chunk]);
                });
                
                stream.once('end', () => {
                  console.log(`Attachment content download completed, size: ${buffer.length} bytes`);
                });
              });
              
              msg.once('end', () => {
                console.log(`Attachment message processing completed`);
              });
            });
            
            attachmentFetch.once('error', (err) => {
              console.error(`Error getting attachment content:`, err);
              reject(err);
            });
            
            attachmentFetch.once('end', () => {
              console.log(`Attachment retrieval process completed`);
              resolve({
                filename: attachmentInfo!.filename,
                content: buffer,
                contentType: attachmentInfo!.contentType
              });
            });
          });
        });
        
        f.once('error', (err) => {
          console.error(`Error getting email:`, err);
          reject(err);
        });
        
        f.once('end', () => {
          if (!attachmentInfo) {
            console.log(`Attachment not found or no attachments in structure`);
            resolve(null);
          }
        });
      });
    });
  }

  /**
   * 輔助方法：查找郵件結構中的所有附件
   */
  private findAttachmentParts(struct: any[], prefix = ''): { partID: string; filename: string; contentType: string }[] {
    const attachments: { partID: string; filename: string; contentType: string }[] = [];
    
    if (!struct || !Array.isArray(struct)) return attachments;
    
    const processStruct = (s: any, partID = '') => {
      if (Array.isArray(s)) {
        // 多部分結構
        if (s[0] && typeof s[0] === 'object' && s[0].partID) {
          // 這是一個具體的部分
          if (s[0].disposition && 
              (s[0].disposition.type.toLowerCase() === 'attachment' || 
               s[0].disposition.type.toLowerCase() === 'inline')) {
            let filename = '';
            if (s[0].disposition.params && s[0].disposition.params.filename) {
              filename = s[0].disposition.params.filename;
            } else if (s[0].params && s[0].params.name) {
              filename = s[0].params.name;
            }
            
            const contentType = s[0].type + '/' + s[0].subtype;
            
            if (filename) {
              attachments.push({
                partID: s[0].partID,
                filename: filename,
                contentType: contentType
              });
            }
          }
        } else {
          // 遍歷數組中的每個元素
          for (let i = 0; i < s.length; i++) {
            const newPrefix = partID ? `${partID}.${i + 1}` : `${i + 1}`;
            if (Array.isArray(s[i])) {
              processStruct(s[i], newPrefix);
            } else if (typeof s[i] === 'object') {
              // 可能是一個部分定義
              if (s[i].disposition && 
                  (s[i].disposition.type.toLowerCase() === 'attachment' || 
                   s[i].disposition.type.toLowerCase() === 'inline')) {
                let filename = '';
                if (s[i].disposition.params && s[i].disposition.params.filename) {
                  filename = s[i].disposition.params.filename;
                } else if (s[i].params && s[i].params.name) {
                  filename = s[i].params.name;
                }
                
                const contentType = s[i].type + '/' + s[i].subtype;
                
                if (filename) {
                  attachments.push({
                    partID: newPrefix,
                    filename: filename,
                    contentType: contentType
                  });
                }
              }
            }
          }
        }
      }
    };
    
    processStruct(struct, prefix);
    return attachments;
  }

  /**
   * 批量將郵件標記為已讀
   */
  async markMultipleAsRead(uids: (number | string)[], folder: string = 'INBOX'): Promise<boolean> {
    await this.connectImap();
    
    // 確保所有 uid 都是數字類型
    const numericUids = uids.map(uid => typeof uid === 'string' ? parseInt(uid, 10) : uid);

    return new Promise((resolve, reject) => {
      this.imapClient.openBox(folder, false, (err) => {
        if (err) {
          reject(err);
          return;
        }
        
        this.imapClient.addFlags(numericUids, '\\Seen', (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(true);
        });
      });
    });
  }

  /**
   * 批量將郵件標記為未讀
   */
  async markMultipleAsUnread(uids: (number | string)[], folder: string = 'INBOX'): Promise<boolean> {
    await this.connectImap();
    
    // 確保所有 uid 都是數字類型
    const numericUids = uids.map(uid => typeof uid === 'string' ? parseInt(uid, 10) : uid);

    return new Promise((resolve, reject) => {
      this.imapClient.openBox(folder, false, (err) => {
        if (err) {
          reject(err);
          return;
        }
        
        this.imapClient.delFlags(numericUids, '\\Seen', (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(true);
        });
      });
    });
  }

  /**
   * 等待新郵件回覆
   * 此方法使用輪詢方式檢測新郵件的到達。主要用於需要等待用戶郵件回覆的場景。
   * 
   * 工作原理：
   * 1. 首先檢查是否有5分鐘內的未讀郵件，如果有，返回特殊狀態提示需要先處理這些郵件
   * 2. 如果沒有最近的未讀郵件，則：
   *    - 連接到IMAP服務器並獲取當前郵件數量
   *    - 每5秒檢查一次郵件數量
   *    - 如果發現新郵件，獲取最新的郵件內容
   *    - 如果超過指定時間仍未收到新郵件，則返回null
   * 
   * @param folder 要監聽的文件夾，默認為'INBOX'（收件箱）
   * @param timeout 超時時間（毫秒），默認為3小時。超時後返回null
   * @returns 如果在超時前收到新郵件，返回郵件詳情；如果超時，返回null；如果有最近未讀郵件，返回帶有特殊標記的郵件列表
   */
  async waitForNewReply(folder: string = 'INBOX', timeout: number = 3 * 60 * 60 * 1000): Promise<MailItem | null | { type: 'unread_warning'; mails: MailItem[] }> {
    await this.connectImap();

    // 檢查5分鐘內的未讀郵件
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const existingMails = await this.searchMails({
      folder,
      limit: 5,
      readStatus: 'unread',
      fromDate: fiveMinutesAgo
    });

    // 如果有5分鐘內的未讀郵件，返回特殊狀態
    if (existingMails.length > 0) {
      console.log(`[waitForNewReply] Found ${existingMails.length} unread emails in the last 5 minutes, need to process first`);
      return {
        type: 'unread_warning',
        mails: existingMails
      };
    }

    return new Promise((resolve, reject) => {
      let timeoutId: NodeJS.Timeout;
      let isResolved = false;
      let initialCount = 0;
      let checkInterval: NodeJS.Timeout;

      // 清理函數
      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        if (checkInterval) {
          clearInterval(checkInterval);
        }
      };

      // 設置超時
      timeoutId = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          cleanup();
          resolve(null);
        }
      }, timeout);

      // 獲取初始郵件數量並開始輪詢
      this.imapClient.openBox(folder, false, (err, mailbox) => {
        if (err) {
          cleanup();
          reject(err);
          return;
        }

        // 記錄初始郵件數量
        initialCount = mailbox.messages.total;
        console.log(`[waitForNewReply] Initial email count: ${initialCount}, starting to wait for new email replies...`);

        // 每5秒檢查一次新郵件
        checkInterval = setInterval(async () => {
          if (isResolved) return;

          try {
            // 重新打開郵箱以獲取最新狀態
            this.imapClient.openBox(folder, false, async (err, mailbox) => {
              if (err || isResolved) return;

              const currentCount = mailbox.messages.total;
              console.log(`[waitForNewReply] Current email count: ${currentCount}, initial count: ${initialCount}`);

              if (currentCount > initialCount) {
                // 有新郵件，獲取最新的郵件
                try {
                  const messages = await this.searchMails({
                    folder,
                    limit: 1
                  });

                  if (messages.length > 0 && !isResolved) {
                    // 獲取完整的郵件內容
                    const fullMail = await this.getMailDetail(messages[0].uid, folder);
                    if (fullMail) {
                      console.log(`[waitForNewReply] Received new email reply, subject: "${fullMail.subject}"`);
                      isResolved = true;
                      cleanup();
                      resolve(fullMail);
                    }
                  }
                } catch (error) {
                  console.error('[waitForNewReply] Failed to get new email:', error);
                }
              }
            });
          } catch (error) {
            console.error('[waitForNewReply] Error checking for new emails:', error);
          }
        }, 5000);
      });
    });
  }

  /**
   * 測試SMTP連接
   */
  async testSmtpConnection(): Promise<{ success: boolean; error?: string; config?: any }> {
    this.validateConfigForOperation();
    try {
      console.log('Testing SMTP connection...');
      
      // 驗證配置
      const config = {
        host: this.config.smtp.host,
        port: this.config.smtp.port,
        secure: this.config.smtp.port === 25 ? false : this.config.smtp.secure,
        auth: {
          user: this.config.smtp.auth.user,
          pass: this.config.smtp.auth.pass,
        }
      };

      if (this.config.smtp.port === 25) {
        config.secure = false;
        console.log('Port 25 detected, using non-TLS mode');
      }

      logConfigSafely({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: config.auth
      }, 'SMTP Configuration');

      // 測試連接
      await this.smtpTransporter.verify();
      
      console.log('SMTP connection test successful!');
      return { 
        success: true, 
        config: {
          host: config.host,
          port: config.port,
          secure: config.secure
        }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('SMTP connection test failed:', errorMessage);
      return { 
        success: false, 
        error: errorMessage,
        config: {
          host: this.config.smtp.host,
          port: this.config.smtp.port,
          secure: this.config.smtp.port === 25 ? false : this.config.smtp.secure
        }
      };
    }
  }
} 