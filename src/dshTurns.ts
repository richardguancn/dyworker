import type {ChatMessage, DshVisibleTurn} from './types.ts';
import {reconcileDshMessages,patchDshAssistant as patch} from '../electron/host/dsh-runtime/presentation.mts';

/** An adoption acknowledges an existing task; it must not replay an old archive over live chat. */
export function mergeCreatedDshTask(current:import('./types.ts').SessionRecord[],record:import('./types.ts').SessionRecord){
  return current.some(row=>row.id===record.id)?current:[record,...current];
}

export function reconcileDshTurns(messages:ChatMessage[],turns:DshVisibleTurn[],options:{userId:string;assistantId:string;runId:string;live?:boolean}):ChatMessage[] {
  return reconcileDshMessages(messages,turns,options);
}
export function patchDshAssistant(messages:ChatMessage[],options:{assistantId:string;runId:string;turnId?:string},updater:(message:ChatMessage)=>ChatMessage):ChatMessage[] {
  return patch(messages,options,updater);
}
