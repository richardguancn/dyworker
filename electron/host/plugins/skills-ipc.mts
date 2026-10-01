// IPC 域插件：工作模板与技能库（skills:* / skill-libraries:*）。
// 领域能力在 ctx.skills（模板读写/文件技能发现/覆盖表）；技能库检索与安装需要
// 用户配置（skillLibraries），因此同时 inject ctx.settings。
export function skillsIpcPlugin(deps) {
  return {
    name: "ipc:skills",
    inject: ["skills", "settings"],
    apply(ctx) {
      const { trustedHandle, searchSkillLibraries, installSkillFromLibrary } = deps;

      trustedHandle("skills:list", (_event, workspacePath) => ctx.skills.read(String(workspacePath || "")));

      trustedHandle("skills:set-enabled", (_event, payload) => ctx.skills.setEnabled(payload));

      trustedHandle("skills:delete", (_event, id) => ctx.skills.remove(id));

      // 会话「总结为工作模板」：渲染端已提炼好草稿，这里只负责落进 skills.json 并返回创建记录
      trustedHandle("skills:create", async (_event, payload) => {
        const name = String(payload?.name || "").trim();
        if (!name) return { ok: false, error: "模板名称不能为空" };
        const item = await ctx.skills.append({ name, description: payload?.description, instructions: payload?.instructions });
        return { ok: true, item };
      });

      // 手动编辑工作模板：内置与本地模板都存在 skills.json 里，按 id 更新；
      // 文件技能（工作区/用户级 SKILL.md）不在此编辑，提示去改源文件。
      trustedHandle("skills:update", async (_event, payload) => {
        const id = String(payload?.id || "").trim();
        const name = String(payload?.name || "").trim();
        if (!id) return { ok: false, error: "缺少模板 id" };
        if (!name) return { ok: false, error: "模板名称不能为空" };
        const stored = await ctx.skills.readStored();
        if (!stored.some((item) => String(item.id) === id)) {
          return { ok: false, error: "文件技能请直接编辑来源目录中的 SKILL.md" };
        }
        const item = await ctx.skills.update({ id, name, description: payload?.description, instructions: payload?.instructions });
        return item ? { ok: true, item } : { ok: false, error: "找不到这个模板" };
      });

      // 技能库：源配置来自设置，检索/安装是纯网络+落盘能力，由壳层注入
      trustedHandle("skill-libraries:search", async (_event, payload) => {
        try {
          const settings = await ctx.settings.read();
          return { ok: true, ...(await searchSkillLibraries(settings.skillLibraries, payload?.query)) };
        } catch (error: any) {
          return { ok: false, results: [], warnings: [], error: error instanceof Error ? error.message : String(error) };
        }
      });

      trustedHandle("skill-libraries:install", async (_event, payload) => {
        try {
          const settings = await ctx.settings.read();
          const result = await installSkillFromLibrary(settings.skillLibraries, payload?.libraryId, payload?.slug);
          return { ok: true, slug: result.slug, targetDir: result.targetDir };
        } catch (error: any) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      });
    },
  };
}
