import {RemoteError} from '@deepseek-ai/dsh-typert-protocol';
import {withDshCorpus,type CorpusOptions} from './session-corpus.mts';

/** Actual persistence handles form one authorized corpus before original SQLite ranking. */
export async function searchDshSessions(options:CorpusOptions&{query:unknown}){
 options.signal.throwIfAborted();
 if(typeof options.query!=='string')throw new RemoteError('gateway/bad-request','搜索内容必须是文字',{});
 return withDshCorpus(options,({list})=>list.search(options.query,options.signal),async list=>{
  // Original validation runs before opening any stored root or active provider.
  await list.search(options.query,options.signal);
 });
}
