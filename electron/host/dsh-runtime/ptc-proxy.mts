import NodePtcRuntime from '@deepseek-ai/dsh-ptc-runtime-node';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

export function createPtcProxy(ask: any) {
  const bindings = new Map<string, any>();
  const execution = new AsyncLocalStorage<any>();
  class ParentPtcRuntime extends NodePtcRuntime {
    static inject = ['fs', 'sandboxPolicy'];
    async run(spec: any) {
      const id = randomUUID();
      bindings.set(id, spec);
      const exec = execution.getStore();
      try {
        return await ask('ptc-run', { runId: id, spec: { program: spec.program, cwd: spec.cwd, timeoutMs: spec.timeoutMs,
          sandboxPolicy: spec.sandboxPolicy, bindings: spec.bindings.map((binding: any) => ({ global: binding.global,
            names: Object.keys(binding.functions), ...(binding.errorClass ? { errorClass: binding.errorClass } : {}) })) },
          ...(exec ? { tool: { sessionId: exec.agent.id, callId: exec.callId, name: exec.name, args: exec.arguments } } : {}) }, spec.signal);
      } finally { bindings.delete(id); }
    }
  }
  return { plugin: ParentPtcRuntime, wrap: (tool: any) => {
    const execute = tool.execute;
    tool.execute = (args: any, exec: any) => execution.run(exec, () => execute(args, exec));
  }, async invoke({ runId, global, member, args }: any) {
    const spec = bindings.get(runId); if (!spec) throw new Error('工作流调用已经结束');
    spec.signal?.throwIfAborted();
    const namespace = spec.bindings.find((binding: any) => binding.global === global);
    if (!namespace || !Object.hasOwn(namespace.functions, member)) throw new Error('工作流没有声明此调用');
    const result = await namespace.functions[member](args);
    spec.signal?.throwIfAborted(); return result;
  } };
}
