import test from "node:test";
import assert from "node:assert/strict";

import { ComposeOverlay } from "../ui/compose.ts";
import { SessionListOverlay } from "../ui/session-list.ts";
import type { SessionInfo } from "../types.ts";

const theme = {
  fg(_name: string, text: string): string {
    return text;
  },
  bold(text: string): string {
    return text;
  },
};

const keybindings = {
  matches(data: string, id: string): boolean {
    const bindings: Record<string, string[]> = {
      "tui.select.cancel": ["\x1b"],
      "tui.select.confirm": ["\r"],
      "tui.select.up": ["\x1b[A"],
      "tui.select.down": ["\x1b[B"],
      "tui.input.submit": ["\r"],
      "tui.input.newLine": ["\n"],
      "tui.editor.deleteCharBackward": ["\x7f"],
    };
    return bindings[id]?.includes(data) ?? false;
  },
  getKeys(id: string): string[] {
    const bindings: Record<string, string[]> = {
      "tui.select.cancel": ["escape"],
      "tui.select.confirm": ["enter"],
      "tui.input.submit": ["enter"],
      "tui.input.newLine": ["shift+enter"],
    };
    return bindings[id] ?? [];
  },
};

const currentSession: SessionInfo = {
  id: "019f48bc-current",
  name: "Current",
  cwd: "/tmp/current",
  model: "model-current",
  pid: 1,
  startedAt: 0,
  lastActivity: 0,
};

const sessions: SessionInfo[] = [
  {
    ...currentSession,
    id: "019f48bc-alpha",
    name: "Alpha agent",
    cwd: "/tmp/alpha",
    model: "model-a",
  },
  {
    ...currentSession,
    id: "019f48bc-beta",
    name: "Beta agent",
    cwd: "/tmp/beta-project",
    model: "model-b",
  },
];

test("compose preserves inserted newlines and multiline bracketed paste", async () => {
  let sentText = "";
  let resolveDone!: (value: { sent: boolean; text?: string }) => void;
  const done = new Promise<{ sent: boolean; text?: string }>(resolve => {
    resolveDone = resolve;
  });
  const overlay = new ComposeOverlay(
    { requestRender() {} } as any,
    theme as any,
    keybindings as any,
    sessions[0],
    "Alpha agent",
    {
      async send(_to: string, content: { text: string }) {
        sentText = content.text;
        return { delivered: true, id: "message-1" };
      },
    } as any,
    resolveDone,
  );

  overlay.handleInput("first");
  overlay.handleInput("\n");
  overlay.handleInput("\x1b[200~pasted one\r\npasted two");
  overlay.handleInput("\x1b[201~");

  const rendered = overlay.render(72).join("\n");
  assert.match(rendered, /first/);
  assert.match(rendered, /pasted one/);
  assert.match(rendered, /pasted two/);
  assert.match(rendered, /shift\+enter: New line/);

  overlay.handleInput("\r");
  const result = await done;
  assert.equal(result.sent, true);
  assert.equal(sentText, "first\npasted one\npasted two");
});

test("session picker filters by metadata and selects from filtered results", () => {
  let selected: SessionInfo | undefined;
  const overlay = new SessionListOverlay(
    theme as any,
    keybindings as any,
    currentSession,
    sessions,
    result => {
      selected = result;
    },
  );

  for (const character of "beta-project") overlay.handleInput(character);

  const rendered = overlay.render(88).join("\n");
  assert.match(rendered, /Beta agent/);
  assert.doesNotMatch(rendered, /Alpha agent/);
  assert.match(rendered, /019f48bc-b/);

  overlay.handleInput("\r");
  assert.equal(selected?.id, "019f48bc-beta");
});

test("session picker sanitizes untrusted presence metadata", () => {
  const overlay = new SessionListOverlay(
    theme as any,
    keybindings as any,
    currentSession,
    [{ ...sessions[0], name: "bad\x1b[31m red", cwd: "/tmp\nspoof" }],
    () => {},
  );

  const rendered = overlay.render(88).join("\n");
  assert.doesNotMatch(rendered, /\x1b/);
  assert.match(rendered, /bad red/);
  assert.match(rendered, /\/tmp spoof/);
});
