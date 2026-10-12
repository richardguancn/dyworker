import { TerminalPanel } from '../../../src/TerminalPanel';

export default {
  name: 'dyworker-terminal-client',
  inject: ['slots'],
  apply(ctx: any) {
    ctx.slots.inject('workspace.terminal', () => ctx.slots.register({
      name: 'workspace.terminal', id: 'terminal', key: 'terminal', label: () => '终端',
    }, TerminalPanel));
  },
};
