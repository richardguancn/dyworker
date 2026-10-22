// 从桌面入口拆出的工具服务器连接与调用。
import { COMPUTER_USE_INSTALL_TIMEOUT_MS,COMPUTER_USE_SERVER_ID,discoverComputerUseServer } from "../computer-use.mts";
import { resolveMcpServer } from "../mcp-config.mts";
import { HttpMcpClient } from "../mcp-http.mts";
import { McpClient } from "../mcp.mts";

export function createMcpRuntime(deps: {
  mcpShuttingDown: boolean;
}) {


// ---- MCP 工具服务器（stdio） ----

const mcpClients = new Map();
const mcpClientConnections = new Map();
const builtInComputerUseServer = discoverComputerUseServer();

function mcpServersOf(settings) {
  const list = Array.isArray(settings?.mcpServers) ? settings.mcpServers : [];
  const configured = list.filter((server) =>
    server
    && server.enabled !== false
    && String(server.transport === "http" ? server.url : server.command || "").trim()
    && String(server.id || "") !== COMPUTER_USE_SERVER_ID);
  return builtInComputerUseServer ? [builtInComputerUseServer, ...configured] : configured;
}

function mcpServerArgs(server) {
  if (Array.isArray(server.args)) return server.args.map(String);
  return String(server.args || "").split(" ").filter(Boolean);
}

async function getMcpClient(server) {
  if (deps.mcpShuttingDown) throw new Error("应用正在退出，已停止新建本机操作连接");
  const key = JSON.stringify(server);
  const existing = mcpClients.get(key);
  if (existing?.process || existing?.connected) return existing;
  const pendingConnection = mcpClientConnections.get(key);
  if (pendingConnection) return pendingConnection;
  const connection = Promise.resolve().then(async () => {
    // Register the pending connection before awaiting cleanup, so simultaneous tasks share it.
    for (const [oldKey, client] of mcpClients) {
      const old = JSON.parse(oldKey);
      if (oldKey !== key && old.id === server.id && !client.pending?.size && !client.activeRequests) {
        mcpClients.delete(oldKey);
        await client.close();
      }
    }
    const resolved = resolveMcpServer({...server, args: mcpServerArgs(server)});
    const client = server.transport === "http" ? new HttpMcpClient(resolved) : new McpClient(resolved);
    try {
      await client.connect();
      if (deps.mcpShuttingDown) {
        await client.close();
        throw new Error("应用正在退出，已停止新建本机操作连接");
      }
      mcpClients.set(key, client);
      return client;
    } catch (error: any) {
      await client.close();
      throw error;
    }
  });
  mcpClientConnections.set(key, connection);
  try {
    return await connection;
  } finally {
    if (mcpClientConnections.get(key) === connection) mcpClientConnections.delete(key);
  }
}

// MCP 的 inputSchema 是通用 JSON Schema，可能带 $schema 声明或空的 required 数组，
// 严格校验的 OpenAI 兼容服务（vLLM/LM Studio 等）会拒绝，这里统一清洗成标准工具参数格式
function sanitizeMcpInputSchema(schema) {
  if (!schema || typeof schema !== "object") return { type: "object", properties: {} };
  const { $schema, ...rest } = schema;
  const cleaned = { ...rest };
  if (cleaned.type !== "object") cleaned.type = "object";
  if (!cleaned.properties || typeof cleaned.properties !== "object") cleaned.properties = {};
  if (Array.isArray(cleaned.required) && !cleaned.required.length) delete cleaned.required;
  return cleaned;
}

async function mcpExtraTools(settings) {
  const extra = [];
  for (const server of mcpServersOf(settings)) {
    try {
      const client = await getMcpClient(server);
      for (const tool of client.tools) {
        extra.push({
          type: "function",
          function: {
            name: `mcp__${server.id || server.name}__${tool.name}`,
            description: server.id === COMPUTER_USE_SERVER_ID
              ? `【本机应用操作】${tool.description || tool.name}`
              : `【MCP:${server.name}】${tool.description || tool.name}`,
            parameters: sanitizeMcpInputSchema(tool.inputSchema),
          },
        });
      }
    } catch (error: any) {
      // 单个服务器连不上不影响其他工具；但必须留日志，否则用户配了 MCP 后
      // 界面上毫无反馈（工具列表里既没有它、也没有任何报错），只能靠猜。
      console.warn(
        `[mcp] 服务器「${server.name || server.command}」连接失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return extra;
}

async function callMcpTool(settings, fullName, args, { signal } = {} as any) {
  const rest = fullName.slice(5);
  for (const server of mcpServersOf(settings)) {
    const prefix = `${server.id || server.name}__`;
    if (!rest.startsWith(prefix)) continue;
    const client = await getMcpClient(server);
    try {
      const toolName = rest.slice(prefix.length);
      const result = await client.callTool(toolName, args, {
        requestTimeoutMs: server.id === COMPUTER_USE_SERVER_ID && toolName === "install_dependencies"
          ? COMPUTER_USE_INSTALL_TIMEOUT_MS
          : undefined,
        signal,
      });
      return { ok: !result.isError, result: result.text, images: result.images };
    } catch (error: any) {
      if (!client.process && !client.connected) mcpClients.delete(JSON.stringify(server));
      if (signal?.aborted) return { ok: false, result: "任务已停止" };
      if (server.id === COMPUTER_USE_SERVER_ID) {
        const guidance = process.platform === "linux"
          ? "请确认当前使用 X11 桌面会话，并已安装 xdotool、wmctrl、python3-pyatspi 和 ImageMagick。"
          : "请确认 DYWorker 已在 系统设置 → 隐私与安全性 → 辅助功能 和 屏幕录制 中启用；可先让助手调用 check_permissions 查看权限状态。";
        return {
          ok: false,
          result: `本机应用操作没有获得系统响应。${guidance}然后重试。原始原因：${error instanceof Error ? error.message : String(error)}`,
        };
      }
      throw error;
    }
  }
  return { ok: false, result: `没有找到 MCP 工具：${fullName}` };
}

async function closeAllMcpClients() {
  const clients = [...mcpClients.values()];
  mcpClients.clear();
  await Promise.allSettled(clients.map((client) => client.close()));
}
  return { mcpExtraTools, callMcpTool, closeAllMcpClients };
}
