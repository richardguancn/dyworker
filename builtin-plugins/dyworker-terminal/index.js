import { createTerminalManager } from './terminal-manager.js';

export const name = 'dyworker-terminal';
export const inject = ['ipc'];

export function apply(ctx) {
  const manager = createTerminalManager();
  ctx.effect(() => () => manager.dispose());
  for (const action of ['create', 'read', 'write', 'resize', 'close']) {
    ctx.effect(() => ctx.ipc.handle(`terminal:${action}`, async (event, payload) => {
      try { return { ok: true, ...await manager[action](event.sender, payload || {}) }; }
      catch (error) { return { ok: false, error: String(error?.message || error) }; }
    }));
  }
}
