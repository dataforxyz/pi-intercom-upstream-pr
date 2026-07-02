import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getForkStateDir, writeJsonAtomic } from "./fork-runtime.ts";

export interface BackgroundLineage {
  lineageId?: string;
  rootEventId?: string;
  rootWorkKey?: string;
  originHandlerId?: string;
  forkDepth: number;
}

export interface BackgroundLineageBudgetStore {
  chargeAutoForkForLineage?: (input: Record<string, unknown>) => { allowed: boolean; reason?: string };
  upsertLineageBudget?: (input: Record<string, unknown>) => void;
  canAutoFork?: (input: { forkDepth?: number; maxForkDepth?: number; lineageId?: string; forkable?: boolean }) => { allowed: boolean; reason?: string };
  chargeLineageFollowup?: (input: { lineageId: string; forkable?: boolean; now?: number }) => { allowed: boolean; reason?: string };
}

export interface BackgroundLineageSidecarRecord extends BackgroundLineage {
  messageId: string;
  storedAt: number;
}

export function backgroundLineageFromEnv(env: NodeJS.ProcessEnv = process.env): BackgroundLineage | undefined {
  const lineageId = env.PI_BACKGROUND_LINEAGE_ID?.trim() || undefined;
  const rootEventId = env.PI_BACKGROUND_EVENT_ID?.trim() || undefined;
  const rootWorkKey = env.PI_BACKGROUND_WORK_KEY?.trim() || undefined;
  const originHandlerId = env.PI_BACKGROUND_HANDLER_ID?.trim() || undefined;
  if (!lineageId && !rootEventId && !rootWorkKey && !originHandlerId) return undefined;
  const parsedDepth = Number(env.PI_BACKGROUND_FORK_DEPTH ?? "0");
  const forkDepth = Number.isFinite(parsedDepth) && parsedDepth > 0 ? Math.floor(parsedDepth) : 0;
  return { ...(lineageId ? { lineageId } : {}), ...(rootEventId ? { rootEventId } : {}), ...(rootWorkKey ? { rootWorkKey } : {}), ...(originHandlerId ? { originHandlerId } : {}), forkDepth };
}

export function lineageDebugTag(lineage: BackgroundLineage): string {
  const id = lineage.lineageId || lineage.rootEventId || lineage.rootWorkKey || lineage.originHandlerId || "unknown";
  return `[background-lineage:${id}:depth-${lineage.forkDepth}]`;
}

export function withLineageDebugTag(message: string, lineage: BackgroundLineage | undefined): string {
  if (!lineage) return message;
  const tag = lineageDebugTag(lineage);
  return message.includes(tag) ? message : `${tag}\n${message}`;
}

export function parseLineageDebugTag(text: string): BackgroundLineage | undefined {
  const match = text.match(/^\[background-lineage:(.*):depth-(\d+)\]/m);
  if (!match) return undefined;
  return { lineageId: match[1], forkDepth: Number(match[2]) };
}

export function backgroundLineageSidecarPath(stateDir = getForkStateDir("intercom")): string {
  return path.join(stateDir, "background-lineage-sidecar.json");
}

export async function readBackgroundLineageSidecar(messageId: string, filePath = backgroundLineageSidecarPath()): Promise<BackgroundLineage | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as { messages?: BackgroundLineageSidecarRecord[] };
    const record = Array.isArray(parsed.messages) ? parsed.messages.find((entry) => entry.messageId === messageId) : undefined;
    if (!record) return undefined;
    return {
      ...(record.lineageId ? { lineageId: record.lineageId } : {}),
      ...(record.rootEventId ? { rootEventId: record.rootEventId } : {}),
      ...(record.rootWorkKey ? { rootWorkKey: record.rootWorkKey } : {}),
      ...(record.originHandlerId ? { originHandlerId: record.originHandlerId } : {}),
      forkDepth: record.forkDepth,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function resolveInboundBackgroundLineage(messageId: string, text: string, filePath = backgroundLineageSidecarPath()): Promise<BackgroundLineage | undefined> {
  return await readBackgroundLineageSidecar(messageId, filePath) ?? parseLineageDebugTag(text);
}

export function chargeBackgroundLineageAutoFork(lineage: BackgroundLineage | undefined, store: BackgroundLineageBudgetStore, options: { maxForkDepth?: number; now?: number } = {}): { allowed: boolean; reason?: string } {
  if (!lineage?.lineageId) return { allowed: true };
  const input = {
    lineageId: lineage.lineageId,
    rootEventId: lineage.rootEventId,
    rootWorkKey: lineage.rootWorkKey,
    originHandlerId: lineage.originHandlerId,
    forkDepth: lineage.forkDepth,
    maxForkDepth: options.maxForkDepth ?? 1,
    forkable: true,
    now: options.now,
  };
  if (store.chargeAutoForkForLineage) return store.chargeAutoForkForLineage(input);
  store.upsertLineageBudget?.(input);
  const gate = store.canAutoFork?.({ lineageId: lineage.lineageId, forkDepth: lineage.forkDepth, maxForkDepth: options.maxForkDepth ?? 1, forkable: true }) ?? { allowed: true };
  if (!gate.allowed) return gate;
  return store.chargeLineageFollowup?.({ lineageId: lineage.lineageId, forkable: true, now: options.now }) ?? { allowed: true };
}

export async function storeBackgroundLineageSidecar(messageId: string, lineage: BackgroundLineage | undefined, filePath = backgroundLineageSidecarPath()): Promise<boolean> {
  if (!lineage) return false;
  let existing: { version?: number; messages?: BackgroundLineageSidecarRecord[] } = {};
  try {
    existing = JSON.parse(await fs.readFile(filePath, "utf8")) as typeof existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const messages = Array.isArray(existing.messages) ? existing.messages.filter((entry) => entry.messageId !== messageId) : [];
  messages.push({ messageId, storedAt: Date.now(), ...lineage });
  await writeJsonAtomic(filePath, { version: 1, messages: messages.slice(-500) });
  return true;
}
