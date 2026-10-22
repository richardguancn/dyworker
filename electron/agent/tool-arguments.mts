// 工具参数解析与校验。


export function parseArguments(toolCall) {
  const raw = toolCall?.function?.arguments;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// 工具参数校验（对齐 Pi validateToolArguments）：按工具声明的 JSON Schema 做轻量校验，
// 在审批与执行之前拦截类型错误/缺参，给模型稳定的错误文案。
// 只校验顶层字段；无 schema 的工具（未知/MCP 工具缺声明时）跳过校验。
export function validateToolArguments(schema, args) {
  if (!schema || typeof schema !== "object") return [];
  const problems = [];
  const properties = schema.properties || {};
  for (const key of Array.isArray(schema.required) ? schema.required : []) {
    if (args[key] === undefined || args[key] === null) problems.push(`缺少必填参数 ${key}`);
  }
  const typeCheckers = {
    string: (v) => typeof v === "string",
    integer: (v) => Number.isInteger(v),
    number: (v) => typeof v === "number" && Number.isFinite(v),
    boolean: (v) => typeof v === "boolean",
    array: (v) => Array.isArray(v),
    object: (v) => v !== null && typeof v === "object" && !Array.isArray(v),
  };
  for (const [key, value] of Object.entries(args)) {
    const spec = properties[key];
    if (!spec || value === undefined || value === null) continue;
    const typeOk = typeCheckers[spec.type];
    if (typeOk && !typeOk(value)) {
      problems.push(`参数 ${key} 应为 ${spec.type}，实际收到 ${Array.isArray(value) ? "array" : typeof value}`);
      continue;
    }
    if (Array.isArray(spec.enum) && !spec.enum.includes(value)) {
      problems.push(`参数 ${key} 只能是 ${spec.enum.join(" / ")}`);
    }
    if (typeof value === "number") {
      if (spec.minimum !== undefined && value < spec.minimum) problems.push(`参数 ${key} 不能小于 ${spec.minimum}`);
      if (spec.maximum !== undefined && value > spec.maximum) problems.push(`参数 ${key} 不能大于 ${spec.maximum}`);
    }
  }
  return problems;
}
