import { fileURLToPath } from 'node:url';

export const name = 'dyworker-linux-computer-use';
export const inject = ['linuxComputerUse', 'tools'];

export async function apply(ctx) {
  await ctx.linuxComputerUse.mount(ctx, fileURLToPath(new URL('./bin/', import.meta.url)));
}
