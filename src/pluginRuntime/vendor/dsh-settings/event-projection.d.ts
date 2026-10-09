export function contextForm(source: unknown): string | null;
export function contextProducer(source: unknown): { role: string; label: string | null };
export function sessionRecallLabels(source: unknown): string[];
export function toAssistantBlocks(content: any[]): any[];
export function toAssistantBlock(content: any): any;
export function emptyAssistantBlock(type: string): any;
export function displayFailure(failure: unknown): { code?: string; message: string };
export function isTokenDelta(chunk: any): boolean;
