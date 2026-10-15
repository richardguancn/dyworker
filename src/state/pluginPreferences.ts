// 内置插件右侧面板的关闭偏好：整包一个 localStorage 单例。
//
// 原先在 App.tsx 内用 useState 惰性构造，随面板动作函数搬到模块级 actions 后必须保证
// 「同一实例」——App 与 toolPanelActions 两处读写都要指向同一份数据，因此改成模块级单例。
import { PluginPanelPreferences } from "../pluginPanelTabs";

export const pluginPanelPreferences = new PluginPanelPreferences(localStorage);
