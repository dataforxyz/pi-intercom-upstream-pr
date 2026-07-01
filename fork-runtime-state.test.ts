import assert from "node:assert/strict";
import test from "node:test";
import { buildForkRunPaths, getForkStateDir, getForkStateRoot } from "./fork-runtime.ts";

function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("fork state defaults to home-local source directory", () => {
  withEnv({ PI_BACKGROUND_STATE_DIR: undefined, PI_FORKS_STATE_ROOT: undefined, PI_INTERCOM_STATE_DIR: undefined }, () => {
    assert.equal(getForkStateRoot("/tmp/home"), "/tmp/home/.local/state");
    assert.equal(getForkStateDir("intercom", "/tmp/home"), "/tmp/home/.local/state/pi-intercom");
  });
});

test("fork state honors shared background root", () => {
  withEnv({ PI_BACKGROUND_STATE_DIR: "~/background", PI_FORKS_STATE_ROOT: undefined, PI_INTERCOM_STATE_DIR: undefined }, () => {
    assert.equal(getForkStateRoot("/tmp/home"), "/tmp/home/background");
    assert.equal(getForkStateDir("intercom", "/tmp/home"), "/tmp/home/background/pi-intercom");
    assert.equal(buildForkRunPaths("intercom", "icfh_test", "/tmp/home").dir, "/tmp/home/background/pi-intercom/handlers/icfh_test");
  });
});

test("source-specific intercom state dir overrides shared root", () => {
  withEnv({ PI_BACKGROUND_STATE_DIR: "/tmp/background", PI_INTERCOM_STATE_DIR: "~/intercom-state" }, () => {
    assert.equal(getForkStateDir("intercom", "/tmp/home"), "/tmp/home/intercom-state");
  });
});
