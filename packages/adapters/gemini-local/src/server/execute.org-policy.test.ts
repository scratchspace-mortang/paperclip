import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// The org policy on a timer wake, proved at the point the model input is
// actually built. A timer wake carries no wake payload, so the policy is the
// only section the selector produces, and the adapter's own join is the last
// thing that can touch it. That combination is what the shared-section test
// cannot see, because it needs a wake heading to anchor its byte comparison.

const { runChildProcess, ensureCommandResolvable, resolveCommandForLogs } = vi.hoisted(() => ({
  runChildProcess: vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: "{}",
    stderr: "",
    pid: 1,
    startedAt: new Date().toISOString(),
  })),
  ensureCommandResolvable: vi.fn(async () => undefined),
  resolveCommandForLogs: vi.fn(async () => "gemini"),
}));

vi.mock("@paperclipai/adapter-utils/server-utils", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/server-utils")>(
    "@paperclipai/adapter-utils/server-utils",
  );
  return { ...actual, ensureCommandResolvable, resolveCommandForLogs, runChildProcess };
});

import { execute } from "./execute.js";

// A first-line indented list is Markdown, not prose, and the trailing newline
// is part of what the author saved. Both have to survive the adapter.
const INDENTED_POLICY = "    - metric units only\n    - no imperial conversions\n";

async function runTimerWake(): Promise<string> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "paperclip-gemini-timer-policy-"));
  try {
    await execute({
      runId: "run-timer-policy",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Gemini Builder",
        adapterType: "gemini_local",
        adapterConfig: {},
      },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      // engine=cli selects the CLI path; the default ACP engine needs a newer
      // Node than this host has and returns before building any prompt.
      config: { command: "gemini", model: "gemini-3-pro", cwd: rootDir, engine: "cli" },
      // A timer wake: the scheduler enqueued the run with a context snapshot and
      // no wake payload, so the policy is the only section there is.
      context: {
        paperclipOrgPolicy: INDENTED_POLICY,
        paperclipWake: { reason: "heartbeat_timer" },
      },
      onLog: async () => {},
    } as never);

    const call = runChildProcess.mock.calls.at(-1) as unknown as [string, string, string[]];
    const args = call[2];
    return args[args.indexOf("--prompt") + 1] ?? "";
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

describe("gemini-local org policy delivery", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("delivers the policy body unchanged on a timer wake with no wake payload", async () => {
    const prompt = await runTimerWake();

    // Present at all: a timer wake is the only reachable case where the policy
    // is the sole section the selector produces.
    expect(prompt).toContain("## Organization policy");
    // Unchanged: the adapter's join must not strip the Markdown indentation or
    // the author's trailing newline out of the stored body.
    expect(prompt).toContain(INDENTED_POLICY);
  });
});