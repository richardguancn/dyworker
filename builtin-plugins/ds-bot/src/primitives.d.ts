declare module '@deepseek-ai/dsh-client-ui-primitives' {
  export const MarkdownText: import('react').ComponentType<{ content: string }>;
  export function writeClipboard(text: string): void | Promise<void>;
}
