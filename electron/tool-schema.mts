import { detectProvider } from './providers.mts';

// Moonshot supports anyOf/enum, but not oneOf/const. A $ref pointing through
// oneOf is reported as infinite recursion. Project only the model-facing copy;
// the original MCP/DSH schemas still validate tool execution.
const moonshotKeywords = new Set([
  'type', 'properties', 'required', 'additionalProperties', 'items', '$ref', '$defs',
  'anyOf', 'enum', 'description', 'title', 'default', 'pattern',
  'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems',
]);

export function moonshotToolSchema(schema: any): any {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const result: any = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!moonshotKeywords.has(key)) continue;
    if (['properties', '$defs'].includes(key) && value && typeof value === 'object') {
      result[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, moonshotToolSchema(child)]));
    } else if (['items', 'additionalProperties'].includes(key)) {
      result[key] = moonshotToolSchema(value);
    } else if (key === 'anyOf' && Array.isArray(value)) {
      result[key] = value.map(moonshotToolSchema);
    } else {
      // default/enum contain data, not schemas: preserve their literal keys.
      result[key] = value;
    }
  }
  if (Object.hasOwn(schema, 'const')) result.enum = [schema.const];
  if (Array.isArray(schema.oneOf)) result.anyOf = schema.oneOf.map(moonshotToolSchema);
  // Integer exclusive bounds can be represented exactly as inclusive bounds.
  // Unsupported constraints remain enforced by the original tool schema.
  if (schema.type === 'integer') {
    if (typeof schema.exclusiveMinimum === 'number') {
      result.minimum = Math.max(result.minimum ?? -Infinity, Math.floor(schema.exclusiveMinimum) + 1);
    }
    if (typeof schema.exclusiveMaximum === 'number') {
      result.maximum = Math.min(result.maximum ?? Infinity, Math.ceil(schema.exclusiveMaximum) - 1);
    }
  }
  return result;
}

export function adaptToolsForModel(tools: any[], settings: any): any[] {
  const provider = detectProvider(settings?.endpoint);
  // Include Kimi models served through a user-configured gateway.
  if (provider !== 'kimi' && provider !== 'kimi-open'
    && !/^(?:kimi[-_])?k3(?:$|[-_\[])/i.test(String(settings?.model || ''))
    && !/^kimi[-_]/i.test(String(settings?.model || ''))) return tools;
  return tools.map(tool => tool?.type === 'function' && tool.function?.parameters
    ? { ...tool, function: { ...tool.function, parameters: moonshotToolSchema(tool.function.parameters) } }
    : tool);
}
