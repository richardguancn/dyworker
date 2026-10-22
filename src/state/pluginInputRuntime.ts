import { useEffect } from "react";
import { clientHost } from "../pluginRuntime/clientHostSingleton.ts";
import type { ChatMessage } from "../types";
import { useComposerStore } from "./composerStore";
import { sendMessage } from "./sendMessageActions";
import { updateSession } from "./sessionActions";
import { useSessionStore } from "./sessionStore";
import { activeIdRef,attachmentsRef } from "./sharedRefs";
export function usePluginInputRuntime() {
  const { setAttachments } = useComposerStore();
  const { runningSessionIds } = useSessionStore();


  useEffect(() => {
    clientHost().setNativeAttachmentProvider(owner => {
      const selected = attachmentsRef.current;
      if (activeIdRef.current !== owner || !selected.length) return undefined;
      const current = () => activeIdRef.current === owner && attachmentsRef.current === selected;
      return {count:selected.length,names:selected.map(file=>file.name),current,
        async serialize(signal) {
          signal.throwIfAborted();
          if (!current()) throw new Error('附件或会话已经变化，输入已保留');
          if (!window.dyworker?.serializeCommandAttachments || selected.some(file => !file.commandGrantId))
            throw new Error('附件需要重新选择后才能发送');
          const result = await window.dyworker.serializeCommandAttachments({sessionId:owner,grantIds:selected.map(file=>file.commandGrantId!)});
          signal.throwIfAborted();
          if (!current()) throw new Error('附件或会话已经变化，输入已保留');
          if (!result.ok || !result.attachments) throw new Error(result.error || '附件保存失败');
          return result.attachments;
        },
        consume() { if (current()) setAttachments([]); },
      };
    });
    const offQueue = clientHost().subscribeInputQueue(change => {
      updateSession(change.sessionId, session => ({...session,messages:change.action.kind === 'remove'
        ? session.messages.filter(message => message.id !== change.itemId)
        : change.action.kind === 'edit' ? session.messages.map(message => message.id === change.itemId
          ? {...message,content:change.action.content.map((part:any) => part.text).join('\n'),dshAttachments:undefined,dshAttachmentNames:undefined,
            displayContent:undefined,pluginReferences:undefined} : message) : session.messages}));
    });
    clientHost().setInputSubmit(async input => {
      if (runningSessionIds.has(input.sessionId)) {
        input.signal.throwIfAborted();
        const requestId = crypto.randomUUID();
        const response = await window.dyworker?.dshOperation({sessionId:input.sessionId,action:'input-admit',payload:{
          requestId,mode:input.mode,content:[...(input.text ? [{type:'text',text:input.text}] : []),...input.attachments],
        }});
        if (!response?.ok) {
          if (response?.error?.code !== 'dyworker/input-unavailable') throw new Error(response?.error?.message || '插件输入未发送');
          // 原任务刚结束时，按应用正常入口取得下一轮授权；空闲状态下即时补充也是新一轮。
        } else {
          const accepted = response.value;
          if (accepted?.accepted !== true || typeof accepted.messageId !== 'string') throw new Error('任务没有返回已接收消息的确认');
          updateSession(input.sessionId, session => {
            if (session.messages.some(message => message.id === accepted.messageId)) return session;
            const message: ChatMessage = {id:accepted.messageId,role:'user',content:input.text,createdAt:new Date().toISOString(),
              ...(input.attachmentNames?.length ? {dshAttachmentNames:[...input.attachmentNames]} : {}),
              ...(input.presentation?.references.length ? {displayContent:input.presentation.text,pluginReferences:input.presentation.references} : {}),
              ...(input.attachments.length ? {dshAttachments:[...input.attachments] as ChatMessage['dshAttachments']} : {})};
            const messages = [...session.messages,message];
            return {...session,messages,updatedAt:message.createdAt};
          });
          await clientHost().refreshInputInbox(input.sessionId);
          return {kind:'success'};
        }
      }
      await sendMessage(input.text, input.sessionId, undefined, input);
      return {kind:'success'};
    });
    return () => {offQueue();clientHost().setInputSubmit(undefined);clientHost().setNativeAttachmentProvider(undefined);};
  });

}
