# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an MCP (Model Context Protocol) mail tool that enables AI models to access email services through a standardized interface. The project is built entirely with **Node.js** and provides comprehensive email functionality through MCP tools.

## Key Commands

### Build and Development
```bash
# Install dependencies
npm install

# Build the project (compiles TypeScript to JavaScript)
npm run build

# Start the MCP server (after building)
npm start

# Start development mode with auto-restart
npm run dev

# Run tests
npm test
```

### Project Structure Commands
```bash
# The main entry point (after building)
node dist/index.js
```

### MCP Server Configuration
The server is started directly with Node.js:
```json
{
  "mcpServers": {
    "mail-mcp": {
      "command": "node",
      "args": ["path/to/dist/index.js"],
      "env": {
        "SMTP_HOST": "smtp.server.com",
        "SMTP_PORT": "587",
        "SMTP_SECURE": "true",
        "SMTP_USER": "user@domain.com",
        "SMTP_PASS": "password",
        "SMTP_ALLOW_UNAUTHORIZED_CERT": "false",
        "IMAP_HOST": "imap.server.com",
        "IMAP_PORT": "993",
        "IMAP_SECURE": "true",
        "IMAP_USER": "user@domain.com",
        "IMAP_PASS": "password"
      }
    }
  }
}
```

## Architecture Overview

### Pure Node.js Architecture
The project uses a clean **Node.js-only architecture** with no external dependencies or bridging layers:

**Node.js Core Layer** (`src/`)
- Contains the complete MCP server implementation using `@modelcontextprotocol/sdk`
- Handles all email operations via `nodemailer` (SMTP) and `imap` (IMAP)
- Implements 20+ MCP tools for comprehensive email management
- Direct process management and lifecycle control

### Core Components

**Main Application Flow:**
- `src/index.ts` - Entry point, initializes MCP server and process management
- `src/tools/mail.ts` - MCP server implementation with all email tools (1251 lines)
- `src/tools/mail-service.ts` - Core email service abstraction (1362 lines)
- `src/tools/process-manager.ts` - Process mutex and lifecycle management

**Key Service Architecture:**
- **MailMCP Class**: Orchestrates the MCP server and registers all tools
- **MailService Class**: Abstracts SMTP/IMAP operations with connection pooling
- **ProcessManager Class**: Prevents multiple instances via file-based locking

### MCP Tools Structure
The application provides 20+ email-related tools organized into categories:

**Sending Tools:**
- `sendMail`, `sendBulkMail`, `sendSimpleMail`, `sendHtmlMail`

**Receiving Tools:**
- `listEmails`, `searchEmails`, `getEmailDetail`, `waitForReply`, `getContacts`

**Management Tools:**
- `markAsRead`, `markMultipleAsRead`, `deleteEmail`, `moveEmail`, `getAttachment`

**Administrative Tools:**
- `listFolders`, `testSmtpConnection`

### Configuration and Environment

**Environment Variable Validation:**
The application validates required environment variables on startup:
- SMTP configuration: `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`
- IMAP configuration: `IMAP_HOST`, `IMAP_USER`, `IMAP_PASS`
- Optional SSL certificate handling via `SMTP_ALLOW_UNAUTHORIZED_CERT`

**Special Port Handling:**
- Port 25: Automatically configures non-TLS mode
- Port 465: SSL/TLS with `SMTP_SECURE: true`
- Port 587: STARTTLS with `SMTP_SECURE: false`

### Process Management Strategy

**Mutex Implementation:**
- Uses file-based locking (`.mcp-mail.lock`) to prevent multiple instances
- Handles process cleanup on SIGINT/SIGTERM signals
- Supports graceful shutdown of existing instances when starting new ones

**Cross-Platform Considerations:**
- Node.js handles cross-platform compatibility automatically
- Proper signal handling for graceful shutdown
- File-based process locking works on all platforms

### Error Handling Patterns

**Connection Resilience:**
- IMAP connection pooling with automatic reconnection
- SMTP connection testing tool for configuration validation
- Graceful degradation for partially accessible email features

**User-Friendly Error Messages:**
- Environment validation provides detailed setup instructions
- Connection failures include specific troubleshooting guidance
- Email parsing errors fall back to basic content extraction

## Important Development Notes

### TypeScript Configuration
- Uses ES2022 target with NodeNext module resolution
- Outputs to `dist/` directory with source maps and declarations
- Strict mode enabled for type safety

### Testing Email Connections
Use the built-in connection testing tool to verify SMTP configuration:
- The `testSmtpConnection` MCP tool validates server connectivity
- Provides detailed configuration feedback for troubleshooting

### Special Email Server Compatibility
- QQ Mail: Requires app-specific passwords, not regular passwords
- Corporate servers: May need `SMTP_ALLOW_UNAUTHORIZED_CERT=true` for self-signed certificates
- Port 25 servers: Automatically switches to non-encrypted mode