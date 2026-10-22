import { useCallback,useEffect } from "react";
import { availablePluginPanels,pluginPanelTab } from "../pluginPanelTabs";
import { loadEnabledClientHalves } from "../pluginRuntime/builtinPlugins.ts";
import { clientHost } from "../pluginRuntime/clientHostSingleton.ts";
import type { PluginPanelRequest } from "../PluginSlotView";
import { onPluginPanelRequest } from "../PluginSlotView";
import type { SessionRecord } from "../types";
import { useLayoutStore } from "./layoutStore";
import { usePanelStore } from "./panelStore";
import { pluginPanelPreferences } from "./pluginPreferences";
import { useSessionStore } from "./sessionStore";
import { useViewStore } from "./viewStore";
export function usePluginSessionRuntime({ activeSession }: { activeSession: SessionRecord | undefined }) {
  const { sessions, workspacePath, activeId } = useSessionStore();
  const { setPluginPanelChoices } = usePanelStore();
  const { setToolPanelTabs, setBotTeamProvider, setBotTeamAvailable, setBotTeamPageOpen, setPluginConversationViews, setConversationView, setRightPanelOpen, setActiveToolPanelTabId, setToolPanelMenuOpen } = useLayoutStore();
  const { ready } = useViewStore();


  // 内置插件（随应用分发、默认启用）的客户端半边开机自动加载——内置就该开机即用，
  // 不需要用户去插件页点"加载界面半边"。失败只记录，不影响启动。
  useEffect(() => {
    let cancelled = false;
    void loadEnabledClientHalves().then((results) => {
      if (cancelled) return;
      const failed = results.filter((result) => !result.ok);
      if (failed.length) console.warn("[plugin] 内置插件客户端半边加载失败：", failed);
    });
    return () => { cancelled = true; };
  }, []);

  // 客户端宿主取会话的数据来源：插件用 ctx.sessions.binding(id) 拿它渲染轨迹等视图
  useEffect(() => {
    clientHost().dshSettings.setSession(activeSession?.runtime === 'dsh' ? activeSession.id : '');
    clientHost().setSessionProvider((sessionId) =>
      sessions.find(session => String(session.id) === String(sessionId)));
    clientHost().setCollections(() => ({ items: sessions, current: activeSession }), () => ({
      items: [...new Set(sessions.map(session => session.workspacePath).filter(Boolean))].map(path => ({ id: path, path,
        title: String(path).split(/[\\/]/).filter(Boolean).at(-1) || String(path),
        sessionIds: sessions.filter(session => session.workspacePath === path).map(session => session.id) })),
      current: workspacePath ? { id: workspacePath, path: workspacePath } : null,
      archivedSessionIds: sessions.filter(session => session.archived).map(session => session.id),
    }));
  }, [activeSession, sessions, workspacePath]);

  useEffect(() => {
    const host=clientHost();
    void host.selectMainSession(activeSession?.runtime==='dsh'?activeSession.id:'').catch(error=>{
      console.warn('[plugin] 当前任务界面读取失败：',error);
    });
    return ()=>{void host.selectMainSession('').catch(()=>{});};
  }, [activeSession?.id, activeSession?.runtime]);

  // 异步登记只同步可用页面；关闭选择独立保存，不能被宿主刷新覆盖。
  useEffect(() => {
    const host = clientHost();
    const sync = () => {
      const contributions = host.contributionsFor("sidebar.right.pane.tab").filter(contribution =>
        activeSession?.runtime !== 'dsh' || contribution.pluginId !== 'dyworker-context');
      const available = availablePluginPanels(contributions);
      setPluginPanelChoices(available);
      setToolPanelTabs(current => pluginPanelPreferences.reconcile(current, available));
    };
    sync();
    return host.subscribe(sync);
  }, [ready, activeId, activeSession?.runtime, pluginPanelPreferences]);

  useEffect(() => {
    const host = clientHost();
    const sync = () => {
      const pages = host.contributionsFor("workspace.page");
      const qwenpaw = pages.some(item => item.pluginId === "qwenpaw" && item.meta.key === "qwenpaw");
      const available = qwenpaw || pages.some(item => item.pluginId === "ds-bot" && item.meta.key === "bot-team");
      setBotTeamProvider(qwenpaw ? "qwenpaw" : "ds-bot");
      setBotTeamAvailable(available);
      if (!available) setBotTeamPageOpen(false);
    };
    sync();
    return host.subscribe(sync);
  }, []);

  // 插件贡献的会话区视图：注册进 conversation.view 插槽的，每个成为会话区的一个标签页
  useEffect(() => {
    const host = clientHost();
    const sync = () => {
      setPluginConversationViews(host.contributionsFor("conversation.view").filter(contribution =>
        activeSession?.runtime !== 'dsh' || contribution.pluginId !== 'dyworker-context').map((contribution) => ({
        key: String(contribution.meta.key ?? contribution.meta.id ?? ""),
        label: typeof contribution.meta.label === "function"
          ? String((contribution.meta.label as () => unknown)())
          : String(contribution.meta.label ?? contribution.meta.id ?? "插件视图"),
      })).filter((view) => view.key));
    };
    sync();
    return host.subscribe(sync);
  }, [activeSession?.runtime]);

  // 切会话（含新建任务）时回到对话标签，避免停在上一个会话的插件视图上
  useEffect(() => { setConversationView("chat"); }, [activeId]);


  const openPluginPanel = useCallback((request: PluginPanelRequest) => {
    const panel = pluginPanelTab(request.pluginId, request.key, request.label);
    if (!pluginPanelPreferences.open(panel, request.open !== false)) return;
    if (request.open !== false) setRightPanelOpen(true);
    setToolPanelTabs(current => [...current.filter(tab => tab.kind !== "plugin"
      || tab.pluginKey !== panel.pluginKey || (tab.pluginId || "") !== panel.pluginId), panel]);
    if (request.open !== false) {
      setActiveToolPanelTabId(panel.id);
      setToolPanelMenuOpen(false);
    }
  }, [pluginPanelPreferences]);

  useEffect(() => onPluginPanelRequest(openPluginPanel), [openPluginPanel]);

  return { openPluginPanel };

}
