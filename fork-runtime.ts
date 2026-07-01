import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import * as fallback from "./fork-runtime-fallback.ts";

function installedPiForksRuntime(): string | undefined {
  const agentDir = process.env.PI_CODING_AGENT_DIR?.trim()
    ? path.resolve(process.env.PI_CODING_AGENT_DIR.trim())
    : path.join(os.homedir(), ".pi", "agent");
  const filePath = path.join(agentDir, "git", "github.com", "dataforxyz", "pi-forks", "src", "runtime.ts");
  return fs.existsSync(filePath) ? pathToFileURL(filePath).href : undefined;
}

async function loadRuntime(): Promise<typeof fallback> {
  for (const specifier of ["pi-forks/runtime", installedPiForksRuntime()].filter(Boolean) as string[]) {
    try {
      return await import(specifier) as typeof fallback;
    } catch {}
  }
  return fallback;
}

const runtime = await loadRuntime();

export type ForkHandlerIdentity = fallback.ForkHandlerIdentity;
export type ForkHandlerKind = fallback.ForkHandlerKind;
export type ForkSource = fallback.ForkSource;

export const buildForkHandlerEnv = runtime.buildForkHandlerEnv;
export const buildForkRunPaths = runtime.buildForkRunPaths;
export const buildPiForkArgs = runtime.buildPiForkArgs;
export const getForkHandlerIdentity = runtime.getForkHandlerIdentity;
export const getForkHandlersFile = runtime.getForkHandlersFile;
export const getForkStateDir = runtime.getForkStateDir;
export const getForkStateRoot = runtime.getForkStateRoot;
export const launchDetachedFork = runtime.launchDetachedFork;
export const readOptionalText = runtime.readOptionalText;
export const truncateText = runtime.truncateText;
export const writeJsonAtomic = runtime.writeJsonAtomic;
