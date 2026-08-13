# 渠道多媒体（图片 / 文件 / 语音）实施路径

> 目标：微信、QQ 两个渠道支持收发图片、文件、语音。
> 本文是给实施模型（deepseek-v4-flash）的完整施工说明，按文件、函数给出具体改法、验收命令和完成标准。所有行号均为当前工作区的近似位置，动手前先按函数名重新定位。

## 0. 范围与纪律

范围：`electron/channels/`（微信、QQ、渠道管理）、`electron/main.mjs`（渠道任务装配）、`electron/settings.mjs`（语音合成配置）、`src/App.tsx` 与 `src/types.ts`（设置界面与桌面会话展示）、`tests/channels.test.mjs` 与 `tests/agent.test.mjs`（测试）。

纪律：

- 工作区里有未提交的右键菜单改动（`src/App.tsx`、`electron/main.mjs`、`electron/preload.cjs`、`src/styles.css`、`src/types.ts`、`tests/desktop-contract.test.mjs`、`scripts/repro-rightclick.mjs`），只改本任务相关行，不要顺手重排或清理这些改动。
- 每次只推进一个阶段，跑通该阶段验收再进下一阶段；失败要修好重测，不要标记一下就交回。
- 真机验证（真实 QQ/微信账号收发）不在自动化范围内，只允许如实报告"未真机验证"，禁止谎称通过。
- 不新增零散 SQL 脚本（本任务不涉及数据库）。

## 1. 已确认的平台事实（实施前必读）

微信（官方 iLink 通道，SDK 为 `weixin-clawbot`）：

- SDK 的 `BotContext` 已支持：`reply({ kind: "image"|"voice"|"file"|"video", filePath, fileName?, text? })`、`ctx.downloadMedia()` 下载并解密收到的媒体（返回 Buffer）。类型定义在 `node_modules/weixin-clawbot/dist/public-types.d.ts`。
- 收到的消息对象 `ctx.message` 有 `kind`（text/image/file/voice/video），语音自带 `transcript`。
- 语音按平台要求是 silk 编码，出站语音文件必须先转成 silk。

QQ（官方机器人 API，现有代码手写协议，零第三方依赖）：

- 富媒体必须先上传拿 `file_info`，再以 `msg_type: 7` 发送：私聊上传 `POST /v2/users/{openid}/files`，群聊上传 `POST /v2/groups/{group_openid}/files`，multipart 表单含 `file_type`（1 图片、2 视频、3 语音、4 文件）和文件字段。
- `msg_type=7` 发送时 `content` 字段按文档需要填一个空格 `" "`，同时携带 `media: { file_info }`；被动回复的 `msg_id` 是否对富媒体生效需真机验证（详见风险清单）。
- 入站事件 `data.attachments` 数组含 `url`、`content_type`、`size`、文件名；`content_type` 形如 `image/jpeg`、`image/png`、`video/mp4`、`voice`、`file`。
- 需要真机验证：`file_type=4`（文件）当前是否开放；语音上传要求的具体格式。

## 2. 统一契约与常量（先做这部分）

渠道消息契约统一为：

```js
// 入站
{
  channel, chatType, chatId, userId, userName,
  text: string,            // 纯媒体消息时填占位文案，如 "[图片]"、"[文件:报表.xlsx]"、"[语音]"、"[视频]"
  media?: [{ kind: "image"|"voice"|"file"|"video", filePath, fileName?, mimeType?, size?, transcript?, url? }],
  messageId: string,
}
// 出站 replyMedia 的 parts
[ { type: "text", text } | { type: "media", kind, filePath, fileName? } ]
```

在 `electron/channels/manager.mjs` 新建常量并调整契约：

- 新增 `const MAX_MEDIA_BYTES = 50 * 1024 * 1024;` 和 `MEDIA_STAGING_DIR` 由 `main.mjs` 注入（见第 4 节）。
- `handleInbound` 保持审批/停止词逻辑不变（它们只看 `message.text`），把 `message.media` 原样透传给 `onRunTask`。
- `reply` 只负责文本；新增 `replyMedia(parts)`：优先调 `adapter.sendMedia(message, parts)`，适配器没有该方法时降级为逐条 `sendText` 的文字说明。给 `enqueue` 回调里保存最后一次入站 `message` 引用，供 `replyMedia` 使用。

## 3. 阶段一：入站多媒体（先能看懂）

### 3.1 微信适配器 `electron/channels/wechat.mjs`

现在 `bot.on("message")` 只处理 `text` 和带 `transcript` 的 `voice`，其余回一句"目前只支持文字消息"（约 123–154 行）。改成：

- `text`：维持现状。
- `voice`：维持现状（用 `transcript`），同时在 `media` 里附带 `{ kind: "voice", transcript }`。
- `image` / `file` / `video`：调用 `await ctx.downloadMedia()` 拿 Buffer；用 `sniffImageExtension(buffer)`（按文件头：`FFD8`→jpg、`8950`→png、`4749`→gif、`RIFF`→webp，识别不出且是 file 时用消息里的 `fileName` 后缀）写进暂存目录 `channelMediaDir()/wechat/<messageId><ext>`；size 超过 `MAX_MEDIA_BYTES` 时不落盘，只回"文件超过 50 MB，暂不支持"；然后 `onMessage({ channel:"wechat", ..., text: 占位文案, media: [{ kind, filePath, fileName, mimeType, size }] })`。
- 下载/解密失败时 `ctx.reply("这个文件暂时读不了，请换个方式发给我。")`，不让渠道崩溃。

新增一个小函数 `sniffImageExtension(buffer)`（纯函数，放文件顶部，导出供测试）。

### 3.2 QQ 适配器 `electron/channels/qq-bot.mjs`

- `normalizeQqEvent`（约 44–64 行）：现在 `!text` 直接返回 null，改成"有文字或有附件都归一化"。读取 `data.attachments`，按 `content_type` 分类生成 `media` 条目（含 `url`、`size`、`fileName`）；纯媒体时 `text` 填占位文案。导出 `normalizeQqMediaAttachment(attachment)` 纯函数供测试。
- `createQqBotClient` 增加 `downloadAttachment(media, channelMediaDir)`：用 `api()` 的 access token，以 `Authorization: QQBot <token>` 请求 `media.url` 下载（如需带鉴权头，真机验证后调整），落盘到 `channelMediaDir()/qq/<messageId><ext>`，同样有 50 MB 上限和 `sniffImageExtension`。
- 语音：QQ 的 voice 附件是 silk，`transcriptionEndpoint` 收不了 silk。先落盘原始文件，在 `runChannelTask` 侧做 silk→wav 解码后转写（见 3.4）；解码依赖未就绪时，语音按占位文案进任务并回一句"收到语音，但语音识别服务还没有配置好"。

### 3.3 主进程 `electron/main.mjs`

- 新增 `channelMediaDir()`：`path.join(app.getPath("userData"), "channel-media")`，`mkdir` 递归创建；随 `createChannelManager` 注入给两个适配器。
- `runChannelTask` 解构新增 `media`。把 `media` 转成桌面 `Attachment[]`（复用现有 `describeAttachment(filePath)` 拿 `name/path/size/mimeType/isImage/previewUrl`），塞进 `userMessage.attachments`，让桌面会话直接显示缩略图和文件名。
- 模型可见内容复用现有 `providerMessageContent(message)`：把附件组装进 `message.attachments` 后调用它，得到"文本 + image_url 块"；把它作为本轮对话的 user 消息内容传给 `runAgent`（替换现在写死的 `userText` 纯字符串）。注意：`providerMessageContent` 只展开图片和文本类文件，二进制文件会附加说明文字，这符合预期。
- QQ 语音转写：把现有 `voice:transcribe` IPC 处理函数（约 1067–1097 行）抽成可复用函数 `transcribeAudio(audioBytes, mimeType, settings)`；QQ 语音先经 silk 解码（新增依赖 `silk-wasm`，见风险清单）转成 PCM 并补 WAV 头，再以 `audio/wav` 调用；失败就退回占位文案，任务继续。

### 3.4 设置与桌面展示（阶段一最小改动）

- `src/types.ts` 的 `Attachment` 已够用，不改结构。
- 渠道会话展示已支持 `attachments`（桌面消息本来就有），只需确认渠道消息带 `attachments` 后能渲染；发现问题再改 `src/App.tsx` 渲染处，不要动其它 UI。

### 阶段一验收

- `npm run test:channels` 全绿，新增用例见第 6 节。
- 真机（需用户配合）：微信发图片/文件/语音、QQ 发图片/文件，桌面会话能看到附件，助手按内容正确作答。

## 4. 阶段二：出站图片 / 文件

### 4.1 工具定义与路由 `electron/main.mjs`

- 新增 `channelMediaToolDefinitions()`（形状照抄 `electron/browser.mjs` 的 `browserToolDefinitions`，即 `{ type:"function", function:{ name, description, parameters } }`），包含工具：
  - `send_media`：参数 `path`（工作区相对路径）、`caption?`。描述明确：把工作区里生成的文件作为结果发回 IM 渠道，只能发图片或常见文档，不能发可执行文件。
  - 工具结果返回"已登记发送：<文件名>"或明确的失败原因。
- `runChannelTask` 里：`extraTools` 改为 `[...agentExtraTools(await mcpExtraTools(taskSettings)), ...channelMediaToolDefinitions()]`；`routeExtraTool` 包一层，先匹配 `send_media`，未命中再交给现有 `createExtraToolRouter`。`send_media` 处理器校验：路径必须落在 `workspacePath` 内（复用现有外部路径判断思路）、文件存在、扩展名在白名单（png/jpg/jpeg/gif/webp/pdf/csv/xlsx/docx/zip 等，禁止 .exe/.sh/.bat/.js 等）、大小不超过 50 MB；通过后写入闭包里的 `pendingMedia[]`。
- 任务结束后：若有 `pendingMedia`，把 `finalText` 作为第一条 text part，随后每个媒体一条 media part，调用 `replyMedia`；失败逐条降级为文字。桌面侧把"已发送 N 个文件"追加进助手消息。

### 4.2 微信出站 `electron/channels/wechat.mjs`

- 新增 `sendMedia(chat, parts)`：遍历 parts，text 走现有 `chunkText` + `ctx.reply`；media 走 `ctx.reply({ kind, filePath, fileName?, text: caption? })`（SDK 支持图片/文件/语音带 caption）。`ctx` 取 `lastContextByChat.get(chat.chatId)`，取不到就报"请对方先发一条消息再让助手发文件"。

### 4.3 QQ 出站 `electron/channels/qq-bot.mjs`

- 新增 multipart 上传辅助函数 `uploadFile(chat, filePath, fileType)`：用 `accessToken()`，`FormData` 带 `file_type` 与 `file`（`new Blob([buffer])` + 文件名），POST 到 `/v2/users/{openid}/files`（群聊用 `/v2/groups/{group_openid}/files`）；解析返回的 `file_info`（若返回字段名是 `file_uuid` 按实际字段取）。
- 新增 `sendMedia(chat, parts)`：media part 先 `uploadFile`（image→1、video→2、voice→3、file→4），再 POST `/messages`，body 为 `{ content: " ", msg_type: 7, msg_seq: 递增, media: { file_info }, ...(chat.messageId ? { msg_id: chat.messageId } : {}) }`；上传或发送失败抛 `QqBotError`，由 manager 降级。

### 阶段二验收

- 自动化：伪造 fetch 断言上传走对了端点、`file_type` 映射正确、发送 body 是 `msg_type:7` 且带 `media.file_info`；路径越界、危险扩展名、超限文件被拒绝。
- 真机（需用户配合）：助手生成图表/导出文件后回发 QQ、微信，均能收到并打开。

## 5. 阶段三：语音出站（与阶段二解耦）

- 设置新增语音合成配置：`electron/settings.mjs` 的序列化/反序列化加 `ttsEndpoint`、`ttsModel`（默认空）、`ttsApiKey`（为空时回退主模型 apiKey）；`src/types.ts` 的 `ProviderSettings` 加同名字段；`src/App.tsx` 设置页在"语音转写"附近加三行输入框。接入 OpenAI 兼容的 `POST {ttsEndpoint}/audio/speech`（body: `{ model, input, voice }`，`voice` 默认 `alloy`，可后续再暴露选择）。
- 新增工具 `text_to_speech`（参数 `text`、`path`）：调语音合成得到 mp3，用 `silk-wasm` 编码成 silk 存到工作区 `path`；然后 `send_media` 发 `path`（两平台 voice 都按 silk 走）。
- QQ 上传 `file_type=3`、微信 `ctx.reply({ kind: "voice", filePath })`。

### 阶段三验收

- 真机（需用户配合）：助手把一段话转成语音发到 QQ、微信，手机上可播放。
- 未配置语音合成时，`text_to_speech` 返回清晰提示而不是静默失败。

## 6. 测试计划（每个阶段同步补）

`tests/channels.test.mjs`（不依赖 Electron，注入假 fetch/ws/bot）：

- 微信：image/file/video 消息触发 `downloadMedia`、落盘调用正确、纯媒体消息带占位 `text` 与 `media` 数组；`sniffImageExtension` 各魔数；`sendMedia` 对每个 part 生成正确的 `ctx.reply` 参数。
- QQ：`normalizeQqMediaAttachment` 各 `content_type` 分类；`sendMedia` 先上传后发送、`file_type` 映射、`msg_type:7` body；上传 4xx 时抛错。
- manager：`handleInbound` 把 `media` 透传给 `onRunTask`；`replyMedia` 降级路径。

`tests/agent.test.mjs`：

- `send_media` 工具：工作区内文件登记成功、越界路径/危险扩展名/超限被拒绝（用假 `runAgent` + 注入 `onExtraTool`，参照现有 browser 工具测试的写法）。

回归命令（按顺序全跑）：`npm run test:channels`、`npm run test:agent`、`npm run build:renderer`、`npm test`。

## 7. 完成标准（全部阶段）

1. 微信、QQ 入站图片/文件/语音被正确归一化并在桌面会话可见。
2. 助手能按内容作答，媒体被安全暂存、超限与解密失败有可读降级。
3. 助手能把工作区生成的图片/文件发回两个渠道，QQ 富媒体消息格式正确。
4. 语音出站打通并真机可播（未配置语音合成时提示明确）。
5. 上述测试命令全绿；真机验证项逐条如实标注"已验证/未验证"。

## 8. 风险与需用户真机确认项

1. QQ `file_type=4`（文件）官方文档曾标"暂不开放"，先真机试发一个文件再实现文件路径；不开放就只做图片/视频/语音并如实说明。
2. QQ 语音上传格式是否为 silk，需真机确认；silk 编解码引入 `silk-wasm` 依赖（需要网络安装，失败就停下询问，不要绕过）。
3. QQ 富媒体被动回复（带 `msg_id`）是否生效；不生效就改主动发送，但主动私聊消息受平台配额限制，需用户确认可接受。
4. 微信附件下载 URL 与大小限制以真机为准；出站 `ctx` 依赖"对方最近发过消息"，久不回复会发不出，保留清晰报错。
5. DeepSeek V4 Flash/Pro 是纯文本模型，渠道图片最终走已配置的外部视觉服务；未配置视觉服务时助手会提示，属预期行为。

## 9. 决策记录（已拍板，实施时不要改）

- 出站媒体不额外加审批：与文本回复同渠道同权责，但严格限定工作区路径、白名单扩展名和 50 MB 上限。
- 入站媒体落 `userData/channel-media`（不写进工作区），只当数据读取，绝不执行；后续可加 7 天清理。
- 默认大小上限 50 MB（图片 10 MB、语音 25 MB 可在常量里细分）。
