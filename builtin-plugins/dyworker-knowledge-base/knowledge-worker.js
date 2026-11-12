import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';

async function execute() {
  const { knowledgeJob, input } = workerData;
  try {
    let result;
    if (knowledgeJob === 'graph') result = (await import('./graph.js')).buildKnowledgeGraph(...input);
    else if (knowledgeJob === 'graph-overview') result = (await import('./graph-api.js')).loadGraphOverview(input);
    else if (knowledgeJob === 'graph-search') result = (await import('./graph-api.js')).findDocumentMatches(input);
    else result = await (await import('./local-folders.js')).updateFolderIndex(input, progress => parentPort.postMessage({ progress }));
    parentPort.postMessage({ result });
  } catch (error) { parentPort.postMessage({ error: error.message || String(error) }); }
}

if (!isMainThread && workerData?.knowledgeJob) void execute();

export function runKnowledgeJob(knowledgeJob, input, { signal, onProgress } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { knowledgeJob, input }, execArgv: [] });
    let response;
    const abort = () => { void worker.terminate(); };
    signal?.addEventListener('abort', abort, { once: true });
    worker.on('message', message => {
      if (message.progress) onProgress?.(message.progress);
      else response = message;
    });
    worker.on('error', error => { response = { error: error.message }; });
    worker.once('exit', code => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) reject(signal.reason);
      else if (response?.error || code || !response) reject(new Error(response?.error || '知识库后台处理意外结束'));
      else resolve(response.result);
    });
  });
}
