// 外观设置面板：主题 / 背景 / 液态玻璃 / 字体字号 + 底部操作条。
// 所有改动只写 controller 的草稿并实时预览；「保存外观」才持久化，「取消」恢复已保存值。
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ImagePlus, RefreshCw, Trash2, UserRound, Globe } from "lucide-react";
import type { AppearanceImageFit, AppearanceSettings, AppearanceTheme } from "../types";
import { t, useLocale, SUPPORTED_LOCALES, type SupportedLocale } from "../i18n";
import {
  discardSession,
  importImage,
  removeImage,
  resetDraft,
  saveDraft,
  updateDraft,
  useAppearanceStore,
  useResolvedTheme,
} from "./controller";
import { fontStackFor, normalizeHex } from "./tokens";

const THEME_OPTIONS: Array<{ id: AppearanceTheme; label: string }> = [
  { id: "system", label: "跟随系统" },
  { id: "light", label: "浅色" },
  { id: "dark", label: "深色" },
];

const UI_SIZE_OPTIONS = [
  { value: 13 as const, label: "小" },
  { value: 14 as const, label: "标准" },
  { value: 16 as const, label: "大" },
  { value: 18 as const, label: "特大" },
];

const FIT_OPTIONS: Array<{ id: AppearanceImageFit; label: string }> = [
  { id: "cover", label: "铺满" },
  { id: "contain", label: "完整显示" },
  { id: "tile", label: "平铺" },
];

const SWATCHES = [
  "#f7f7f4", "#f5efe0", "#e8f0e4", "#e3ecf5", "#f0e6ef",
  "#2a2b27", "#1e2a30", "#2b2130", "#3a2a22", "#22301f",
];

interface FontChoice {
  id: string;
  label: string;
  family: string;
}

const FAMILY_OPTIONS: FontChoice[] = [
  { id: "system", label: "跟随系统", family: "system" },
  { id: "sans-serif", label: "无衬线", family: "sans-serif" },
  { id: "serif", label: "衬线", family: "serif" },
];

// 预设只改外观草稿，不立即保存，也不触及其他设置
function applyPreset(id: "default" | "fresh" | "reading", current: AppearanceSettings): AppearanceSettings {
  if (id === "default") {
    // 默认 = 全部默认值（即当前观感），不擅自打开玻璃或背景图片
    return {
      ...current,
      background: { lightColor: null, darkColor: null, transparency: 0, imageId: null, imageFit: "cover", overlay: 20 },
      glass: { enabled: false, strength: "standard", lightweight: false, systemBackdrop: false },
    };
  }
  if (id === "fresh") {
    // 清透：应用内玻璃 standard + 少量面板透明度
    return {
      ...current,
      background: { ...current.background, transparency: 15 },
      glass: { ...current.glass, enabled: true, strength: "standard" },
    };
  }
  // 阅读：衬线字体 + 较大正文
  return {
    ...current,
    typography: { ...current.typography, family: "serif", contentSize: 20 },
  };
}

// 本机字体枚举：先试验 queryLocalFonts 是否存在且可用（权限拒绝/不存在都静默降级）
interface LocalFontLike {
  family: string;
}
declare global {
  interface Window {
    queryLocalFonts?: () => Promise<LocalFontLike[]>;
  }
}

export function AppearanceSettingsPanel() {
  const store = useAppearanceStore();
  const draft = store.draft ?? store.saved;
  const platform = store.capabilities?.platform || "";

  return (
    <div className="appearance-panel">
      <div className="appearance-fields">
      <LanguageSection />
      {["darwin", "win32", "linux"].includes(platform) && <AppIconSection draft={draft} platform={platform} />}
      <ThemeSection draft={draft} />
      <AccountAvatarSection draft={draft} />
      <BackgroundSection draft={draft} imageUrl={store.imageUrl} imageError={store.imageError} previewOnly={store.previewOnly} />
      <GlassSection draft={draft} capabilities={store.capabilities} effective={store.effective} />
      <TypographySection draft={draft} />
      </div>
      <ActionsBar store={store} />
    </div>
  );
}

// ---- 语言 ----

function LanguageSection() {
  const [locale, setLocale] = useLocale();
  const [notice, setNotice] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  const handleLocaleChange = (next: SupportedLocale) => {
    setLocale(next);
    // 切换后立即以目标语言给出即时反馈提示
    window.setTimeout(() => {
      setNotice(t("common.languageSwitched", "界面语言已更新"));
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setNotice(null), 2500);
    }, 20);
  };

  return (
    <>
      <div className="dialog-section-title">{t("common.language", "界面语言")}</div>
      <div className="appearance-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <p className="dialog-note" style={{ margin: 0 }}>
          {t("common.languageDesc", "切换软件整体界面的显示语言。")}
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {notice && <span className="appearance-status ok" role="status" style={{ fontSize: 12 }}>{notice}</span>}
          <select
            value={locale}
            aria-label={t("common.language", "界面语言")}
            style={{
              minWidth: 160,
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid var(--border, rgba(0, 0, 0, 0.15))",
              background: "var(--card-bg, #ffffff)",
              color: "var(--fg, #000000)",
              fontSize: 13,
              cursor: "pointer",
            }}
            onChange={(e) => handleLocaleChange(e.target.value as SupportedLocale)}
          >
            {SUPPORTED_LOCALES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.nativeLabel}
              </option>
            ))}
          </select>
        </div>
      </div>
    </>
  );
}

// ---- 主题 ----

const APP_ICONS = [
  { id: "dark", label: "深色", dock: new URL("../../build/dock-dark.png", import.meta.url).href, window: new URL("../../build/icon-dark.png", import.meta.url).href },
  { id: "light", label: "浅色", dock: new URL("../../build/dock-light.png", import.meta.url).href, window: new URL("../../build/icon-light.png", import.meta.url).href },
] as const;

function AppIconSection({ draft, platform }: { draft: AppearanceSettings; platform: string }) {
  const isMac = platform === "darwin";
  const title = isMac ? t("appearance.dock.titleMac", "Dock 图标") : t("appearance.dock.title", "应用图标");
  const help = isMac
    ? t("appearance.dock.descMac", "自定桌面图标样式。")
    : t("appearance.dock.descWin", "选择应用窗口使用的图标；启动器和固定快捷方式的图标由安装包提供");
  return (
    <div className="appearance-dock-row">
      <div className="appearance-dock-copy">
        <strong id="dock-icon-title">{title}</strong>
        <p id="dock-icon-help">{help}</p>
      </div>
      <div className="appearance-dock-choices" role="radiogroup" aria-labelledby="dock-icon-title" aria-describedby="dock-icon-help">
        {APP_ICONS.map((icon, index) => (
          <button key={icon.id} type="button" role="radio" aria-label={`${icon.label} ${title}`} title={`${icon.label} ${title}`}
            aria-checked={draft.dockIcon === icon.id} tabIndex={draft.dockIcon === icon.id ? 0 : -1}
            className={`appearance-dock-choice ${draft.dockIcon === icon.id ? "active" : ""}`}
            onClick={() => updateDraft(current => ({ ...current, dockIcon: icon.id }))}
            onKeyDown={event => {
              if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
              event.preventDefault();
              const next = (index + 1) % APP_ICONS.length;
              updateDraft(current => ({ ...current, dockIcon: APP_ICONS[next].id }));
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
            }}>
            <img src={isMac ? icon.dock : icon.window} width={44} height={44} alt="" aria-hidden="true" draggable={false} />
          </button>
        ))}
      </div>
    </div>
  );
}

function ThemeSection({ draft }: { draft: AppearanceSettings }) {
  const themeOptions = [
    { id: "system" as const, label: t("appearance.theme.system", "跟随系统") },
    { id: "light" as const, label: t("appearance.theme.light", "浅色") },
    { id: "dark" as const, label: t("appearance.theme.dark", "深色") },
  ];
  const presets = [
    ["default" as const, t("appearance.theme.default", "默认")],
    ["fresh" as const, t("appearance.theme.fresh", "清透")],
    ["reading" as const, t("appearance.theme.reading", "阅读")],
  ] as const;

  return (
    <>
      <div className="dialog-section-title">{t("appearance.theme.title", "主题")}</div>
      <div className="appearance-row">
        <div className="appearance-segmented" role="radiogroup" aria-label={t("appearance.theme.title", "主题")}>
          {themeOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={draft.theme === option.id}
              className={draft.theme === option.id ? "active" : ""}
              onClick={() => updateDraft((current) => ({ ...current, theme: option.id }))}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        {presets.map(([id, label]) => (
          <button key={id} type="button" className="appearance-preset" onClick={() => updateDraft((current) => applyPreset(id, current))}>
            {label}
          </button>
        ))}
      </div>
      <p className="dialog-note">{t("appearance.theme.note", "预设只调整外观草稿，浅色深色分别记忆背景。")}</p>
    </>
  );
}

// ---- 账户图标 ----

const ACCOUNT_COLORS = [
  { color: "#ef9b24", label: "橙色" },
  { color: "#3975d5", label: "蓝色" },
  { color: "#36866a", label: "绿色" },
  { color: "#8863c7", label: "紫色" },
  { color: "#c45363", label: "红色" },
];

function AccountAvatarSection({ draft }: { draft: AppearanceSettings }) {
  const value = draft.accountAvatarColor;
  const [hexText, setHexText] = useState(value);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setHexText(value);
    setInvalid(false);
  }, [value]);

  const applyColor = (raw: string) => {
    const color = normalizeHex(raw);
    if (!color) {
      setInvalid(true);
      return;
    }
    setHexText(color);
    setInvalid(false);
    updateDraft(current => ({ ...current, accountAvatarColor: color }));
  };

  return (
    <>
      <div className="dialog-section-title">{t("appearance.avatar.title", "账户图标")}</div>
      <div className="appearance-row appearance-color-row">
        <span className="appearance-color-label" id="account-avatar-color-label">{t("appearance.avatar.desc", "登录后图标背景色")}</span>
        <span className="avatar" data-auth-status="logged-in" aria-hidden="true"><UserRound size={16} /></span>
        <div className="appearance-swatches" role="group" aria-labelledby="account-avatar-color-label">
          {ACCOUNT_COLORS.map(({ color, label }) => (
            <button key={color} type="button"
              className={`appearance-swatch ${value === color ? "active" : ""}`}
              style={{ "--swatch-color": color } as CSSProperties}
              aria-label={`账户图标${label}`} aria-pressed={value === color} title={label}
              onClick={() => applyColor(color)} />
          ))}
        </div>
        <label className="appearance-swatch appearance-swatch-picker" title="自定义账户图标颜色">
          <input type="color" aria-label="自定义账户图标颜色" value={value}
            onChange={event => applyColor(event.target.value)} />
        </label>
        <input className={`appearance-hex-input ${invalid ? "invalid" : ""}`}
          aria-label="账户图标颜色值" aria-invalid={invalid} placeholder="#rrggbb"
          value={hexText} spellCheck={false}
          onChange={event => setHexText(event.target.value)}
          onBlur={event => applyColor(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter") applyColor(event.currentTarget.value);
          }} />
        {invalid && <span className="appearance-status error" role="alert">颜色格式不正确（#rgb / #rrggbb）</span>}
      </div>
      <p className="dialog-note">{t("appearance.avatar.note", "预先设置登录后个人头像的默认背景色。")}</p>
    </>
  );
}

// ---- 背景 ----

function ColorRow({ draft, resolved }: { draft: AppearanceSettings; resolved: "light" | "dark" }) {
  const field = resolved === "light" ? "lightColor" : "darkColor";
  const value = draft.background[field];
  const [hexText, setHexText] = useState(value ?? "");
  const [invalid, setInvalid] = useState(false);
  // 外部变化（预设/恢复默认/取消后重进）同步回显
  useEffect(() => {
    setHexText(value ?? "");
    setInvalid(false);
  }, [value, field]);

  const submitHex = (raw: string) => {
    const text = raw.trim();
    if (!text) {
      updateDraft((current) => ({ ...current, background: { ...current.background, [field]: null } }));
      setInvalid(false);
      return;
    }
    const normalized = normalizeHex(text);
    if (!normalized) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setHexText(normalized);
    updateDraft((current) => ({ ...current, background: { ...current.background, [field]: normalized } }));
  };

  const label = resolved === "light" ? t("appearance.background.lightColor", "浅色背景色") : t("appearance.background.darkColor", "深色背景色");

  return (
    <div className="appearance-row appearance-color-row">
      <span className="appearance-color-label">{label}</span>
      <div className="appearance-swatches">
        <button
          type="button"
          className={`appearance-swatch clear ${!value ? "active" : ""}`}
          title={t("appearance.background.none", "无")}
          onClick={() => updateDraft((current) => ({ ...current, background: { ...current.background, [field]: null } }))}
        >
          {t("appearance.background.none", "无")}
        </button>
        {SWATCHES.map((color) => (
          <button
            key={color}
            type="button"
            className={`appearance-swatch ${value?.toLowerCase() === color ? "active" : ""}`}
            style={{ "--swatch-color": color } as CSSProperties}
            title={color}
            onClick={() => updateDraft((current) => ({ ...current, background: { ...current.background, [field]: color } }))}
          />
        ))}
      </div>
      <label className="appearance-swatch appearance-swatch-picker" title="自定义颜色">
        <input
          type="color"
          aria-label="取色器"
          value={normalizeHex(value) ?? (resolved === "dark" ? "#181916" : "#f7f7f4")}
          onChange={(event) => {
            setHexText(event.target.value);
            setInvalid(false);
            updateDraft((current) => ({ ...current, background: { ...current.background, [field]: event.target.value } }));
          }}
        />
      </label>
      <input
        className={`appearance-hex-input ${invalid ? "invalid" : ""}`}
        placeholder="#rrggbb"
        value={hexText}
        spellCheck={false}
        onChange={(event) => setHexText(event.target.value)}
        onBlur={(event) => submitHex(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") submitHex((event.target as HTMLInputElement).value);
        }}
      />
      <small className="appearance-color-hint">{t("appearance.background.defaultHint", "留空用默认底色")}</small>
      {invalid && <span className="appearance-status error">颜色格式不正确（#rgb / #rrggbb）</span>}
    </div>
  );
}

function BackgroundSection({ draft, imageUrl, imageError, previewOnly }: {
  draft: AppearanceSettings;
  imageUrl: string | null;
  imageError: string | null;
  previewOnly: boolean;
}) {
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const resolved = useResolvedTheme();
  const transparency = draft.background.transparency;
  const overlay = draft.background.overlay;

  const fitOptions = [
    { id: "cover" as const, label: t("appearance.background.fitCover", "铺满") },
    { id: "contain" as const, label: t("appearance.background.fitContain", "完整显示") },
    { id: "tile" as const, label: t("appearance.background.fitTile", "平铺") },
  ];

  const pickImage = async () => {
    if (importing) return;
    setImporting(true);
    setImportError(null);
    try {
      const result = await importImage();
      if (result.ok === false && !result.canceled && result.error) setImportError(result.error);
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <div className="dialog-section-title">{t("appearance.background.title", "背景")}</div>
      <ColorRow draft={draft} resolved="light" />
      <ColorRow draft={draft} resolved="dark" />
      <div className="appearance-row appearance-control-row">
        <span className="appearance-row-label">
          {t("appearance.background.transparency", "背景透明度")}
          <small>{t("appearance.background.transparencyDesc", "调整背景透明度，文字与内容保持清晰。")}</small>
        </span>
        <div className="appearance-slider-row">
          <input
            type="range"
            min={0}
            max={70}
            step={1}
            value={transparency}
            aria-label={t("appearance.background.transparency", "背景透明度")}
            onChange={(event) => updateDraft((current) => ({
              ...current,
              background: { ...current.background, transparency: Number(event.target.value) },
            }))}
          />
          <span className="appearance-slider-value">{transparency}%</span>
        </div>
      </div>
      <div className="appearance-row">
        <span className="appearance-row-label">{t("appearance.background.image", "背景图片")}</span>
        <div className="appearance-image-box">
          {draft.background.imageId && imageUrl ? (
            <span className="appearance-image-thumb" style={{ backgroundImage: `url("${imageUrl}")` }} />
          ) : (
            <span className="appearance-image-thumb empty">{draft.background.imageId ? (imageError ? "读取失败" : "读取中…") : t("appearance.background.notSet", "未设置")}</span>
          )}
          <button type="button" className="button-secondary" onClick={() => void pickImage()} disabled={importing || previewOnly}>
            <ImagePlus size={14} />
            {draft.background.imageId ? t("appearance.background.changeImage", "更换图片") : t("appearance.background.pickImage", "选择图片")}
          </button>
          {draft.background.imageId && (
            <button type="button" className="button-secondary" onClick={removeImage}>
              <Trash2 size={14} />
              {t("appearance.background.removeImage", "移除")}
            </button>
          )}
        </div>
        {(importError || imageError) && <span className="appearance-status error">{importError || imageError}</span>}
        <p className="dialog-note" style={{ flexBasis: "100%", margin: 0 }}>
          {t("appearance.background.note", "支持静态图片，保存后由应用托管，移动文件不影响。")}
        </p>
      </div>
      {draft.background.imageId && (
        <div className="appearance-row">
          <span className="appearance-row-label">{t("appearance.background.imageFit", "图片显示")}</span>
          <div className="appearance-segmented">
            {fitOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                className={draft.background.imageFit === option.id ? "active" : ""}
                onClick={() => updateDraft((current) => ({
                  ...current,
                  background: { ...current.background, imageFit: option.id },
                }))}
              >
                {option.label}
              </button>
            ))}
          </div>
          <span className="appearance-row-label" style={{ flexBasis: "auto" }}>
            {t("appearance.background.imageOverlay", "图片遮罩")}
            <small>{t("appearance.background.overlayDesc", "降低背景图片对比度，提升文字可读性。")}</small>
          </span>
          <div className="appearance-slider-row" style={{ flex: 1, minWidth: 180 }}>
            <input
              type="range"
              min={0}
              max={80}
              step={1}
              value={overlay}
              aria-label={t("appearance.background.imageOverlay", "图片遮罩")}
              onChange={(event) => updateDraft((current) => ({
                ...current,
                background: { ...current.background, overlay: Number(event.target.value) },
              }))}
            />
            <span className="appearance-slider-value">{overlay}%</span>
          </div>
        </div>
      )}
      <p className="dialog-note">
        {resolved === "dark"
          ? t("appearance.background.editNoteDark", "当前正在编辑深色主题背景，切换主题自动跟随。")
          : t("appearance.background.editNoteLight", "当前正在编辑浅色主题背景，切换主题自动跟随。")}
      </p>
    </>
  );
}

// ---- 液态玻璃 ----

function GlassSection({ draft, capabilities, effective }: {
  draft: AppearanceSettings;
  capabilities: ReturnType<typeof useAppearanceStore>["capabilities"];
  effective: ReturnType<typeof useAppearanceStore>["effective"];
}) {
  const glass = draft.glass;
  const backdropAvailable = Boolean(capabilities?.systemBackdrop.available);
  const backdropReason = capabilities?.systemBackdrop.reason;
  const strengthOptions = [
    { id: "subtle" as const, label: t("appearance.glass.subtle", "轻柔") },
    { id: "standard" as const, label: t("appearance.glass.standard", "标准") },
    { id: "strong" as const, label: t("appearance.glass.strong", "明显") },
  ];

  return (
    <>
      <div className="dialog-section-title">{t("appearance.glass.title", "液态玻璃")}</div>
      <div className="mcp-server-row">
        <label className="skill-switch" title={glass.enabled ? "点击关闭" : "点击开启"}>
          <input
            type="checkbox"
            checked={glass.enabled}
            onChange={(event) => updateDraft((current) => ({
              ...current,
              glass: { ...current.glass, enabled: event.target.checked },
            }))}
          />
        </label>
        <span className="mcp-server-name">
          <strong>{glass.enabled ? t("appearance.glass.enabled", "玻璃效果开启") : t("appearance.glass.enable", "启用玻璃效果")}</strong>
          <small>{t("appearance.glass.desc", "侧栏、顶栏与工具栏半透明毛玻璃质感。")}</small>
        </span>
      </div>
      {glass.enabled && (
        <>
          <div className="appearance-row">
            <span className="appearance-row-label">{t("appearance.glass.strength", "强度")}</span>
            <div className="appearance-segmented">
              {strengthOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={glass.strength === option.id ? "active" : ""}
                  onClick={() => updateDraft((current) => ({
                    ...current,
                    glass: { ...current.glass, strength: option.id },
                  }))}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="mcp-server-row">
            <label className="skill-switch" title={t("appearance.glass.lightweightTitle", "省电模式")}>
              <input
                type="checkbox"
                checked={glass.lightweight}
                onChange={(event) => updateDraft((current) => ({
                  ...current,
                  glass: { ...current.glass, lightweight: event.target.checked },
                }))}
              />
            </label>
            <span className="mcp-server-name">
              <strong>{t("appearance.glass.lightweightTitle", "省电模式")}</strong>
              <small>{t("appearance.glass.lightweightDesc", "降低视觉动效，提升老旧设备流畅度。")}</small>
            </span>
          </div>
          <div className="mcp-server-row">
            <label className="skill-switch" title={backdropAvailable ? t("appearance.glass.systemBackdropTitle", "系统磨砂") : backdropReason || t("appearance.glass.unavailable", "当前系统不可用")}>
              <input
                type="checkbox"
                checked={glass.systemBackdrop}
                disabled={!backdropAvailable}
                onChange={(event) => updateDraft((current) => ({
                  ...current,
                  glass: { ...current.glass, systemBackdrop: event.target.checked },
                }))}
              />
            </label>
            <span className="mcp-server-name">
              <strong>{t("appearance.glass.systemBackdropTitle", "系统磨砂")}</strong>
              <small>{t("appearance.glass.systemBackdropDesc", "采用系统原生半透明材质，效果更贴合。")}</small>
            </span>
          </div>
        </>
      )}
    </>
  );
}

// ---- 字体与字号 ----

function TypographySection({ draft }: { draft: AppearanceSettings }) {
  const typo = draft.typography;
  const isCustom = !FAMILY_OPTIONS.some((option) => option.family === typo.family);
  const [pickerState, setPickerState] = useState<"idle" | "loading" | "unavailable" | "ready">("idle");
  const [fontList, setFontList] = useState<string[]>([]);
  const [fontQuery, setFontQuery] = useState("");
  const familyStack = fontStackFor(typo.family) || "system-ui";

  const familyOptions = [
    { id: "system", label: t("appearance.typo.fontSystem", "跟随系统"), family: "system" },
    { id: "sans-serif", label: t("appearance.typo.fontSans", "无衬线"), family: "sans-serif" },
    { id: "serif", label: t("appearance.typo.fontSerif", "衬线"), family: "serif" },
  ];

  const uiSizeOptions = [
    { value: 13 as const, label: t("appearance.typo.sizeSmall", "小") },
    { value: 14 as const, label: t("appearance.typo.sizeRegular", "标准") },
    { value: 16 as const, label: t("appearance.typo.sizeLarge", "大") },
    { value: 18 as const, label: t("appearance.typo.sizeHuge", "特大") },
  ];

  const filteredFonts = useMemo(() => {
    const query = fontQuery.trim().toLowerCase();
    if (!query) return fontList;
    return fontList.filter((family) => family.toLowerCase().includes(query));
  }, [fontList, fontQuery]);

  const enumerateLocalFonts = async () => {
    setPickerState("loading");
    try {
      if (typeof window.queryLocalFonts !== "function") throw new Error("unavailable");
      const fonts = await window.queryLocalFonts();
      // 按家族去重
      const families = [...new Set(fonts.map((font) => font.family).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      setFontList(families);
      setPickerState("ready");
    } catch {
      // 权限拒绝 / API 不存在：降级为手动输入字体名称
      setPickerState("unavailable");
    }
  };

  const applyFamily = (family: string) => {
    updateDraft((current) => ({ ...current, typography: { ...current.typography, family } }));
  };

  return (
    <>
      <div className="dialog-section-title">{t("appearance.typo.title", "字体与字号")}</div>
      <div className="appearance-row">
        <span className="appearance-row-label">{t("appearance.typo.fontFamily", "显示字体")}</span>
        <div className="appearance-segmented">
          {familyOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className={typo.family === option.family ? "active" : ""}
              onClick={() => applyFamily(option.family)}
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            className={isCustom || pickerState !== "idle" ? "active" : ""}
            onClick={() => void enumerateLocalFonts()}
          >
            {t("appearance.typo.fontLocal", "本机字体…")}
          </button>
        </div>
      </div>
      {(isCustom || pickerState !== "idle") && (
        <div className="appearance-row">
          {pickerState === "ready" ? (
            <>
              <input
                className="appearance-hex-input"
                style={{ width: 160, fontFamily: "inherit" }}
                placeholder={t("appearance.typo.searchPlaceholder", "搜索字体…")}
                value={fontQuery}
                onChange={(event) => setFontQuery(event.target.value)}
              />
              <div className="appearance-font-list" style={{ flex: 1, minWidth: 200 }}>
                {filteredFonts.slice(0, 80).map((family) => (
                  <button
                    key={family}
                    type="button"
                    className={typo.family === family ? "active" : ""}
                    style={{ fontFamily: `"${family.replace(/["\\]/g, "")}", sans-serif` }}
                    onClick={() => applyFamily(family)}
                  >
                    {family}
                  </button>
                ))}
                {!filteredFonts.length && <button type="button" disabled>没有匹配的字体</button>}
              </div>
              <button type="button" className="icon-button subtle" title="重新枚举本机字体" onClick={() => void enumerateLocalFonts()}>
                <RefreshCw size={13} />
              </button>
            </>
          ) : (
            <>
              <input
                className="appearance-hex-input"
                style={{ flex: 1, minWidth: 160, fontFamily: "inherit" }}
                placeholder={t("appearance.typo.inputPlaceholder", "输入字体名称，如 PingFang SC")}
                value={isCustom ? typo.family : ""}
                spellCheck={false}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value.trim()) applyFamily(value);
                  else applyFamily("system");
                }}
              />
              {pickerState !== "unavailable" && (
                <button type="button" className="button-secondary" onClick={() => void enumerateLocalFonts()} disabled={pickerState === "loading"}>
                  {pickerState === "loading" ? "正在枚举…" : "枚举本机字体"}
                </button>
              )}
              <span className="appearance-status">
                {pickerState === "unavailable"
                  ? "本机字体枚举不可用（权限或环境限制），可直接输入已知字体名称试用"
                  : "字体名称缺失或卸载后自动使用后备字体，不影响使用"}
              </span>
            </>
          )}
        </div>
      )}
      <div className="appearance-row">
        <span className="appearance-row-label">
          {t("appearance.typo.uiSize", "界面字号")}
          <small>{t("appearance.typo.uiSizeDesc", "作用于导航、按钮、输入框与设置项。")}</small>
        </span>
        <div className="appearance-segmented">
          {uiSizeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={typo.uiSize === option.value ? "active" : ""}
              onClick={() => updateDraft((current) => ({
                ...current,
                typography: { ...current.typography, uiSize: option.value },
              }))}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="appearance-row appearance-control-row">
        <span className="appearance-row-label">
          {t("appearance.typo.contentSize", "正文字号")}
          <small>{t("appearance.typo.contentSizeDesc", "调整对话文本与正文阅读区域的字体大小。")}</small>
        </span>
        <div className="appearance-slider-row">
          <input
            type="range"
            min={14}
            max={24}
            step={1}
            value={typo.contentSize}
            aria-label={t("appearance.typo.contentSize", "正文字号")}
            onChange={(event) => updateDraft((current) => ({
              ...current,
              typography: { ...current.typography, contentSize: Number(event.target.value) },
            }))}
          />
          <span className="appearance-slider-value">{typo.contentSize}px</span>
        </div>
      </div>
      <div className="appearance-sample" style={{ fontFamily: familyStack }}>
        <span className="appearance-sample-content">
          {t("appearance.sample.text", "敏捷的棕色狐狸跳过了懒狗 The quick brown fox jumps over the lazy dog。")}
        </span>
        <br />
        <span className="appearance-sample-content" style={{ color: "var(--muted)" }}>
          {t("appearance.sample.note", "样例跟随当前草稿的字体与正文字号。")}
        </span>
      </div>
    </>
  );
}

// ---- 底部操作条 ----

function ActionsBar({ store }: { store: ReturnType<typeof useAppearanceStore> }) {
  const [locale] = useLocale();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const timerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  const flash = (next: { kind: "ok" | "error"; text: string }) => {
    setStatus(next);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setStatus(null), 2600);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setStatus(null);
    try {
      const result = await saveDraft();
      if (result.ok) {
        flash({ kind: "ok", text: t("appearance.actions.saved", "已保存") });
      } else if (result.previewOnly) {
        flash({ kind: "error", text: t("appearance.status.previewOnly", "当前环境仅预览，外观不会保存") });
      } else if (result.stale) {
        flash({ kind: "error", text: "外观已在别处更新，已按最新保存值刷新，请重新调整" });
      } else {
        flash({ kind: "error", text: result.error || "保存失败，请重试" });
      }
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    discardSession();
    setStatus(null);
  };

  return (
    <div className="appearance-actions">
      <div className="appearance-action-status" role="status">
      {store.dirty && <span className="appearance-status">{t("appearance.status.dirty", "预览中，保存后保留")}</span>}
      {store.previewOnly && <span className="appearance-status">{t("appearance.status.previewOnly", "当前环境仅预览，外观不会保存")}</span>}
      {status && (status.kind === "error" || !store.dirty) && <span className={`appearance-status ${status.kind}`}>{status.text}</span>}
      </div>
      <div className="appearance-action-buttons">
      <button type="button" className="button-secondary" onClick={() => { resetDraft(); setStatus(null); }}>
        {t("appearance.actions.reset", "恢复默认")}
      </button>
      <button type="button" className="button-secondary" onClick={cancel}>
        {t("common.cancel", "取消")}
      </button>
      <button type="button" className="button-primary" onClick={() => void save()} disabled={saving || store.previewOnly || !store.dirty}>
        {saving ? t("appearance.actions.saving", "保存中…") : t("appearance.actions.save", "保存外观")}
      </button>
      </div>
    </div>
  );
}
