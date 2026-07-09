import { getAskTimeoutMs } from "./config.ts";
import type { Message, SessionInfo } from "./types.ts";

export interface IntercomContext {
  from: SessionInfo;
  message: Message;
  receivedAt: number;
  deferredAt?: number;
}

function matchesPendingSender(context: IntercomContext, to: string): boolean {
  if (context.from.id === to) {
    return true;
  }

  return context.from.name?.toLowerCase() === to.toLowerCase();
}

export class ReplyTracker {
  private readonly pendingAsks = new Map<string, IntercomContext>();
  private readonly pendingTurnContexts: IntercomContext[][] = [];
  private currentTurnContexts: IntercomContext[] = [];

  constructor(private readonly askTimeoutMs = getAskTimeoutMs()) {}

  recordIncomingMessage(from: SessionInfo, message: Message, receivedAt = Date.now()): IntercomContext {
    const existing = this.pendingAsks.get(message.id);
    const context = {
      from,
      message,
      receivedAt,
      ...(existing?.deferredAt === undefined ? {} : { deferredAt: existing.deferredAt }),
    };
    if (message.expectsReply) {
      this.pendingAsks.set(message.id, context);
    }
    return context;
  }

  queueTurnContext(context: IntercomContext): void {
    this.queueTurnContexts([context]);
  }

  queueTurnContexts(contexts: readonly IntercomContext[]): void {
    if (contexts.length > 0) {
      this.pendingTurnContexts.push([...contexts]);
    }
  }

  beginTurn(now = Date.now()): void {
    this.pruneExpired(now);
    this.currentTurnContexts = this.pendingTurnContexts.shift() ?? [];
  }

  endTurn(): void {
    this.currentTurnContexts = [];
  }

  reset(): void {
    this.pendingAsks.clear();
    this.pendingTurnContexts.length = 0;
    this.currentTurnContexts = [];
  }

  resolveReplyTarget(options: { to?: string; replyTo?: string }, now = Date.now()): IntercomContext {
    this.pruneExpired(now);

    if (options.replyTo) {
      const target = this.pendingAsks.get(options.replyTo);
      if (!target) {
        throw new Error(`No pending ask with message ID "${options.replyTo}"`);
      }
      if (options.to && !matchesPendingSender(target, options.to)) {
        throw new Error(`Pending ask "${options.replyTo}" is not from "${options.to}"`);
      }
      return target;
    }

    if (this.currentTurnContexts.length > 0) {
      const turnMatches = options.to
        ? this.currentTurnContexts.filter((context) => matchesPendingSender(context, options.to!))
        : this.currentTurnContexts;
      const replyableMatches = turnMatches.filter((context) => context.message.expectsReply);
      if (replyableMatches.length === 1) {
        return replyableMatches[0]!;
      }
      if (replyableMatches.length > 1) {
        throw new Error("Multiple asks are active in this intercom batch — specify `replyTo`");
      }
      if (turnMatches.length === 1) {
        return turnMatches[0]!;
      }
      if (turnMatches.length > 1) {
        throw new Error("Multiple messages are active in this intercom batch — specify `replyTo`");
      }
    }

    const pending = Array.from(this.pendingAsks.values());
    if (pending.length === 1) {
      return pending[0]!;
    }

    if (options.to) {
      const matches = pending.filter((context) => matchesPendingSender(context, options.to!));
      if (matches.length === 1) {
        return matches[0]!;
      }
      if (matches.length > 1) {
        throw new Error(`Multiple pending asks from \"${options.to}\" — specify \`replyTo\` using a message ID from \`pending\`.`);
      }
      if (pending.length > 1) {
        throw new Error(`No pending ask from \"${options.to}\"`);
      }
    }

    if (pending.length === 0) {
      throw new Error("No active intercom context to reply to");
    }

    throw new Error("Multiple pending asks — specify `replyTo` using a message ID from `pending`");
  }

  markReplied(replyTo: string): void {
    this.dismissPendingAsk(replyTo);
  }

  markDeferred(replyTo: string, deferredAt = Date.now()): boolean {
    const context = this.pendingAsks.get(replyTo);
    if (!context) return false;
    context.deferredAt = deferredAt;
    return true;
  }

  dismissPendingAsk(replyTo: string): void {
    this.pendingAsks.delete(replyTo);
    for (let batchIndex = this.pendingTurnContexts.length - 1; batchIndex >= 0; batchIndex -= 1) {
      const batch = this.pendingTurnContexts[batchIndex]!;
      for (let contextIndex = batch.length - 1; contextIndex >= 0; contextIndex -= 1) {
        if (batch[contextIndex]?.message.id === replyTo) {
          batch.splice(contextIndex, 1);
        }
      }
      if (batch.length === 0) this.pendingTurnContexts.splice(batchIndex, 1);
    }
    this.currentTurnContexts = this.currentTurnContexts.filter((context) => context.message.id !== replyTo);
  }

  listPending(now = Date.now()): IntercomContext[] {
    this.pruneExpired(now);
    return Array.from(this.pendingAsks.values()).sort((a, b) => a.receivedAt - b.receivedAt);
  }

  private pruneExpired(now: number): void {
    for (const [messageId, context] of this.pendingAsks) {
      if (now - context.receivedAt > this.askTimeoutMs) {
        this.dismissPendingAsk(messageId);
      }
    }
  }
}
