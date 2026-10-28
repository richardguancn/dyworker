// 必须在加载任何第三方运行期模块之前执行。部分依赖默认把原生组件复制到
// 临时目录后再加载；商店版应直接加载应用包内已经签署的原始组件。
export function configureMacStoreRuntime({ mas = process.mas === true, env = process.env } = {}) {
  if (mas) env.NARB_DISABLE_NATIVE_CACHE = '1';
}

configureMacStoreRuntime();
