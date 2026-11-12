import { useEffect, useState } from "react";
import type { SupportedLocale } from "./types";
import { SUPPORTED_LOCALES } from "./types";

import zhCN from "./locales/zh-CN.json";
import zhTW from "./locales/zh-TW.json";
import enUS from "./locales/en-US.json";
import jaJP from "./locales/ja-JP.json";
import esES from "./locales/es-ES.json";
import frFR from "./locales/fr-FR.json";
import deDE from "./locales/de-DE.json";
import koKR from "./locales/ko-KR.json";

const dictionaries: Record<SupportedLocale, Record<string, string>> = {
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  "en-US": enUS,
  "ja-JP": jaJP,
  "es-ES": esES,
  "fr-FR": frFR,
  "de-DE": deDE,
  "ko-KR": koKR,
};

const STORAGE_KEY = "dyworker_locale";
const LOCALE_CHANGE_EVENT = "dyworker:locale-change";

function detectInitialLocale(): SupportedLocale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as SupportedLocale | null;
    if (saved && dictionaries[saved]) {
      return saved;
    }
    const navLang = navigator.language || "zh-CN";
    if (navLang.startsWith("zh-TW") || navLang.startsWith("zh-HK") || navLang.startsWith("zh-MO")) return "zh-TW";
    if (navLang.startsWith("zh")) return "zh-CN";
    if (navLang.startsWith("ja")) return "ja-JP";
    if (navLang.startsWith("en")) return "en-US";
    if (navLang.startsWith("es")) return "es-ES";
    if (navLang.startsWith("fr")) return "fr-FR";
    if (navLang.startsWith("de")) return "de-DE";
    if (navLang.startsWith("ko")) return "ko-KR";
  } catch {
    // 降级使用中文
  }
  return "zh-CN";
}

let currentLocale: SupportedLocale = detectInitialLocale();

export function getLocale(): SupportedLocale {
  return currentLocale;
}

export function setLocale(locale: SupportedLocale): void {
  if (!dictionaries[locale]) return;
  currentLocale = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
    window.dispatchEvent(new CustomEvent(LOCALE_CHANGE_EVENT, { detail: locale }));
    const bridge = typeof window !== "undefined" ? (window as any).dyworker : null;
    if (bridge?.saveSettings) {
      void bridge.loadSettings?.().then((settings: any) => {
        if (settings) void bridge.saveSettings({ ...settings, locale });
      });
    }
  } catch {
    // ignore storage error
  }
}

/**
 * 核心国际化翻译函数：
 * - 查找当前字典
 * - 若未命中则回退到传入的 fallbackText（中文新文案），保证无感知降级与 dyworker-gov 的完全兼容
 * - 支持可选插值变量替换：t("key", "默认 {name}", { name: "val" })
 */
export function t(key: string, fallbackText?: string, vars?: Record<string, string | number>): string {
  const dict = dictionaries[currentLocale];
  let text = dict && dict[key] !== undefined ? dict[key] : (fallbackText !== undefined ? fallbackText : key);
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return text;
}

/**
 * React 响应式 Hook
 */
export function useLocale(): [SupportedLocale, (next: SupportedLocale) => void] {
  const [locale, setLocalState] = useState<SupportedLocale>(currentLocale);

  useEffect(() => {
    const handleLocaleChange = (e: Event) => {
      const customEvent = e as CustomEvent<SupportedLocale>;
      setLocalState(customEvent.detail || currentLocale);
    };
    window.addEventListener(LOCALE_CHANGE_EVENT, handleLocaleChange);
    return () => window.removeEventListener(LOCALE_CHANGE_EVENT, handleLocaleChange);
  }, []);

  const changeLocale = (next: SupportedLocale) => {
    setLocale(next);
  };

  return [locale, changeLocale];
}

if (typeof window !== "undefined") {
  (window as any).__dyworker_i18n__ = { t, getLocale, setLocale };
}

export { SUPPORTED_LOCALES };
export type { SupportedLocale, LocaleOption } from "./types";
