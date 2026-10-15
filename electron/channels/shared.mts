// 渠道公共纯函数与常量：chunkText / sniffImageExtension / MAX_MEDIA_BYTES。
// 原本 chunkText 定义在 qq-bot.mjs、sniffImageExtension 定义在 wechat.mjs，
// 两个适配器互相 import 对方形成循环依赖（ESM 下能跑但脆弱）。
// 统一放到这里后，qq-bot / wechat / manager / media-tools 都只依赖本文件，
// 不再相互引用；原模块保留 re-export，对外 API 不变。
// 本文件不依赖 electron 与任何渠道模块，方便用 node --test 直接测试。

// IM 长文本切片上限（QQ 官方单条消息 1500 字左右）
const QQ_TEXT_CHUNK = 1500;

// 长文本按 IM 限制切片;优先在换行/句号处断开
export function chunkText(text, limit = QQ_TEXT_CHUNK) {
  const source = String(text || "");
  if (source.length <= limit) return source ? [source] : [];
  const chunks = [];
  let rest = source;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf("。", limit);
    if (cut < limit * 0.5) cut = limit;
    else cut += 1;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) chunks.push(rest);
  return chunks;
}

// 原因与影响先展示；完整操作通过渠道已有的长消息分片发送，不再静默截去命令尾部。
export function formatChannelApproval(action: any) {
  const details = String(action.details || "");
  // 原因由审批器单独提供，不能从待执行命令里的文字识别并重排，以免改变命令原文。
  const reason = String(action.approvalReason || "");
  const suffix = reason ? `\n\n${reason}` : "";
  const operation = suffix && details.endsWith(suffix) ? details.slice(0, -suffix.length) : details;
  return ["⚠️ 需要审批", String(action.title || action.kind || "待确认操作"),
    reason, action.impact ? `操作影响：\n${action.impact}` : "",
    "回复 1 允许本次操作 / 0 拒绝 / 2 停止整个任务。10 分钟未回复将自动取消。",
    operation ? `完整操作内容（较长时分条发送）：\n${operation}` : ""].filter(Boolean).join("\n\n");
}

// 按文件头魔数识别图片扩展名（纯函数，供渠道适配器与测试复用）：
// FFD8→jpg、8950→png、4749→gif、RIFF→webp；识别不出返回 null
export function sniffImageExtension(buffer) {
  if (!buffer || buffer.length < 4) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return ".jpg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return ".png";
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return ".gif";
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) return ".webp";
  return null;
}

// 渠道媒体大小上限（入站下载与出站发送共用，见设计文档第 2/4/9 节）
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
