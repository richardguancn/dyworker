import fs from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import crypto from 'node:crypto';
import {reconcileDshMessages,patchDshAssistant} from '../../electron/host/dsh-runtime/presentation.mts';
// Exercise the actual shared main-process collector without initializing Electron or external channels.
const main=await fs.readFile(new URL('../../electron/main.mts',import.meta.url),'utf8');
const source=main.slice(main.indexOf('function createTranscriptCollector('),main.indexOf('async function runScheduledTask('));
export const createTranscriptCollector=new Function('reconcileDshMessages','patchDshAssistant','crypto',
  stripTypeScriptTypes(source)+'\nreturn createTranscriptCollector;')(reconcileDshMessages,patchDshAssistant,crypto);
export function mainScheduledEntry(deps) {
  const start=main.indexOf('async function runScheduledTask(');
  const end=main.indexOf('\n// ----',start);
  const scheduleSource=main.slice(start,end);
  return new Function(...Object.keys(deps),stripTypeScriptTypes(scheduleSource)+'\nreturn runScheduledTask;')(...Object.values(deps));
}

export function mainChannelEntry(deps) {
  const start=main.indexOf('async function runChannelTask(');
  const end=main.indexOf('\n// channels:get-status',start);
  return new Function(...Object.keys(deps),stripTypeScriptTypes('let runningChannelTaskCount=0;\n'+main.slice(start,end))+'\nreturn runChannelTask;')(...Object.values(deps));
}

export function mainWakeEntry(deps) {
  const start=main.indexOf('async function resumeWake(');
  const end=main.indexOf('\n// ----',start);
  return new Function(...Object.keys(deps),stripTypeScriptTypes(main.slice(start,end))+'\nreturn resumeWake;')(...Object.values(deps));
}
