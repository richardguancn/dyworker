import path from 'node:path';
import { createRuntime } from './runtime.js';

export const name = 'qwenpaw';
export const inject = ['connection', 'storage'];
export function apply(ctx, config = {}) {
  const root = path.join(ctx.storage.hostDir, 'qwenpaw');
  const python = config.python || path.join(root, 'runtime', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const runtime = createRuntime({ root, python });
  ctx.effect(() => () => runtime.stop());
  ctx.effect(() => ctx.connection.fetch.register({ path: '/api/qwenpaw', methods: ['POST'], fetch: async request => {
    try {
      const { action } = await request.json();
      const value = action === 'status' ? runtime.status() : action === 'start' ? await runtime.start()
        : action === 'stop' ? (await runtime.stop(), runtime.status()) : null;
      if (!value) return Response.json({ ok: false, error: '不支持的操作' }, { status: 400 });
      return Response.json({ ok: true, value });
    } catch (error) { return Response.json({ ok: false, error: error.message }, { status: 503 }); }
  } }));
}
