// 外观设置面板：主题 / 背景 / 液态玻璃 / 字体字号 + 底部操作条。
// 所有改动只写 controller 的草稿并实时预览；「保存外观」才持久化，「取消」恢复已保存值。
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ImagePlus, RefreshCw, Trash2 } from "lucide-react";
import type { AppearanceImageFit, AppearanceSettings, AppearanceTheme } from "../types";
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

  return (
    <div className="appearance-panel">
      <ThemeSection draft={draft} />
      <BackgroundSection draft={draft} imageUrl={store.imageUrl} imageError={store.imageError} previewOnly={store.previewOnly} />
      <GlassSection draft={draft} capabilities={store.capabilities} effective={store.effective} />
      <TypographySection draft={draft} />
      <ActionsBar store={store} />
    </div>
  );
}

// ---- 主题 ----

function ThemeSection({ draft }: { draft: AppearanceSettings }) {
  return (
    <>
      <div className="dialog-section-title">主题</div>
      <div className="appearance-row">
        <div className="appearance-segmented" role="radiogroup" aria-label="主题">
          {THEME_OPTIONS.map((option) => (
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
        {([["default", "默认"], ["fresh", "清透"], ["reading", "阅读"]] as const).map(([id, label]) => (
          <button key={id} type="button" className="appearance-preset" onClick={() => updateDraft((current) => applyPreset(id, current))}>
            {label}
          </button>
        ))}
      </div>
      <p className="dialog-note">预设只调整外观草稿，不立即保存；浅色和深色分别记忆自定义背景色，互不覆盖。</p>
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

  return (
    <div className="appearance-row appearance-color-row">
      <span className="appearance-color-label">{resolved === "light" ? "浅色背景色" : "深色背景色"}</span>
      <div className="appearance-swatches">
        <button
          type="button"
          className={`appearance-swatch clear ${!value ? "active" : ""}`}
          title="默认底色"
          onClick={() => updateDraft((current) => ({ ...current, background: { ...current.background, [field]: null } }))}
        >
          无
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
      <small className="appearance-color-hint">留空用默认底色</small>
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
      <div className="dialog-section-title">背景</div>
      <ColorRow draft={draft} resolved="light" />
      <ColorRow draft={draft} resolved="dark" />
      <div className="appearance-row">
        <span className="appearance-row-label">
          背景透明度
          <small>只调整背景，文字保持清晰；无图片时透出基础底色</small>
        </span>
        <div className="appearance-slider-row" style={{ flex: 1 }}>
          <input
            type="range"
            min={0}
            max={70}
            step={1}
            value={transparency}
            aria-label="背景透明度"
            onChange={(event) => updateDraft((current) => ({
              ...current,
              background: { ...current.background, transparency: Number(event.target.value) },
            }))}
          />
          <span className="appearance-slider-value">{transparency}%</span>
        </div>
      </div>
      <div className="appearance-row">
        <span className="appearance-row-label">背景图片</span>
        <div className="appearance-image-box">
          {draft.background.imageId && imageUrl ? (
            <span className="appearance-image-thumb" style={{ backgroundImage: `url("${imageUrl}")` }} />
          ) : (
            <span className="appearance-image-thumb empty">{draft.background.imageId ? (imageError ? "读取失败" : "读取中…") : "未设置"}</span>
          )}
          <button type="button" className="button-secondary" onClick={() => void pickImage()} disabled={importing || previewOnly}>
            <ImagePlus size={14} />
            {draft.background.imageId ? "更换图片" : "选择图片"}
          </button>
          {draft.background.imageId && (
            <button type="button" className="button-secondary" onClick={removeImage}>
              <Trash2 size={14} />
              移除
            </button>
          )}
        </div>
        {(importError || imageError) && <span className="appearance-status error">{importError || imageError}</span>}
        <p className="dialog-note" style={{ flexBasis: "100%", margin: 0 }}>
          支持 PNG / JPEG / WebP 静态图片，保存后由应用托管，源文件移动或删除不影响显示；图片本身不透明时会遮住窗口底层的系统背景效果。
        </p>
      </div>
      {draft.background.imageId && (
        <div className="appearance-row">
          <span className="appearance-row-label">图片显示</span>
          <div className="appearance-segmented">
            {FIT_OPTIONS.map((option) => (
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
            图片遮罩
            <small>降低复杂图片对阅读的干扰；浅色用浅遮罩、深色用深遮罩</small>
          </span>
          <div className="appearance-slider-row" style={{ flex: 1, minWidth: 180 }}>
            <input
              type="range"
              min={0}
              max={80}
              step={1}
              value={overlay}
              aria-label="图片遮罩"
              onChange={(event) => updateDraft((current) => ({
                ...current,
                background: { ...current.background, overlay: Number(event.target.value) },
              }))}
            />
            <span className="appearance-slider-value">{overlay}%</span>
          </div>
        </div>
      )}
      <p className="dialog-note">当前正在编辑「{resolved === "dark" ? "深色" : "浅色"}」主题的背景色，切换主题后自动跟随对应颜色。</p>
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
    { id: "subtle" as const, label: "轻柔" },
    { id: "standard" as const, label: "标准" },
    { id: "strong" as const, label: "明显" },
  ];

  return (
    <>
      <div className="dialog-section-title">液态玻璃效果</div>
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
          <strong>{glass.enabled ? "玻璃效果开启" : "启用玻璃效果"}</strong>
          <small>应用内液态玻璃风格，不等同于 Apple 原生 Liquid Glass；作用于侧栏、顶部、输入框外壳和右侧工具栏</small>
        </span>
      </div>
      {glass.enabled && (
        <>
          <div className="appearance-row">
            <span className="appearance-row-label">强度</span>
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
            <label className="skill-switch" title="轻量效果不启用背景模糊，占用更低">
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
              <strong>轻量效果</strong>
              <small>{capabilities?.glassDefault === "lightweight"
                ? "当前平台默认使用轻量效果：静态半透明 + 边缘高光，不做背景模糊"
                : "使用静态半透明 + 边缘高光，不做背景模糊，低性能设备建议开启"}</small>
            </span>
          </div>
          <div className="mcp-server-row">
            <label className="skill-switch" title={backdropAvailable ? "透出系统桌面背景" : backdropReason || "当前系统不可用"}>
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
              <strong>使用系统背景效果（高级）</strong>
              <small>{backdropAvailable
                ? `由系统提供窗口背景材质（${capabilities?.systemBackdrop.kind === "vibrancy" ? "macOS  Vibrancy" : "Windows 背景材质"}），实际效果受系统设置影响${effective?.applied && effective.applied !== "none" ? "，当前已生效" : ""}`
                : (backdropReason || "当前系统使用应用内玻璃效果")}</small>
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
      <div className="dialog-section-title">字体与字号</div>
      <div className="appearance-row">
        <span className="appearance-row-label">显示字体</span>
        <div className="appearance-segmented">
          {FAMILY_OPTIONS.map((option) => (
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
            本机字体…
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
                placeholder="搜索字体…"
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
                placeholder="输入字体名称，如 PingFang SC"
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
        <span className="appearance-row-label">界面字号<small>作用于导航、按钮、输入与设置</small></span>
        <div className="appearance-segmented">
          {UI_SIZE_OPTIONS.map((option) => (
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
      <div className="appearance-row">
        <span className="appearance-row-label">正文字号<small>只放大聊天与 Markdown 阅读内容，代码与日志保持等宽字体</small></span>
        <div className="appearance-slider-row" style={{ flex: 1 }}>
          <input
            type="range"
            min={14}
            max={24}
            step={1}
            value={typo.contentSize}
            aria-label="正文字号"
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
          敏捷的棕色狐狸跳过了懒狗 The quick brown fox jumps over the lazy dog。
        </span>
        <br />
        <span className="appearance-sample-content" style={{ color: "var(--muted)" }}>
          0123456789，。；：？！""''（）【】《》 —— 样例跟随当前草稿的字体与正文字号。
        </span>
      </div>
    </>
  );
}

// ---- 底部操作条 ----

function ActionsBar({ store }: { store: ReturnType<typeof useAppearanceStore> }) {
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
        flash({ kind: "ok", text: "已保存" });
      } else if (result.previewOnly) {
        flash({ kind: "error", text: "当前环境仅预览，外观不会保存" });
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
      {store.dirty && <span className="appearance-status">预览中，保存后保留</span>}
      {store.previewOnly && <span className="appearance-status">当前环境仅预览，外观不会保存</span>}
      {status && <span className={`appearance-status ${status.kind}`}>{status.text}</span>}
      <span className="spacer" />
      <button type="button" className="button-secondary" onClick={() => { resetDraft(); setStatus(null); }}>
        恢复默认
      </button>
      <button type="button" className="button-secondary" onClick={cancel}>
        取消
      </button>
      <button type="button" className="button-primary" onClick={() => void save()} disabled={saving || store.previewOnly || !store.dirty}>
        {saving ? "保存中…" : "保存外观"}
      </button>
    </div>
  );
}
