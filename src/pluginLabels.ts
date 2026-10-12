/** 内置插件在页面中的名称和功能说明。 */
export const BUILTIN_PLUGIN_LABELS:Record<string,{name:string;summary:string}>={
 'ds-bot':{name:'机器人团队',summary:'创建机器人，设置角色和模型，通过群聊协作并管理记忆。'},
 'dyworker-terminal':{name:'终端',summary:'在当前工作文件夹中运行命令。'},
 'dyworker-context':{name:'上下文面板',summary:'查看任务的上下文占用、使用趋势和用量汇总。'},
 'dyworker-trajectory':{name:'执行轨迹',summary:'查看任务步骤、工具调用和执行结果。'},
};
