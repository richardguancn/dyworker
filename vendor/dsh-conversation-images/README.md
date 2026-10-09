# 官方会话历史图片组件

来源：DeepSeek Harness，固定提交 `5badb15009ae1756c3afe0ae0cef1faafc290ccc`，MIT 许可见 LICENSE。

- historical-images.ts 原样保留 packages/client/ui-conversation/src/client/conversation/historical-images.ts。构建为浏览器模块，继续使用官方缓存、预览替换及作用域回收。
- electron/host/dsh-runtime/vendor/referenced-image.mts 提取 packages/api/session-controller/src/commands.ts 中 imageBlockIn、imageInEvent、referencedImage；仅增加所需导入并导出最后一个函数。只读官方声明的内容字段，未知事件保持不透明。

宿主自行提供真实会话图片读取、根与子任务归属检查及独立释放的客户端绑定范围。这仅补齐历史图片能力，不能视为完整官方 SessionFace 或页面装配已经接入。
