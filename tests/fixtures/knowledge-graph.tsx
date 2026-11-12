// 验收实际知识库组件；所有接口由 preview-knowledge-graph.mjs 的真实临时宿主提供。
import React from 'react';
import { createRoot } from 'react-dom/client';
import { KnowledgePanel } from '../../builtin-plugins/dyworker-knowledge-base/src/KnowledgePanel';
window.dyworker = {
  ...window.dyworker,
  knowledgeLocalFolders: async payload => (await fetch('/api/kb/preview-folders', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  })).json(),
} as NonNullable<Window['dyworker']>;
createRoot(document.getElementById('root')!).render(<KnowledgePanel />);
