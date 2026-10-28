// 只限制单个尚未结束的事件，不限制整段回复或任务长度。
// 8 Mi 个 UTF-16 单元可容纳较大的最终快照，同时阻止异常正文无限积存。
export const MAX_MODEL_STREAM_EVENT_CHARS = 8 * 1024 * 1024;

// 仅从已收到且完整的错误 JSON 中提取固定类型与字段名；绝不输出错误正文或请求数据。
function validationHint(text: string) {
  if (text.length > 64 * 1024) return '';
  try {
    const data = JSON.parse(text);
    const entries = Array.isArray(data?.detail) ? data.detail : Array.isArray(data?.error?.details) ? data.error.details : [];
    const allowedFields = new Set(['body', 'input', 'messages', 'content', 'role', 'type', 'image_url', 'tool_calls', 'tool_call_id', 'call_id', 'arguments', 'name', 'output']);
    const allowedTypes = new Set(['missing', 'string_type', 'list_type', 'dict_type', 'literal_error', 'extra_forbidden', 'value_error', 'union_tag_invalid']);
    const entry = entries.find((item: any) => allowedTypes.has(item?.type) && Array.isArray(item?.loc)
      && item.loc.length <= 8 && item.loc.every((part: unknown) => typeof part === 'number' && Number.isSafeInteger(part) && part >= 0 && part < 100000 || typeof part === 'string' && allowedFields.has(part)));
    return entry ? `（校验位置：${entry.loc.join(' → ')}；类型：${entry.type}）` : '';
  } catch { return ''; }
}

export function createModelStreamParser(onBlock: (block: string) => void,
  maxEventChars = MAX_MODEL_STREAM_EVENT_CHARS) {
  let parts: string[] = [];
  let group: string[] = [];
  let groupLength = 0;
  let size = 0;
  let tail = '';
  let checkedPrefix = false;

  function checkPrefix(text: string) {
    if (checkedPrefix) return;
    const first = /\S/.exec(text)?.[0];
    if (!first) return;
    checkedPrefix = true;
    // 某些网关用成功的流式响应头返回 JSON 错误或 HTML 错误页。
    // 不回显正文，避免将请求内容、图片编码或凭据写进错误记录。
    if ('{[<'.includes(first)) {
      throw Object.assign(new Error(`模型服务返回了异常格式的回复，已停止接收。请检查模型服务或更换模型后重试。${first === '{' ? validationHint(text.trim()) : ''}`),
        { code: 'MODEL_STREAM_INVALID_FORMAT' });
    }
  }

  function checkSize(length: number) {
    if (length > maxEventChars) {
      throw Object.assign(new Error('模型服务单条回复数据过大，已停止接收。请缩短单次输出或检查模型服务。'),
        { code: 'MODEL_STREAM_EVENT_TOO_LARGE' });
    }
  }

  function append(text: string) {
    checkPrefix(text);
    checkSize(size + text.length);
    if (!text) return;
    size += text.length;
    group.push(text);
    groupLength += text.length;
    // 细碎网络块也不能生成无限多的小字符串引用。
    if (groupLength >= 16 * 1024 || group.length >= 128) {
      parts.push(group.join(''));
      group = [];
      groupLength = 0;
    }
  }

  function emit() {
    const block = parts.join('') + group.join('');
    parts = [];
    group = [];
    groupLength = 0;
    size = 0;
    checkedPrefix = false;
    onBlock(block);
  }

  function feed(chunk: string) {
    // 最长分隔符是 CRLF CRLF；只重查上个块末尾三个字符，其他内容不重复扫描。
    const text = tail + chunk;
    tail = '';
    checkPrefix(text);
    const separator = /\r?\n\r?\n/g;
    let start = 0;
    let match: RegExpExecArray | null;
    while ((match = separator.exec(text))) {
      append(text.slice(start, match.index));
      emit();
      start = match.index + match[0].length;
    }
    const keepFrom = Math.max(start, text.length - 3);
    append(text.slice(start, keepFrom));
    tail = text.slice(keepFrom);
    checkPrefix(tail);
    // 暂留的 CR/LF 可能属于尚未收齐的分隔符，不能误计入事件上限。
    checkSize(size + tail.replace(/[\r\n]+$/, '').length);
  }

  return {
    feed,
    finish(chunk = '') {
      feed(chunk);
      append(tail);
      tail = '';
      if (size) emit();
    },
  };
}
