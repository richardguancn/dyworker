import type { ReactNode } from "react";
export interface Root { render(children: ReactNode): void; unmount(): void }
export interface RootOptions {
  identifierPrefix?: string;
  onUncaughtError?: (error: unknown, info: { componentStack?: string }) => void;
  onCaughtError?: (error: unknown, info: { componentStack?: string; errorBoundary?: unknown }) => void;
  onRecoverableError?: (error: unknown, info: { componentStack?: string }) => void;
}
export function createRoot(container: Element | Document | DocumentFragment, options?: RootOptions): Root;
export function hydrateRoot(container: Element | Document, children: ReactNode, options?: RootOptions): Root;
export const version: string;
declare const ReactDOMClient: { createRoot: typeof createRoot; hydrateRoot: typeof hydrateRoot; version: string };
export default ReactDOMClient;
