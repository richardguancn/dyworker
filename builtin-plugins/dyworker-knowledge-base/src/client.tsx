import { KnowledgePanel } from './KnowledgePanel';

export default {
  name: 'dyworker-knowledge-base-client',
  inject: ['slots'],
  apply(ctx: any) {
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section', id: 'knowledge-base', key: 'knowledge-base',
      order: 40, label: () => '知识库',
    }, KnowledgePanel));
  },
};
