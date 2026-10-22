import { useEffect } from "react";
import { type AnnotationQuote } from "../annotations";
import type { SessionRecord } from "../types";
import { updateAnnotationMarkers } from "./composerActions";
import { useComposerStore } from "./composerStore";
import { useSessionStore } from "./sessionStore";
import { annotationQuotesRef,viewportRef } from "./sharedRefs";
export function useAnnotationRuntime({ activeSession }: { activeSession: SessionRecord | undefined }) {
  const { selectionQuote, setSelectionQuote, annotations } = useComposerStore();
  const { activeId } = useSessionStore();


  // 选区浮动条的关闭时机：选区塌陷（重新选择/点空白）、Esc、视口滚动
  useEffect(() => {
    if (!selectionQuote) return;
    const onSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) setSelectionQuote(null);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setSelectionQuote(null);
    };
    document.addEventListener("selectionchange", onSelectionChange);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selectionQuote]);

  // 注释增删、编辑、切换会话或消息变化时更新引用列表
  useEffect(() => {
    const quotes: AnnotationQuote[] = [
      ...annotations.map((annotation, index) => ({ ...annotation, n: index + 1 })),
      ...(activeSession?.messages ?? []).flatMap((message, messageIndex) =>
        (message.annotations ?? []).map((annotation, index) => ({
          id: `${message.id ?? messageIndex}-${annotation.id}`,
          n: index + 1,
          quote: annotation.quote,
          comment: annotation.comment,
        }))),
    ];
    annotationQuotesRef.current = quotes;
    // 等正文完成布局后统一定位，避免同一轮消息更新重复测量。
    const frame = requestAnimationFrame(updateAnnotationMarkers);
    return () => cancelAnimationFrame(frame);
  }, [annotations, activeId, activeSession?.messages]);
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateAnnotationMarkers);
    };
    const viewport = viewportRef.current;
    const observer = new ResizeObserver(schedule);
    if (viewport) observer.observe(viewport);
    const column = viewport?.querySelector(".conversation-column");
    if (column) observer.observe(column);
    viewport?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      viewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

}
