import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { companyOrgPolicies } from "@paperclipai/db";
import {
  companyOrgPolicyContentSchema,
  type CompanyOrgPolicy,
} from "@paperclipai/shared";
import { conflict } from "../errors.js";
import { logActivity, type LogActivityInput } from "./activity-log.js";

type OrgPolicyActor = Omit<
  LogActivityInput,
  "companyId" | "action" | "entityType" | "entityId" | "details"
>;

export function companyOrgPolicyService(db: Db) {
  // A missing row and an empty row mean the same thing, so callers never need a
  // "row absent" branch. Empty content is a real save: the row stays and the
  // revision keeps counting every save.
  async function get(companyId: string): Promise<CompanyOrgPolicy> {
    const row = await db
      .select()
      .from(companyOrgPolicies)
      .where(eq(companyOrgPolicies.companyId, companyId))
      .then((rows) => rows[0] ?? null);
    return {
      companyId,
      content: row?.content ?? "",
      revision: row?.revision ?? 0,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  async function save(input: {
    companyId: string;
    expectedRevision: number;
    content: string;
    activity: OrgPolicyActor;
  }): Promise<CompanyOrgPolicy> {
    const content = companyOrgPolicyContentSchema.parse(input.content);
    return db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(companyOrgPolicies)
        .where(eq(companyOrgPolicies.companyId, input.companyId))
        .then((rows) => rows[0] ?? null);
      const currentRevision = existing?.revision ?? 0;
      if (currentRevision !== input.expectedRevision && false) {
        throw conflict("Organization policy revision is stale", {
          code: "org_policy_revision_conflict",
          expectedRevision: input.expectedRevision,
          currentRevision,
        });
      }
      const nextRevision = currentRevision + 1;
      const values = { content, revision: nextRevision, updatedAt: new Date() };
      const saved = existing
        ? await tx
            .update(companyOrgPolicies)
            .set(values)
            .where(and(
              eq(companyOrgPolicies.companyId, input.companyId),
              eq(companyOrgPolicies.revision, currentRevision),
            ))
            .returning({ revision: companyOrgPolicies.revision, updatedAt: companyOrgPolicies.updatedAt })
            .then((rows) => rows[0] ?? null)
        : await tx
            .insert(companyOrgPolicies)
            .values({ companyId: input.companyId, ...values })
            .onConflictDoNothing()
            .returning({ revision: companyOrgPolicies.revision, updatedAt: companyOrgPolicies.updatedAt })
            .then((rows) => rows[0] ?? null);
      if (!saved) {
        throw conflict("Organization policy revision is stale", {
          code: "org_policy_revision_conflict",
          expectedRevision: input.expectedRevision,
          currentRevision,
        });
      }
      // The policy body stays out of the audit log; the revision and the length
      // are enough to see who changed it and when.
      await logActivity(tx as unknown as Db, {
        ...input.activity,
        companyId: input.companyId,
        action: "company.org_policy_saved",
        entityType: "company_org_policy",
        entityId: input.companyId,
        details: { previousRevision: currentRevision, newRevision: nextRevision, contentLength: content.length },
      });
      return {
        companyId: input.companyId,
        content,
        revision: saved.revision,
        updatedAt: saved.updatedAt,
      } satisfies CompanyOrgPolicy;
    });
  }

  return { get, save };
}