import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Palette, RotateCcw, Search, Sparkles, User, X } from "lucide-react";
import {
  PLUGIN_COLOR_PRESETS,
  PLUGIN_ICON_PRESETS,
  PluginGlyph,
  normalizeHexColor,
  normalizeIconId,
  pluginTileStyle,
} from "./lib/pluginIcons";
import { saveProviderSettings } from "./state/settingsActions";
import { useSettingsStore } from "./state/settingsStore";
import type { PluginCustomization } from "./types";

export interface PluginAppearanceTarget {
  /** 优先使用的配置保存键（通常为 packageName || entry.name || entry.id） */
  primaryKey: string;
  /** 兼容查找用的备选键列表（如 entry.id、packageName） */
  lookupKeys: string[];
  defaultDisplayName: string;
  defaultAuthor?: string;
  defaultIcon?: string;
  defaultIconColor?: string;
  packageName?: string;
  builtin?: boolean;
}

export function PluginAppearanceDialog({
  target,
  onClose,
  onSaved,
}: {
  target: PluginAppearanceTarget;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const settings = useSettingsStore((s) => s.settings);
  const existingCustom: PluginCustomization | undefined = useMemo(() => {
    const map = settings.pluginCustomizations || {};
    for (const key of [target.primaryKey, ...target.lookupKeys]) {
      const k = String(key || "").trim();
      if (k && map[k]) return map[k];
    }
    return undefined;
  }, [settings.pluginCustomizations, target]);

  const [displayName, setDisplayName] = useState(
    () => String(existingCustom?.displayName || target.defaultDisplayName || ""),
  );
  const [author, setAuthor] = useState(
    () => String(existingCustom?.author ?? target.defaultAuthor ?? ""),
  );
  const [iconId, setIconId] = useState(
    () => normalizeIconId(existingCustom?.icon) || normalizeIconId(target.defaultIcon) || "",
  );
  const [iconColor, setIconColor] = useState(
    () => normalizeHexColor(existingCustom?.iconColor) || normalizeHexColor(target.defaultIconColor) || "",
  );
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameInputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose, saving]);

  const filteredIcons = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PLUGIN_ICON_PRESETS;
    return PLUGIN_ICON_PRESETS.filter((item) =>
      `${item.id} ${item.label} ${item.category} ${item.keywords}`.toLowerCase().includes(q),
    );
  }, [query]);

  const previewName = displayName.trim() || target.defaultDisplayName || target.packageName || target.primaryKey;
  const previewAuthor = author.trim() || target.defaultAuthor || "";

  const persist = async (nextEntry: PluginCustomization | null) => {
    setSaving(true);
    setError("");
    try {
      const nextMap = { ...(settings.pluginCustomizations || {}) };
      for (const k of [target.primaryKey, ...target.lookupKeys]) {
        const cleaned = String(k || "").trim();
        if (cleaned) delete nextMap[cleaned];
      }
      if (nextEntry && (nextEntry.icon || nextEntry.iconColor || nextEntry.displayName || nextEntry.author)) {
        nextMap[target.primaryKey] = nextEntry;
      }

      const saved = await saveProviderSettings(
        { ...settings, pluginCustomizations: nextMap },
        nextEntry ? "插件外观与信息已保存" : "已恢复插件默认外观与信息",
      );
      if (!saved) {
        setError("保存设置失败，请检查模型/设置文件状态后重试");
        setSaving(false);
        return;
      }

      if (!target.builtin && window.dyworker?.updatePluginMetadata) {
        await window.dyworker.updatePluginMetadata({
          target: target.packageName || target.primaryKey,
          displayName: nextEntry ? displayName.trim() : "",
          author: nextEntry ? author.trim() : "",
          icon: nextEntry ? iconId : "",
          iconColor: nextEntry ? iconColor : "",
        }).catch(() => null);
      }

      onSaved?.();
      onClose();
    } catch (err: any) {
      setError(String(err?.message || err || "保存失败"));
      setSaving(false);
    }
  };

  const handleSave = () => {
    const cleanName = displayName.trim();
    const cleanAuthor = author.trim();
    const defName = String(target.defaultDisplayName || "").trim();
    const defAuthor = String(target.defaultAuthor || "").trim();
    const defIcon = normalizeIconId(target.defaultIcon);
    const defColor = normalizeHexColor(target.defaultIconColor);

    const entry: PluginCustomization = {
      ...(iconId && iconId !== defIcon ? { icon: iconId } : {}),
      ...(iconColor && iconColor !== defColor ? { iconColor } : {}),
      ...(cleanName && cleanName !== defName ? { displayName: cleanName } : {}),
      ...(cleanAuthor && cleanAuthor !== defAuthor ? { author: cleanAuthor } : {}),
    };
    // 如果用户改回和本地包源码不同的空值或恢复默认，由 persist 统一写回本地源码 package.json
    void persist(entry);
  };

  const handleReset = () => {
    setDisplayName(target.defaultDisplayName || "");
    setAuthor(target.defaultAuthor || "");
    setIconId(normalizeIconId(target.defaultIcon));
    setIconColor(normalizeHexColor(target.defaultIconColor));
    void persist(null);
  };

  return createPortal(
    <div
      className="dialog-overlay plugin-appearance-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div
        className="plugin-appearance-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="自定义插件外观与信息"
      >
        <div className="plugin-appearance-header">
          <div>
            <h3>自定义插件外观与信息</h3>
            <p>调整展示名称、作者、系统图标与主题配色，保存后全应用即时生效</p>
          </div>
          <button
            type="button"
            className="icon-button subtle"
            onClick={onClose}
            disabled={saving}
            aria-label="关闭窗口"
          >
            <X size={16} />
          </button>
        </div>

        {/* 实时双形态预览：插件卡片 + 左侧栏独立页入口 */}
        <div className="plugin-appearance-preview-row" aria-label="实时预览">
          <div className="plugin-appearance-preview-card">
            <span className="preview-badge">插件卡片预览</span>
            <div className="preview-card-inner">
              <div
                className="plugin-card-icon preview-tile"
                style={pluginTileStyle(iconColor, target.packageName || target.primaryKey)}
              >
                <PluginGlyph iconId={iconId} color={iconColor} size={20} />
              </div>
              <div className="preview-card-meta">
                <strong>{previewName}</strong>
                <span>{previewAuthor ? `作者：${previewAuthor}` : (target.packageName || target.primaryKey)}</span>
              </div>
            </div>
          </div>
          <div className="plugin-appearance-preview-card sidebar-preview">
            <span className="preview-badge">侧栏入口预览</span>
            <div className="preview-sidebar-item">
              <PluginGlyph
                iconId={iconId}
                color={iconColor}
                size={16}
                fallback="workspace-page"
              />
              <span>{previewName}</span>
            </div>
          </div>
        </div>

        <div className="plugin-appearance-fields">
          <label className="plugin-appearance-field">
            <span>插件名称（重命名）</span>
            <input
              ref={nameInputRef}
              type="text"
              maxLength={60}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder={target.defaultDisplayName || target.primaryKey}
            />
          </label>
          <label className="plugin-appearance-field">
            <span><User size={13} /> 作者</span>
            <input
              type="text"
              maxLength={60}
              value={author}
              onChange={(event) => setAuthor(event.target.value)}
              placeholder={target.defaultAuthor || "填写作者名（可选）"}
            />
          </label>
        </div>

        <div className="plugin-appearance-section">
          <div className="plugin-appearance-section-head">
            <span><Palette size={14} /> 图标颜色</span>
            {iconColor && (
              <button
                type="button"
                className="plugins-text-button"
                onClick={() => setIconColor("")}
              >
                恢复默认色
              </button>
            )}
          </div>
          <div className="plugin-color-swatches" role="radiogroup" aria-label="预设图标颜色">
            <button
              type="button"
              className={`plugin-color-swatch default-swatch ${iconColor === "" ? "selected" : ""}`}
              title="默认配色"
              aria-label="默认配色"
              aria-checked={iconColor === ""}
              role="radio"
              onClick={() => setIconColor("")}
            >
              <span>默认</span>
            </button>
            {PLUGIN_COLOR_PRESETS.map((preset) => {
              const selected = iconColor === preset.hex;
              return (
                <button
                  key={preset.hex}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={preset.label}
                  title={`${preset.label} (${preset.hex})`}
                  className={`plugin-color-swatch ${selected ? "selected" : ""}`}
                  style={{ background: preset.hex }}
                  onClick={() => setIconColor(preset.hex)}
                >
                  {selected && <Check size={13} />}
                </button>
              );
            })}
            <label className="plugin-color-custom" title="自定义取色">
              <input
                type="color"
                aria-label="自定义颜色"
                value={iconColor || "#4f46e5"}
                onChange={(event) => setIconColor(event.target.value.toLowerCase())}
              />
              <span>自定义</span>
            </label>
          </div>
        </div>

        <div className="plugin-appearance-section">
          <div className="plugin-appearance-section-head">
            <span><Sparkles size={14} /> 系统内置图标</span>
            <label className="plugin-icon-search">
              <Search size={13} />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索图标（如：表格、图表、日历…）"
              />
            </label>
          </div>
          <div className="plugin-icon-grid" role="radiogroup" aria-label="选择系统图标">
            <button
              type="button"
              role="radio"
              aria-checked={iconId === ""}
              className={`plugin-icon-choice ${iconId === "" ? "selected" : ""}`}
              onClick={() => setIconId("")}
              title="使用默认插件图标"
            >
              <PluginGlyph iconId="" color={iconColor} size={18} />
              <small>默认</small>
            </button>
            {filteredIcons.map((preset) => {
              const selected = iconId === preset.id;
              const IconComp = preset.icon;
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`plugin-icon-choice ${selected ? "selected" : ""}`}
                  onClick={() => setIconId(preset.id)}
                  title={`${preset.label}（${preset.category}）`}
                >
                  <span style={iconColor ? { color: iconColor, display: "inline-flex" } : { display: "inline-flex" }}>
                    <IconComp size={18} />
                  </span>
                  <small>{preset.label}</small>
                </button>
              );
            })}
          </div>
        </div>

        {error && <p className="error-text" role="alert">{error}</p>}

        <div className="plugin-appearance-footer">
          <button
            type="button"
            className="plugins-text-button"
            disabled={saving}
            onClick={handleReset}
          >
            <RotateCcw size={13} /> 全部恢复默认
          </button>
          <div className="plugin-appearance-actions">
            <button type="button" className="button-secondary" disabled={saving} onClick={onClose}>
              取消
            </button>
            <button type="button" className="button-primary" disabled={saving} onClick={handleSave}>
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
