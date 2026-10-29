import { KnowledgePanel } from './KnowledgePanel';

export default {
  name: 'dyworker-knowledge-base-client',
  inject: ['slots'],
  apply(ctx: any) {
    ctx.slots.inject('conversation.view', () => ctx.slots.register({
      name: 'conversation.view', id: 'knowledge-base', key: 'knowledge-base',
      order: 40, label: () => '知识库',
    }, KnowledgePanel));
  },
};
