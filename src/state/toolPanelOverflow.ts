import { useCallback,useEffect } from "react";
import { useLayoutStore } from "./layoutStore";
import { closeToolPanelTabRef } from "./sharedRefs";
import { closeToolPanelTab } from "./toolPanelActions";
export function useToolPanelOverflow({ toolPanelTabStripRef, pristineMenuPage, appliedToolPanelWidth }: { toolPanelTabStripRef: React.RefObject<HTMLDivElement | null>; pristineMenuPage: boolean; appliedToolPanelWidth: number }) {
  const { setToolPanelTabOverflow, rightPanelOpen, toolPanelTabs, activeToolPanelTabId } = useLayoutStore();


  // 标签条两侧是否还有被藏起来的标签：滚动按钮与渐隐遮罩按这个状态出现。
  // 标签不多时保持原来的样子（整条空白区仍是窗口拖拽区）。
  const syncToolPanelTabOverflow = useCallback(() => {
    const strip = toolPanelTabStripRef.current;
    if (!strip) return;
    const maxScrollLeft = strip.scrollWidth - strip.clientWidth;
    const next = {
      start: strip.scrollLeft > 1,
      end: maxScrollLeft - strip.scrollLeft > 1,
    };
    setToolPanelTabOverflow((current) => (
      current.start === next.start && current.end === next.end ? current : next
    ));
  }, []);

  useEffect(() => {
    const strip = toolPanelTabStripRef.current;
    if (!strip) return;
    syncToolPanelTabOverflow();
    const observer = new ResizeObserver(() => syncToolPanelTabOverflow());
    observer.observe(strip);
    strip.addEventListener("scroll", syncToolPanelTabOverflow, { passive: true });
    return () => {
      observer.disconnect();
      strip.removeEventListener("scroll", syncToolPanelTabOverflow);
    };
  }, [syncToolPanelTabOverflow, rightPanelOpen, pristineMenuPage, toolPanelTabs.length]);

  // 标签多起来之后要能滚：Chromium 不会把鼠标竖向滚轮转成横向滚动，
  // 这里把滚轮位移交给标签条，滚到头就放行（外层其它滚动区不受影响）。
  useEffect(() => {
    const strip = toolPanelTabStripRef.current;
    if (!strip) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      const maxScrollLeft = strip.scrollWidth - strip.clientWidth;
      if (maxScrollLeft <= 0) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? strip.clientWidth : 1;
      const delta = (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) * unit;
      if (!delta) return;
      const next = Math.max(0, Math.min(maxScrollLeft, strip.scrollLeft + delta));
      if (next === strip.scrollLeft) return;
      strip.scrollLeft = next;
      event.preventDefault();
    };
    strip.addEventListener("wheel", onWheel, { passive: false });
    return () => strip.removeEventListener("wheel", onWheel);
  }, [rightPanelOpen, pristineMenuPage, toolPanelTabs.length]);

  // 标签条整体重排（新增/关闭标签、面板宽度变化、面板展开收起）后重新判断溢出
  useEffect(() => {
    syncToolPanelTabOverflow();
  }, [syncToolPanelTabOverflow, toolPanelTabs, appliedToolPanelWidth]);

  // 当前标签必须可见：切标签、开新标签、拖宽面板后都把它带进视野
  useEffect(() => {
    const strip = toolPanelTabStripRef.current;
    const tab = strip?.querySelector<HTMLElement>(`[data-tool-panel-tab-id="${activeToolPanelTabId}"]`);
    if (strip && tab) {
      const stripRect = strip.getBoundingClientRect();
      const tabRect = tab.getBoundingClientRect();
      if (tabRect.left < stripRect.left) strip.scrollLeft -= stripRect.left - tabRect.left;
      else if (tabRect.right > stripRect.right) strip.scrollLeft += tabRect.right - stripRect.right;
      syncToolPanelTabOverflow();
    }
  }, [activeToolPanelTabId, rightPanelOpen, appliedToolPanelWidth, syncToolPanelTabOverflow]);

  const scrollToolPanelTabStrip = (direction: -1 | 1) => {
    const strip = toolPanelTabStripRef.current;
    if (!strip) return;
    const step = Math.max(180, Math.round(strip.clientWidth * 0.7));
    strip.scrollBy({ left: direction * step, behavior: "smooth" });
  };

  closeToolPanelTabRef.current = closeToolPanelTab;
  return { scrollToolPanelTabStrip };
}
