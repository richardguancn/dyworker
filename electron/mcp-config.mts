import os from 'node:os';
import path from 'node:path';
export function normalizeMcpServers(servers) {
  return (Array.isArray(servers) ? servers : []).filter(server => server && String(server.transport === 'http' ? server.url : server.command || '').trim()).map(server => ({
    id: String(server.id || crypto.randomUUID()), name: String(server.name || server.url || server.command).trim(),
    transport: server.transport === 'http' ? 'http' : 'stdio', command: String(server.command || '').trim(),
    args: Array.isArray(server.args) ? server.args.map(String) : String(server.args || '').split(' ').filter(Boolean), enabled: server.enabled !== false,
    url: String(server.url || '').trim(), bearerTokenEnvVar: String(server.bearerTokenEnvVar || '').trim(),
    env: stringRecord(server.env), headers: stringRecord(server.headers), envHeaders: stringRecord(server.envHeaders),
    envPassthrough: Array.isArray(server.envPassthrough) ? server.envPassthrough.map(String).filter(Boolean) : [], cwd: String(server.cwd || '').trim(),
    ...(server.bundle ? {bundle: server.bundle} : {}),
  }));
}
function stringRecord(value) { return Object.fromEntries(Object.entries(value && typeof value === 'object' && !Array.isArray(value) ? value : {}).map(([key, val]) => [key, String(val)])); }
export function resolveMcpServer(server, hostEnv = process.env) {
  if (server.configUnavailable) throw new Error("暂时无法读取已保存的 MCP 连接设置");
  const expandHome = value => String(value || '').replace(/^~(?=\/|\\|$)/, os.homedir());
  let config = {...server};
  if (server.bundle) {
    const {manifest, directory, userConfig} = server.bundle;
    const original = manifest.server.mcp_config || {};
    const merged = {...original, ...original.platform_overrides?.[process.platform], env: {...original.env, ...original.platform_overrides?.[process.platform]?.env}};
    const replace = value => {
      const substitute = (input, depth = 0) => { if (depth > 8) throw new Error('MCP 文件包含循环变量'); return String(input).replace(/\$\{([^}]+)\}/g, (_, key) => {
        if (key === '__dirname') return directory;
        if (key === 'HOME') return os.homedir();
        if (['DESKTOP', 'DOCUMENTS', 'DOWNLOADS'].includes(key)) return path.join(os.homedir(), {DESKTOP: 'Desktop', DOCUMENTS: 'Documents', DOWNLOADS: 'Downloads'}[key]);
        if (key === 'pathSeparator' || key === '/') return path.sep;
        if (key.startsWith('user_config.')) {
          const name = key.slice(12); const field = manifest.user_config?.[name]; const val = userConfig?.[name] ?? field?.default;
          if ((val == null || val === '' || (Array.isArray(val) && !val.length)) && field?.required) throw new Error(`请填写${field.title || name}`);
          if (Array.isArray(val)) return val.map(value => substitute(value, depth + 1)).join(path.delimiter);
          return val == null ? '' : substitute(val, depth + 1);
        }
        throw new Error(`MCP 文件包含不支持的变量：${key}`);
      }); };
      return substitute(value);
    };
    // User edits to the imported launch fields are respected; templates stay unresolved until use.
    config = {...config, command: replace(server.command || merged.command), args: (server.args || merged.args || []).flatMap(arg => { const match = /^\$\{user_config\.([^}]+)\}$/.exec(arg); const val = match && (userConfig?.[match[1]] ?? manifest.user_config?.[match[1]]?.default); return Array.isArray(val) ? val.map(replace) : [replace(arg)]; }), env: Object.fromEntries(Object.entries(server.env || merged.env || {}).map(([key, val]) => [key, replace(val)])), cwd: expandHome(server.cwd || directory)};
    if (manifest.server.type === 'binary' && !path.isAbsolute(config.command)) config.command = path.resolve(directory, config.command);
  }
  const env = {...hostEnv};
  for (const name of config.envPassthrough || []) { if (hostEnv[name] == null) throw new Error(`本机未设置环境变量：${name}`); env[name] = hostEnv[name]; }
  Object.assign(env, config.env || {});
  if (server.bundle?.manifest.server.type === 'node' && config.command === 'node' && process.versions.electron) { config.command = process.execPath; env.ELECTRON_RUN_AS_NODE = '1'; }
  const headers = {...config.headers};
  for (const [key, name] of Object.entries(config.envHeaders || {})) {
    if (!hostEnv[String(name)]) throw new Error(`本机未设置环境变量：${name}`);
    headers[key] = hostEnv[String(name)];
  }
  if (config.bearerTokenEnvVar) {
    if (!hostEnv[config.bearerTokenEnvVar]) throw new Error(`本机未设置环境变量：${config.bearerTokenEnvVar}`);
    headers.Authorization = `Bearer ${hostEnv[config.bearerTokenEnvVar]}`;
  }
  return {...config, command: expandHome(config.command), cwd: expandHome(config.cwd) || undefined, env, headers};
}
