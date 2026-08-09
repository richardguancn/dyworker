#!/bin/bash
# DYWorker macOS 首次打开放行脚本（免费方案）
# 适用：从 GitHub 下载的未签名/未公证版本被 Gatekeeper 提示“已损坏，无法打开”
# 用法：双击本文件运行，或终端执行 bash scripts/macos-open-fix.command

set -u

APP_PATH="${1:-/Applications/DYWorker.app}"

if [ ! -d "$APP_PATH" ]; then
  echo "未找到 $APP_PATH"
  echo "请输入 DYWorker.app 的实际路径（例如 /Applications/DYWorker.app）："
  read -r APP_PATH
fi

if [ ! -d "$APP_PATH" ]; then
  echo "路径不存在，请确认应用已复制到应用程序文件夹后重试。"
  exit 1
fi

echo "正在清除下载隔离标记…"
xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null \
  || sudo xattr -rd com.apple.quarantine "$APP_PATH"

echo "正在重新签名…"
codesign --force --deep -s - "$APP_PATH"

echo "完成，现在打开 DYWorker。"
open "$APP_PATH"
