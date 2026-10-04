// 会话视图运行时：把**我们的会话事件**流折叠成 DSH 插件要的视图数据。
//
// 为什么需要我们自己实现：DSH 的这套"事件 → 节点 → 视图快照"驱动在它自己的客户端会话层里
// （@deepseek-ai/dsh-client-ui-session 等，都是裸 ESM，我们运行时加载不了）。
// 但驱动逻辑本身不大，而且插件的契约是完整的、可读的：
//
//   视图定义（ctx.conversationViews.register）:
//     { target: "trajectory", create: () => new Builder() }
//   事件定义（ctx.conversationEvents.register）:
//     {
//       kind, target,
//       match(event)              → { id, role: "start" | "update" } | null
//       start(context, match)     → state        （role === "start" 时）
//       update(context, match)    → state        （role === "update" 时）
//       publication(match)        → "none" | "immediate"（是否立刻产出节点）
//       buildViewNode(context)    → node | null
//     }
//   装配器（create() 的产物）: { apply({upserts}), replace({nodes}), snapshot() }
//
// 我们按同一份契约驱动：同一个 target 的定义共享一个装配器实例，节点按 key 归并，
// 最后把 snapshot() 交给壳层去喂 props。
//
// 这样做是通用的——任何按 DSH 这套契约写的视图插件都能跑，不只是轨迹插件。

export interface ConversationEventDefinition {
  kind?: string;
  target?: string;
  match?: (event: any) => { id: string; role: string } | null | undefined;
  start?: (context: any, match: any) => any;
  update?: (context: any, match: any) => any;
  publication?: (match: any) => string | undefined;
  buildViewNode?: (context: any) => any;
}

export interface ConversationViewDefinition {
  target?: string;
  create?: () => any;
}

interface TargetRuntime {
  definition: ConversationViewDefinition;
  builder: any;
  contexts: Map<string, any>;
  nodes: Map<string, any>;
}

export class SessionViewRuntime {
  /** target → 事件定义列表（按注册顺序） */
  private readonly eventDefinitions = new Map<string, ConversationEventDefinition[]>();
  /** target → 装配器与节点表 */
  private readonly targets = new Map<string, TargetRuntime>();

  registerEvent(definition: ConversationEventDefinition): () => void {
    const target = String(definition?.target || "");
    if (!target || typeof definition?.match !== "function") return () => undefined;
    const list = this.eventDefinitions.get(target) || [];
    list.push(definition);
    this.eventDefinitions.set(target, list);
    return () => {
      this.eventDefinitions.set(target, (this.eventDefinitions.get(target) || []).filter((item) => item !== definition));
    };
  }

  registerView(definition: ConversationViewDefinition): () => void {
    const target = String(definition?.target || "");
    if (!target || typeof definition?.create !== "function") return () => undefined;
    this.targets.set(target, {
      definition,
      builder: definition.create(),
      contexts: new Map(),
      nodes: new Map(),
    });
    return () => {
      this.targets.delete(target);
    };
  }

  /**
   * 用一批会话事件更新所有视图。
   * events 是按时间正序的 DSH 形状事件：{ type, seq, time, data }。
   */
  ingest(events: any[]): void {
    if (!Array.isArray(events) || !events.length) return;
    for (const [target, runtime] of this.targets) {
      const definitions = this.eventDefinitions.get(target) || [];
      if (!definitions.length || typeof runtime.builder?.apply !== "function") continue;
      let structural = false;
      for (const event of events) {
        for (const definition of definitions) {
          let matched: { id: string; role: string } | null | undefined;
          try {
            matched = definition.match?.(event);
          } catch {
            matched = null; // 单个定义匹配失败不该影响其它定义
          }
          if (!matched?.id) continue;
          const key = String(matched.id);
          // 插件里用的是 match.event.*，所以把事件挂回去
          const match = { ...matched, event };
          const context = runtime.contexts.get(key) || {
            id: matched.id,
            key,
            kind: definition.kind,
            matches: [],
            start: undefined,
            state: undefined,
          };
          try {
            if (matched.role === "start") {
              context.start = match;
              context.matches = [match];
              context.state = definition.start?.(context, match) ?? context.state;
            } else {
              context.matches.push(match);
              context.state = definition.update?.(context, match) ?? context.state;
            }
            const publication = definition.publication?.(match) ?? "immediate";
            if (publication !== "none") {
              const node = definition.buildViewNode?.(context);
              if (node) {
                const previous = runtime.nodes.get(key);
                runtime.nodes.set(key, node);
                if (previous === undefined || previous.anchorSeq !== node.anchorSeq) structural = true;
              }
            }
          } catch {
            // 单个节点装配失败：跳过它，别把整个视图搞崩
          }
          runtime.contexts.set(key, context);
        }
      }
      const upserts = [...runtime.nodes.values()];
      try {
        // 有结构变化时走 replace，避免装配器内部的顺序表过期
        if (structural && typeof runtime.builder.replace === "function") runtime.builder.replace({ nodes: upserts });
        else runtime.builder.apply({ upserts });
      } catch {
        // 装配器自身抛错：保留上一次快照
      }
    }
  }

  /** target → 视图快照（喂给插件视图的 snapshot.views） */
  snapshots(): Map<string, any> {
    const result = new Map<string, any>();
    for (const [target, runtime] of this.targets) {
      try {
        const snapshot = runtime.builder?.snapshot?.();
        if (snapshot) result.set(target, snapshot);
      } catch {
        // 快照取不到：这个视图就没有数据，插件会渲染它自己的空状态
      }
    }
    return result;
  }

  /** 当前有哪些 target（调试用） */
  targetsOf(): string[] {
    return [...this.targets.keys()];
  }
}
