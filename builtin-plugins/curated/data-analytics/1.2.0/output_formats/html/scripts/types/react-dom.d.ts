/** Public React DOM 19 facade. Internal runtime exports are intentionally absent. */
import type { Key, ReactNode, ReactPortal } from "react";
export function createPortal(children: ReactNode, container: Element | DocumentFragment, key?: Key | null): ReactPortal;
export function flushSync<Result>(callback: () => Result): Result;
export function unstable_batchedUpdates<Args extends unknown[], Result>(callback: (...args: Args) => Result, ...args: Args): Result;
export function requestFormReset(form: HTMLFormElement): void;
export type FormStatus = { pending: false; data: null; method: null; action: null }
  | { pending: true; data: FormData; method: string; action: string | ((data: FormData) => void | Promise<void>) };
export function useFormStatus(): FormStatus;
export function useFormState<State>(action: (state: Awaited<State>) => State | Promise<State>, initialState: Awaited<State>,
  permalink?: string): [Awaited<State>, () => void, boolean];
export function useFormState<State, Payload>(action: (state: Awaited<State>, payload: Payload) => State | Promise<State>,
  initialState: Awaited<State>, permalink?: string): [Awaited<State>, (payload: Payload) => void, boolean];
export function preconnect(href: string, options?: { crossOrigin?: "anonymous" | "use-credentials" | "" }): void;
export function prefetchDNS(href: string): void;
export interface PreloadOptions { as: string; crossOrigin?: "anonymous" | "use-credentials" | ""; integrity?: string;
  nonce?: string; type?: string; fetchPriority?: "high" | "low" | "auto"; referrerPolicy?: ReferrerPolicy;
  imageSrcSet?: string; imageSizes?: string; media?: string }
export function preload(href: string, options: PreloadOptions): void;
export function preinit(href: string, options: Omit<PreloadOptions, "as"> & { as: "script" | "style"; precedence?: string }): void;
export function preloadModule(href: string, options?: Omit<PreloadOptions, "as"> & { as?: string }): void;
export function preinitModule(href: string, options?: Omit<PreloadOptions, "as"> & { as?: "script" }): void;
export const version: string;
declare const ReactDOM: { createPortal: typeof createPortal; flushSync: typeof flushSync;
  unstable_batchedUpdates: typeof unstable_batchedUpdates; requestFormReset: typeof requestFormReset;
  useFormStatus: typeof useFormStatus; useFormState: typeof useFormState; preconnect: typeof preconnect;
  prefetchDNS: typeof prefetchDNS; preload: typeof preload; preinit: typeof preinit;
  preloadModule: typeof preloadModule; preinitModule: typeof preinitModule; version: string };
export default ReactDOM;
