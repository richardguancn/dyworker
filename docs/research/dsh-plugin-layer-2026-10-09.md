# DSH 插件支持层对齐（2026-10-09）

## 范围与完成标准

本次按用户要求对齐通用插件支持层：读取插件包及配置、解析入口、依赖等待、分组装载、启停与恢复、浏览器模块依赖和版本检查。不按插件名称逐个追加适配，不复刻完整 DSH 应用，也不承诺所有第三方插件均可用。

完成标准：按照上游规则实现缺项；用真实 Cordis 加载器和官方 DSH 进程验证新增行为；复查已有办公、待办等插件；运行项目完整构建及测试。插件清单继续沿用已验证版本规则，第三方 dsh-context 继续隐藏，内置上下文继续保留。

## 核对的上游

已在线读取官方仓库的源码树，并按该树对应提交获取插件层文件：[`5badb15009ae1756c3afe0ae0cef1faafc290ccc`](https://github.com/deepseek-ai/deepseek-harness/tree/5badb15009ae1756c3afe0ae0cef1faafc290ccc)。`dsh-app-boot` 源码版本仍是 `0.2.1-alpha.1`，因此保留现有固定发布版本，不改为浮动依赖。

主要依据：

- [`DshBundleManifest` 与 `DshClientManifest`](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/util/package-manifest/src/types.ts)：配置文件可为单个路径或有序路径数组；客户端 `inject` 和 `external` 是模块依赖。
- [`bundlePatchPaths`](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/boot/app-boot/src/profile.ts) 与 [`loadOverlayPatches`](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/boot/app-boot/src/index.ts)：配置相对入口锚定到各自配置文件，多层配置使用官方补丁算法合成。
- [`EntryOptions`](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/vendor/loader/src/config/entry.ts)：`group`、`inject`、配置表达式和禁用值都交给加载器解释。
- [`evaluatePluginCompatibility`](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/boot/app-boot/src/plugin-compatibility.ts)：按当前 DSH 版本检查官方包的 peer 要求，包括预发布版本；例外限定精确插件版本和精确运行版本。

## 具体修改

1. 配置读取改用官方 `bundlePatchPaths` 和 `loadOverlayPatches`。支持多文件、`!!js` 和文件所在目录中的相对入口。无效声明、缺失文件和无效配置明确失败；只有配置而没有主机入口的包可以装载其声明的条目。
2. 全部配置层一次合成，并在调用前复制输入。后续配置覆盖不再污染保存的原配置，停用、卸载和重启可以重新合成同样的结果。
3. 用户插件树使用官方 YAML 方言，保留 `group`、`inject` 和禁用表达式。原生组使用官方 Group/Include；包含 DSH 插件的组整体交给官方会话加载器，保留组内服务提供与依赖等待。会话传递过程保留完整条目选项，不再只传名称和配置。
4. 主机插件入口按 Node ESM 条件解析，支持仅有 `import` 导出的包、包子路径、本地入口和 npm 别名。显式禁止的子路径不能被通配符放行；ESM 目标缺失不能改用另一份 `require` 入口。
5. 不要求第三方插件名称带 `dsh-` 前缀。声明官方 DSH 依赖的插件进入官方运行环境；显式 `dyworker` 声明仍优先。
6. 浏览器模块依赖递归包含每层的 `external`，不是只读取最外层。同步模块、异步分块、样式清理和缓存失效继续复用已纳入项目的官方浏览器模块系统。
7. 版本检查复用官方逻辑，版本不匹配时先拒绝，避免先执行入口。沿用界面已有的“仍然安装”选择，由官方独立 `compatibility.json` 保存精确版本例外。官方会话继承当前插件目录中已接受的例外，插件或运行版本变化不会自动取得新授权。
8. 无效插件树重载返回失败并保留正在运行的插件。修复配置后可重试。分组的重载判定同时检查子入口，避免遗漏组内代码变化。

## 验证记录

新增 `tests/dsh-plugin-layer.test.mjs` 使用临时插件目录与实际运行进程，验证多文件顺序、相对路径、无主入口配置包、配置隔离、启停、卸载、重启、依赖等待、分组、表达式、ESM 条件、别名、禁止子路径、版本拒绝及精确授权、无效配置恢复、递归客户端模块执行和真实官方待办组。检查期间不调用在线模型，不改用户插件目录或 `~/.dsh`。

已有插件层的 109 项针对性检查通过。最终针对性检查共 14 项（新增支持规则 12 项，加模块缓存检查 2 项），全部通过；新增 12 项还使用 `/Applications/DYWorker.app/Contents/MacOS/DYWorker` 的 `ELECTRON_RUN_AS_NODE=1` 模式再次运行，全部通过。这验证的是应用所带运行环境执行当前工作区代码，不表示已安装应用已更新，也不等同于窗口验收。

最终 `npm run verify` 完成：1450 项中 1427 项通过，23 项跳过，0 项失败、0 项取消。最后还对最终源码单独执行 `npm run build`，构建成功。普通办公文件读写、真实官方待办的隔离与恢复、安装失败恢复旧版本、插件清单规则和现有后台工作检查均在完整检查中通过。

日志保留在 `/private/tmp/dyw-dsh-support-verify-final.log`、`/private/tmp/dyw-dsh-support-final-build.log`、`/private/tmp/dyw-dsh-support-final-focused.tap` 和 `/private/tmp/dyw-dsh-support-electron.tap`。代码、测试和本说明保存在工作区；尚未提交或发布。开始时已有的目标管理、思考显示和其他界面修改予以保留，未将其恢复成旧版。

受限环境中的后台工作检查曾超时，其他需要本机监听的检查也被环境拒绝。单独复现的任务结果显示 `sandbox-exec: sandbox_apply: Operation not permitted`，后台工作没有启动。重新验证使用允许 macOS 系统隔离功能及本机测试服务运行的环境；未修改应用的隔离规则。

## 结论边界

本次对齐的是列明的通用支持规则。插件仍必须符合当前固定 DSH 版本，并使用宿主实际装配的服务。依赖额外平台服务、指定其他客户端平台、或者插件自身出错的情况，不据此宣称可用。没有扩大公开可安装清单，没有发布新应用，也没有验证 Windows、麒麟或 UOS。
