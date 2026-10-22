import { useEffect } from "react";
import { clientHost } from "../pluginRuntime/clientHostSingleton.ts";
import type { SessionRecord } from "../types";
import { useComposerStore } from "./composerStore";
import { dismissedPluginMention,textareaRef } from "./sharedRefs";
import { useViewStore } from "./viewStore";
export function usePluginInputSubscriptions({ activeSession, syncComposerDerivedState }: { activeSession: SessionRecord | undefined; syncComposerDerivedState: (value: string, caret?: number) => void }) {
  const { setPluginInputRevision, mentionMenu, setMentionMenu, setPluginInputCandidates, setMentionIndex, composer, pluginInputRevision, setComposer } = useComposerStore();
  const { setError } = useViewStore();


  useEffect(() => clientHost().subscribeInputSources(() => setPluginInputRevision(value => value + 1)), []);
  useEffect(() => clientHost().subscribe(() => setPluginInputRevision(value => value + 1)), []);
  useEffect(() => { if (mentionMenu?.programmatic) textareaRef.current?.focus(); }, [mentionMenu?.programmatic, activeSession?.id]);
  useEffect(() => {
    if (!mentionMenu?.programmatic || activeSession?.runtime !== 'dsh') return;
    const dismiss = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('.mention-menu, .composer-input-wrap, .add-menu-wrap')) return;
      clientHost().dismissInputMenu(activeSession.id); setMentionMenu(null);
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [mentionMenu?.programmatic, activeSession?.id, activeSession?.runtime]);
  useEffect(() => {
    const id = activeSession?.id; if (!id || activeSession.runtime !== 'dsh') return;
    const read = (changedId: string) => {
      if (changedId !== id) return;
      const menu = clientHost().inputMenuSnapshot(id);
      if (menu?.launched && menu.state.hit && clientHost().inputReady(id)) {
        const hit = menu.state.hit;
        setPluginInputCandidates(menu.candidates);
        setMentionMenu(previous => previous?.programmatic && previous.kind === (hit.trigger === '/' ? 'slash' : 'at')
          && previous.query === hit.query && previous.start === hit.span.start && previous.end === hit.span.end ? previous
          : { kind: hit.trigger === '/' ? 'slash' : 'at', query: hit.query, start: hit.span.start, end: hit.span.end, programmatic: true });
        setMentionIndex(0);
      } else setMentionMenu(previous => previous?.programmatic ? null : previous);
    };
    const off = clientHost().subscribeInputMenus(read); read(id); return off;
  }, [activeSession?.id, activeSession?.runtime]);
  useEffect(() => {
    const controller = new AbortController();
    if (mentionMenu?.programmatic) return () => controller.abort();
    setPluginInputCandidates([]);
    if (mentionMenu && activeSession?.runtime === 'dsh') {
      void clientHost().inputCandidates(activeSession.id, mentionMenu.query, mentionMenu.start, composer, controller.signal,
        mentionMenu.kind === 'slash' ? '/' : '@', mentionMenu.end)
        .then(items => { if (!controller.signal.aborted) setPluginInputCandidates(items); })
        .catch(error => { if (!controller.signal.aborted) setError(`插件命令读取失败：${String(error?.message || error)}`); });
    }
    return () => controller.abort();
  }, [mentionMenu, activeSession?.id, activeSession?.runtime, composer, pluginInputRevision]);
  useEffect(() => {
    if (activeSession?.id) clientHost().setInputDraft(activeSession.id, composer);
  }, [activeSession?.id, composer]);
  useEffect(() => clientHost().subscribeInputConsumer((sessionId, text, edit) => {
    if (activeSession?.id !== sessionId) return false;
    setComposer(text);
    if (edit?.continue) { dismissedPluginMention.current = null; syncComposerDerivedState(text, edit.caret); }
    else setMentionMenu(null);
    window.setTimeout(() => { textareaRef.current?.focus(); if (edit) textareaRef.current?.setSelectionRange(edit.caret, edit.caret); }, 0);
    return true;
  }), [activeSession?.id]);

}
