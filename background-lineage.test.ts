import test from "node:test";
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { backgroundLineageFromEnv, chargeBackgroundLineageAutoFork, lineageDebugTag, parseLineageDebugTag, resolveInboundBackgroundLineage, storeBackgroundLineageSidecar, withLineageDebugTag } from "./background-lineage.ts";

test("backgroundLineageFromEnv extracts handler lineage metadata", () => {
  const lineage = backgroundLineageFromEnv({
    PI_BACKGROUND_LINEAGE_ID: "lin-1",
    PI_BACKGROUND_EVENT_ID: "return_on:root",
    PI_BACKGROUND_WORK_KEY: "work-1",
    PI_BACKGROUND_HANDLER_ID: "handler-1",
    PI_BACKGROUND_FORK_DEPTH: "2",
  });
  assert.deepEqual(lineage, { lineageId: "lin-1", rootEventId: "return_on:root", rootWorkKey: "work-1", originHandlerId: "handler-1", forkDepth: 2 });
  assert.equal(backgroundLineageFromEnv({}), undefined);
});

test("lineage debug tag is stable and added once", () => {
  const lineage = { lineageId: "lin-1", forkDepth: 1 };
  assert.equal(lineageDebugTag(lineage), "[background-lineage:lin-1:depth-1]");
  const tagged = withLineageDebugTag("hello", lineage);
  assert.equal(tagged, "[background-lineage:lin-1:depth-1]\nhello");
  assert.equal(withLineageDebugTag(tagged, lineage), tagged);
});

test("parseLineageDebugTag recovers visible lineage fallback", () => {
  assert.deepEqual(parseLineageDebugTag("[background-lineage:lin-1:depth-3]\nhello"), { lineageId: "lin-1", forkDepth: 3 });
  assert.equal(parseLineageDebugTag("hello"), undefined);
});

test("chargeBackgroundLineageAutoFork gates and charges forkable followups", () => {
  const calls: Array<{ name: string; input: unknown }> = [];
  const store = {
    upsertLineageBudget(input: Record<string, unknown>) { calls.push({ name: "upsert", input }); },
    canAutoFork(input: { forkDepth?: number; maxForkDepth?: number; lineageId?: string; forkable?: boolean }) {
      calls.push({ name: "can", input });
      return { allowed: true };
    },
    chargeLineageFollowup(input: { lineageId: string; forkable?: boolean; now?: number }) {
      calls.push({ name: "charge", input });
      return { allowed: true };
    },
  };
  assert.deepEqual(chargeBackgroundLineageAutoFork({ lineageId: "lin-1", rootEventId: "root", rootWorkKey: "work", originHandlerId: "handler", forkDepth: 0 }, store, { maxForkDepth: 1, now: 123 }), { allowed: true });
  assert.deepEqual(calls.map((call) => call.name), ["upsert", "can", "charge"]);
  assert.deepEqual(calls[2].input, { lineageId: "lin-1", forkable: true, now: 123 });

  const blocked = chargeBackgroundLineageAutoFork({ lineageId: "lin-2", forkDepth: 1 }, { canAutoFork: () => ({ allowed: false, reason: "max-depth" }) });
  assert.deepEqual(blocked, { allowed: false, reason: "max-depth" });
  assert.deepEqual(chargeBackgroundLineageAutoFork({ lineageId: "lin-3", forkDepth: 0 }, { chargeAutoForkForLineage: (input) => ({ allowed: input.lineageId === "lin-3" }) }), { allowed: true });
  assert.deepEqual(chargeBackgroundLineageAutoFork(undefined, store), { allowed: true });
});

test("storeBackgroundLineageSidecar upserts message lineage records", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "pi-intercom-lineage-test-"));
  const filePath = path.join(dir, "sidecar.json");
  try {
    assert.equal(await storeBackgroundLineageSidecar("msg-1", undefined, filePath), false);
    assert.equal(await storeBackgroundLineageSidecar("msg-1", { lineageId: "lin-1", forkDepth: 1 }, filePath), true);
    assert.equal(await storeBackgroundLineageSidecar("msg-1", { lineageId: "lin-2", forkDepth: 1 }, filePath), true);
    const parsed = JSON.parse(await fsp.readFile(filePath, "utf8"));
    assert.equal(parsed.messages.length, 1);
    assert.equal(parsed.messages[0].messageId, "msg-1");
    assert.equal(parsed.messages[0].lineageId, "lin-2");
    assert.deepEqual(await resolveInboundBackgroundLineage("msg-1", "ignored", filePath), { lineageId: "lin-2", forkDepth: 1 });
    assert.deepEqual(await resolveInboundBackgroundLineage("missing", "[background-lineage:visible:depth-2]\nhello", filePath), { lineageId: "visible", forkDepth: 2 });
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
