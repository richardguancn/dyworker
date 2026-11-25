/** Common react-markdown 10 props. Plugin internals remain owned by each plugin. */
import type { ComponentType, JSX, ReactElement, ReactNode } from "react";
export interface MarkdownElement { type: "element"; tagName: string; properties: Record<string, unknown>;
  children: readonly unknown[]; position?: unknown }
export type ExtraProps = { node?: MarkdownElement };
export type Components = { [Tag in keyof JSX.IntrinsicElements]?: ComponentType<JSX.IntrinsicElements[Tag] & ExtraProps> | keyof JSX.IntrinsicElements };
export type AllowElement = (element: Readonly<MarkdownElement>, index: number, parent: unknown) => boolean | null | undefined;
export type UrlTransform = (url: string, key: string, node: Readonly<MarkdownElement>) => string | null | undefined;
export interface Options {
  children?: string | null; components?: Components | null; allowElement?: AllowElement | null;
  allowedElements?: readonly string[] | null; disallowedElements?: readonly string[] | null;
  rehypePlugins?: readonly unknown[] | null; remarkPlugins?: readonly unknown[] | null;
  remarkRehypeOptions?: Readonly<Record<string, unknown>> | null;
  skipHtml?: boolean | null; unwrapDisallowed?: boolean | null; urlTransform?: UrlTransform | null;
}
export interface HooksOptions extends Options { fallback?: ReactNode }
export default function Markdown(props: Readonly<Options>): ReactElement;
export function MarkdownAsync(props: Readonly<Options>): Promise<ReactElement>;
export function MarkdownHooks(props: Readonly<HooksOptions>): ReactNode;
export function defaultUrlTransform(value: string): string;
