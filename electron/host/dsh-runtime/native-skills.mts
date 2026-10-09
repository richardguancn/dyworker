import { toolDefinitions } from '../../agent.mts';

/** 保留原生模板编号与内容；列表逐步披露，正文只在批准读取后返回。 */
export function dshNativeSkills(input: any[], options: any = {}) {
  let skills = (input || []).filter(skill => skill && skill.enabled !== false);
  const names = new Set(['list_skills', 'load_skill']);
  if (options.append) names.add('save_skill');
  if (options.update) names.add('update_skill');
  return {
    tools: toolDefinitions().filter(tool => names.has(tool.function.name)),
    context: skills.length ? `以下工作模板可在需要时使用。任务与模板相关时，先用 load_skill 读取完整要求；若与用户当前要求冲突，以当前要求为准：\n${skills.slice(0, 20).map(skill =>
      `- 【${skill.name}】（编号 ${skill.id || '无'}）：${String(skill.description || '').slice(0, 120)}`).join('\n')}` : '',
    async execute(name: string, args: any) {
      options.signal?.throwIfAborted();
      if (options.read) skills = (await options.read()).filter((skill: any) => skill && skill.enabled !== false);
      if (name === 'list_skills') return skills.length ? skills.map(skill =>
        `- ${skill.id}｜${skill.name}｜${skill.sourceLabel || '本地'}：${skill.description || ''}`).join('\n') : '（还没有发现可用技能）';
      if (name === 'save_skill' && options.append) {
        const item = { name: String(args.name || '').trim(), description: String(args.description || '').trim(),
          instructions: String(args.instructions || '').trim() };
        if (!item.name || !item.instructions) throw new Error('模板名称和执行要求不能为空');
        const record = await options.append(item);
        if (!record?.id) throw new Error('工作模板未保存');
        options.emit?.({ type: 'skill-saved', item: record, persisted: true });
        return `工作模板「${record.name}」已保存，编号：${record.id}`;
      }
      if (name === 'update_skill' && options.update) {
        const skill = skills.find(item => String(item.id) === String(args.skill_id || ''));
        if (!skill) throw new Error(`没有找到模板：${args.skill_id || ''}`);
        if (skill.readOnly) throw new Error(`文件技能「${skill.name}」由 ${skill.path || '来源目录'} 管理，请直接修改对应的 SKILL.md`);
        const instructions = String(args.instructions || '').trim();
        if (!instructions) throw new Error('改进后的执行要求不能为空');
        const record = await options.update({ id: skill.id, name: skill.name,
          description: String(args.description || '').trim() || skill.description, instructions });
        if (!record) throw new Error('工作模板已移除，未更新');
        options.emit?.({ type: 'skill-updated', item: record, persisted: true });
        return `工作模板「${record.name}」已更新，下次使用将按改进后的要求执行`;
      }
      if (name !== 'load_skill') throw new Error('未知的工作模板工具');
      const skill = skills.find(item => String(item.id) === String(args.skill_id || ''));
      if (!skill) throw new Error(`没有找到模板：${args.skill_id || ''}`);
      return `【${skill.name}】${skill.description || ''}\n执行要求：\n${skill.instructions || ''}`;
    },
    owns: (name: string) => names.has(name),
  };
}
