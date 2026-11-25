import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  describeFileCardKind,
  extractChannelPrefix,
  parseUserMessagePresentation,
} from "../src/lib/channelMessage.ts";
import { formatFileSize } from "../src/lib/format.ts";

test("extractChannelPrefix 解析各类渠道前缀并去掉方括号", () => {
  assert.deepEqual(
    extractChannelPrefix("[来自微信] [文件:第三届数创大赛报名材料.docx]"),
    {
      channelPrefix: "[来自微信]",
      channelLabel: "来自微信",
      body: "[文件:第三届数创大赛报名材料.docx]",
    },
  );
  assert.deepEqual(
    extractChannelPrefix("[来自QQ 张三] 帮我看下这个"),
    {
      channelPrefix: "[来自QQ 张三]",
      channelLabel: "来自QQ 张三",
      body: "帮我看下这个",
    },
  );
  assert.deepEqual(
    extractChannelPrefix("[来自飞书 李四] [图片]"),
    {
      channelPrefix: "[来自飞书 李四]",
      channelLabel: "来自飞书 李四",
      body: "[图片]",
    },
  );
  assert.deepEqual(
    extractChannelPrefix("普通桌面文本"),
    {
      channelPrefix: "",
      channelLabel: "",
      body: "普通桌面文本",
    },
  );
});

test("parseUserMessagePresentation 剥离占位文案并兼容历史落盘 ID 恢复真实文件名", () => {
  const legacyWechat = parseUserMessagePresentation(
    "[来自微信] [文件:第三届数创大赛报名材料（标红，修订稿）V2.4.docx]",
    {
      hasImages: false,
      isVoice: false,
      fileAttachments: [
        {
          name: "v1:16869963721116741032.docx",
          path: "/tmp/channel-media/wechat/v1:16869963721116741032.docx",
          size: 154200,
          mimeType: "application/octet-stream",
          isImage: false,
        },
      ],
    },
  );
  assert.equal(legacyWechat.channelLabel, "来自微信");
  assert.equal(legacyWechat.visibleText, "");
  assert.equal(legacyWechat.resolvedFiles.length, 1);
  assert.equal(
    legacyWechat.resolvedFiles[0].displayName,
    "第三届数创大赛报名材料（标红，修订稿）V2.4.docx",
  );

  const feishuFile = parseUserMessagePresentation(
    "[来自飞书 张三] [文件:预算表.xlsx]",
    {
      hasImages: false,
      isVoice: false,
      fileAttachments: [
        {
          name: "预算表.xlsx",
          path: "/tmp/a.xlsx",
          size: 2048,
          mimeType: "application/octet-stream",
          isImage: false,
        },
      ],
    },
  );
  assert.equal(feishuFile.channelLabel, "来自飞书 张三");
  assert.equal(feishuFile.visibleText, "");
  assert.equal(feishuFile.resolvedFiles[0].displayName, "预算表.xlsx");

  const fileWithText = parseUserMessagePresentation(
    "[来自微信] 请帮我把这份材料精简到两页内",
    {
      hasImages: false,
      isVoice: false,
      fileAttachments: [
        {
          name: "汇报.pptx",
          path: "/tmp/a.pptx",
          size: 500000,
          mimeType: "application/octet-stream",
          isImage: false,
        },
      ],
    },
  );
  assert.equal(fileWithText.channelLabel, "来自微信");
  assert.equal(fileWithText.visibleText, "请帮我把这份材料精简到两页内");
  assert.equal(fileWithText.resolvedFiles[0].displayName, "汇报.pptx");

  const pureImage = parseUserMessagePresentation(
    "[来自QQ 王五] [图片]",
    { hasImages: true, isVoice: false, fileAttachments: [] },
  );
  assert.equal(pureImage.channelLabel, "来自QQ 王五");
  assert.equal(pureImage.visibleText, "");

  const pureText = parseUserMessagePresentation(
    "[来自微信] 今天有什么日程",
    { hasImages: false, isVoice: false, fileAttachments: [] },
  );
  assert.equal(pureText.channelLabel, "来自微信");
  assert.equal(pureText.visibleText, "今天有什么日程");

  const desktopFile = parseUserMessagePresentation(
    "分析这份日志",
    {
      hasImages: false,
      isVoice: false,
      fileAttachments: [
        {
          name: "app.log",
          path: "/ws/app.log",
          size: 1024,
          mimeType: "text/plain",
          isImage: false,
        },
      ],
    },
  );
  assert.equal(desktopFile.channelLabel, "");
  assert.equal(desktopFile.visibleText, "分析这份日志");
  assert.equal(desktopFile.resolvedFiles[0].displayName, "app.log");

  const wechatVideo = parseUserMessagePresentation(
    "[来自微信] [视频]",
    {
      hasImages: false,
      isVoice: false,
      fileAttachments: [
        {
          name: "video.mp4",
          path: "/tmp/v.mp4",
          size: 12345,
          mimeType: "video/mp4",
          isImage: false,
        },
      ],
    },
  );
  assert.equal(wechatVideo.channelLabel, "来自微信");
  assert.equal(wechatVideo.visibleText, "");
  assert.equal(wechatVideo.resolvedFiles[0].displayName, "video.mp4");
});

test("describeFileCardKind 与 formatFileSize 按文件类型与字节大小格式化", () => {
  assert.deepEqual(describeFileCardKind("报告.docx"), { kind: "word", extLabel: "DOCX" });
  assert.deepEqual(describeFileCardKind("统计.xlsx"), { kind: "excel", extLabel: "XLSX" });
  assert.deepEqual(describeFileCardKind("演示.pptx"), { kind: "ppt", extLabel: "PPTX" });
  assert.deepEqual(describeFileCardKind("合同.pdf"), { kind: "pdf", extLabel: "PDF" });
  assert.deepEqual(describeFileCardKind("index.ts"), { kind: "code", extLabel: "TS" });
  assert.deepEqual(describeFileCardKind("归档.zip"), { kind: "archive", extLabel: "ZIP" });
  assert.deepEqual(describeFileCardKind("录像.mp4"), { kind: "video", extLabel: "MP4" });
  assert.deepEqual(describeFileCardKind("README.md"), { kind: "text", extLabel: "MD" });
  assert.deepEqual(describeFileCardKind("Makefile"), { kind: "generic", extLabel: "FILE" });

  assert.equal(formatFileSize(undefined), "");
  assert.equal(formatFileSize(0), "");
  assert.equal(formatFileSize(512), "512 B");
  assert.equal(formatFileSize(1536), "1.5 KB");
  assert.equal(formatFileSize(24576), "24 KB");
  assert.equal(formatFileSize(2.5 * 1024 * 1024), "2.5 MB");
  assert.equal(formatFileSize(2 * 1024 * 1024 * 1024), "2.0 GB");
});

test("源码契约：渠道附件保留原始文件名且 Linux 滚动视口不挂载 mask-image", () => {
  const channelRuntime = readFileSync(
    new URL("../electron/desktop/channel-runtime.mts", import.meta.url),
    "utf8",
  );
  assert.match(channelRuntime, /const preferredName = String\(item\.fileName \|\| ""\)\.trim\(\)/);
  assert.match(channelRuntime, /name: preferredName \|\| desc\.name/);

  const layoutCss = readFileSync(
    new URL("../src/layout.css", import.meta.url),
    "utf8",
  );
  assert.match(
    layoutCss,
    /html\[data-translucent="true"\] \.reference-layout:not\(\.platform-linux\) \.conversation-viewport\s*\{[\s\S]*?mask-image:/,
  );
  assert.match(
    layoutCss,
    /html:not\(\[data-translucent="true"\]\) \.reference-layout \.conversation-viewport\s*\{\s*background: var\(--surface-strong, var\(--surface\)\);\s*\}/,
  );
});
