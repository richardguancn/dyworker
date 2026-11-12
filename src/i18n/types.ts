export type SupportedLocale =
  | "zh-CN"
  | "zh-TW"
  | "en-US"
  | "ja-JP"
  | "es-ES"
  | "fr-FR"
  | "de-DE"
  | "ko-KR";

export interface LocaleOption {
  id: SupportedLocale;
  label: string;
  nativeLabel: string;
}

export const SUPPORTED_LOCALES: LocaleOption[] = [
  { id: "zh-CN", label: "简体中文", nativeLabel: "简体中文" },
  { id: "zh-TW", label: "繁体中文", nativeLabel: "繁體中文" },
  { id: "en-US", label: "英语", nativeLabel: "English" },
  { id: "ja-JP", label: "日语", nativeLabel: "日本語" },
  { id: "es-ES", label: "西班牙语", nativeLabel: "Español" },
  { id: "fr-FR", label: "法语", nativeLabel: "Français" },
  { id: "de-DE", label: "德语", nativeLabel: "Deutsch" },
  { id: "ko-KR", label: "韩语", nativeLabel: "한국어" },
];
