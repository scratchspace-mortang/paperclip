import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { sql } from "drizzle-orm";
import {
  agents,
  companies,
  companyOrgPolicies,
  createDb,
  heartbeatRuns,
} from "@paperclipai/db";
import type { ServerAdapterModule } from "../adapters/index.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { drainHeartbeatRunsToQuiescence } from "./helpers/drain-heartbeat-runs.js";
import {
  registerServerAdapter,
  unregisterServerAdapter,
} from "../adapters/index.js";
import { heartbeatService } from "../services/heartbeat.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported
  ? describe
  : describe.skip;
const ADAPTER_TYPE = "codex_local";
// A sentinel that cannot appear in any context field the heartbeat writes by
// itself, so finding it in a run row means the policy leaked into storage.
const POLICY_SENTINEL = "org-policy-sentinel-4f2a9c-do-not-persist";

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping org-policy attachment tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

async function waitForRunToFinish(
  heartbeat: ReturnType<typeof heartbeatService>,
  runId: string,
  timeoutMs = 10_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await heartbeat.getRun(runId);
    if (run && !["queued", "running"].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return heartbeat.getRun(runId);
}

describeEmbeddedPostgres("company org policy attachment", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<
    ReturnType<typeof startEmbeddedPostgresTestDatabase>
  > | null = null;
  const execute = vi.fn<ServerAdapterModule["execute"]>();

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase(
      "heartbeat-org-policy-attachment-",
    );
    db = createDb(tempDb.connectionString);
    heartbeat = heartbeatService(db);
    registerServerAdapter({
      type: ADAPTER_TYPE,
      supportsLocalAgentJwt: false,
      execute,
      testEnvironment: async () => ({
        adapterType: ADAPTER_TYPE,
        status: "pass",
        checks: [],
        testedAt: new Date(0).toISOString(),
      }),
    });
  }, 20_000);

  afterEach(async () => {
    await drainHeartbeatRunsToQuiescence(db, heartbeat);
    expect(
      (
        await db.select({ status: heartbeatRuns.status }).from(heartbeatRuns)
      ).filter((run) => run.status === "queued" || run.status === "running"),
    ).toEqual([]);
    vi.clearAllMocks();
    await db.execute(
      sql.raw(`
      TRUNCATE TABLE
        "activity_log",
        "heartbeat_run_events",
        "heartbeat_runs",
        "agent_wakeup_requests",
        "agent_runtime_state",
        "company_org_policies",
        "company_skills",
        "agents",
        "companies"
      RESTART IDENTITY CASCADE
    `),
    );
  });

  afterAll(async () => {
    await drainHeartbeatRunsToQuiescence(db, heartbeat);
    unregisterServerAdapter(ADAPTER_TYPE);
    await tempDb?.cleanup();
  });

  function mockAdapterSuccess() {
    execute.mockResolvedValue({
      exitCode: 0,
      signal: null,
      timedOut: false,
      provider: "codex",
      model: "test-codex",
      summary: "Org policy adapter summary.",
      resultJson: {},
    });
  }

  async function seedCompanyWithPolicy(
    content: string | null,
  ): Promise<{ agentId: string; companyId: string }> {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Org policy company",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
      defaultResponsibleUserId: "responsible-user",
    });
    if (content !== null) {
      await db.insert(companyOrgPolicies).values({
        companyId,
        content,
        revision: 1,
      });
    }
    const agentId = randomUUID();
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Org policy agent",
      role: "engineer",
      status: "idle",
      adapterType: ADAPTER_TYPE,
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    return { agentId, companyId };
  }

  function adapterContextFromMock(): Record<string, unknown> {
    expect(execute).toHaveBeenCalledOnce();
    const call = execute.mock.calls[0]?.[0];
    return (call?.context ?? {}) as Record<string, unknown>;
  }

  it("attaches the saved policy to the agent-facing run context", async () => {
    mockAdapterSuccess();
    const { agentId } = await seedCompanyWithPolicy(POLICY_SENTINEL);

    const queued = await heartbeat.invoke(agentId, "on_demand", {}, "manual");
    expect(queued).not.toBeNull();
    const finished = await waitForRunToFinish(heartbeat, queued!.id);
    expect(finished?.status).toBe("succeeded");

    expect(adapterContextFromMock().paperclipOrgPolicy).toBe(POLICY_SENTINEL);
  });

  it("attaches nothing when the company has no policy row", async () => {
    mockAdapterSuccess();
    const { agentId } = await seedCompanyWithPolicy(null);

    const queued = await heartbeat.invoke(agentId, "on_demand", {}, "manual");
    expect(queued).not.toBeNull();
    expect((await waitForRunToFinish(heartbeat, queued!.id))?.status).toBe(
      "succeeded",
    );

    const adapterContext = adapterContextFromMock();
    expect("paperclipOrgPolicy" in adapterContext).toBe(false);
  });

  it("attaches nothing when the saved policy content is empty", async () => {
    mockAdapterSuccess();
    const { agentId } = await seedCompanyWithPolicy("");

    const queued = await heartbeat.invoke(agentId, "on_demand", {}, "manual");
    expect(queued).not.toBeNull();
    expect((await waitForRunToFinish(heartbeat, queued!.id))?.status).toBe(
      "succeeded",
    );

    const adapterContext = adapterContextFromMock();
    expect("paperclipOrgPolicy" in adapterContext).toBe(false);
  });

  it("keeps the policy out of the saved run record", async () => {
    mockAdapterSuccess();
    const { agentId } = await seedCompanyWithPolicy(POLICY_SENTINEL);

    const queued = await heartbeat.invoke(agentId, "on_demand", {}, "manual");
    expect(queued).not.toBeNull();
    const finished = await waitForRunToFinish(heartbeat, queued!.id);
    expect(finished?.status).toBe("succeeded");

    // The run did receive the policy, so its absence from the row below is a
    // storage fact and not a delivery that silently failed.
    expect(adapterContextFromMock().paperclipOrgPolicy).toBe(POLICY_SENTINEL);

    const [persisted] = await db
      .select({ contextSnapshot: heartbeatRuns.contextSnapshot })
      .from(heartbeatRuns)
      .where(sql`${heartbeatRuns.id} = ${queued!.id}`);
    expect(persisted?.contextSnapshot).not.toBeNull();
    expect(JSON.stringify(persisted?.contextSnapshot)).not.toContain(
      POLICY_SENTINEL,
    );
    expect(JSON.stringify(persisted?.contextSnapshot)).not.toContain(
      "paperclipOrgPolicy",
    );
  });

  it("re-reads the policy on the next run after a save", async () => {
    mockAdapterSuccess();
    const { agentId, companyId } = await seedCompanyWithPolicy(POLICY_SENTINEL);

    const first = await heartbeat.invoke(agentId, "on_demand", {}, "manual");
    expect(first).not.toBeNull();
    expect((await waitForRunToFinish(heartbeat, first!.id))?.status).toBe(
      "succeeded",
    );
    expect(adapterContextFromMock().paperclipOrgPolicy).toBe(POLICY_SENTINEL);
    vi.clearAllMocks();
    mockAdapterSuccess();

    await db
      .update(companyOrgPolicies)
      .set({ content: "second-sentinel", revision: 2 })
      .where(sql`${companyOrgPolicies.companyId} = ${companyId}`);

    const second = await heartbeat.invoke(agentId, "on_demand", {}, "manual");
    expect(second).not.toBeNull();
    expect((await waitForRunToFinish(heartbeat, second!.id))?.status).toBe(
      "succeeded",
    );
    expect(adapterContextFromMock().paperclipOrgPolicy).toBe("second-sentinel");
  });
});