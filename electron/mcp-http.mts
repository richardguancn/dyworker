import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpClient } from './mcp.mts';
export class HttpMcpClient extends McpClient {
  client; transport; connected = false; config; activeRequests = 0;
  constructor(config) { super(config); this.config = config; }
  async connect() {
    const url = new URL(this.config.url);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('MCP URL 需要以 http:// 或 https:// 开头');
    this.client = new Client({name: 'dyworker', version: '0.2.2'}, {capabilities: {}});
    this.transport = new StreamableHTTPClientTransport(url, {requestInit: {headers: this.config.headers || {}}, reconnectionOptions: {maxRetries: 0, maxReconnectionDelay: 1000, initialReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1}});
    try {
      await this.client.connect(this.transport, {timeout: this.requestTimeoutMs});
      this.serverInfo = this.client.getServerVersion(); this.tools = [];
      let cursor; const seen = new Set();
      do { const result = await this.client.listTools(cursor ? {cursor} : {}, {timeout: this.requestTimeoutMs}); this.tools.push(...result.tools); cursor = result.nextCursor; if (cursor && seen.has(cursor)) throw new Error('MCP 工具列表重复分页'); if (cursor) seen.add(cursor); } while (cursor);
      this.connected = true;
    } catch (error) { await this.close(); throw error; }
  }
  async request(method, params, requestTimeoutMs = this.requestTimeoutMs, signal = null) {
    if (method !== 'tools/call') throw new Error(`不支持的 MCP 请求：${method}`);
    this.activeRequests++;
    try { return await this.client.callTool(params, undefined, {timeout: requestTimeoutMs || this.requestTimeoutMs, signal: signal || undefined}); } finally { this.activeRequests--; }
  }
  async close() { this.connected = false; await this.client?.close(); }
}
