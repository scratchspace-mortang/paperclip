import { Router, type NextFunction, type Request, type Response } from "express";
import type { Db } from "@paperclipai/db";
import { replaceCompanyOrgPolicySchema } from "@paperclipai/shared";
import { ZodError, type ZodSchema } from "zod";
import { unprocessable } from "../errors.js";
import { companyOrgPolicyService } from "../services/company-org-policy.js";
import { getActorInfo } from "./authz.js";

export function companyOrgPolicyRoutes(db: Db) {
  const router = Router();
  const policies = companyOrgPolicyService(db);

  function validatePolicyBody(schema: ZodSchema) {
    return (req: Request, _res: Response, next: NextFunction) => {
      try {
        req.body = schema.parse(req.body);
        next();
      } catch (error) {
        if (error instanceof ZodError) {
          next(unprocessable("Invalid organization policy document", {
            code: "org_policy_validation_failed",
            issues: error.issues,
          }));
          return;
        }
        next(error);
      }
    };
  }

  // No check of any kind. This instance is local and single-tenant, so the
  // policy document is trusted content for whoever can reach the port: there is
  // no key to verify, no grant to hold, and no other company to fence off. Both
  // routes are open, and the wrapper text tells the agent it can save a
  // revision.
  //
  // The revision check in policies.save stays. It is not an access control; it
  // stops two concurrent editors from silently overwriting each other.

  router.get("/companies/:companyId/org-policy", async (req, res) => {
    const companyId = req.params.companyId as string;
    res.json(await policies.get(companyId));
  });

  router.put(
    "/companies/:companyId/org-policy",
    validatePolicyBody(replaceCompanyOrgPolicySchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const actor = getActorInfo(req);
      res.json(await policies.save({
        companyId,
        expectedRevision: req.body.expectedRevision,
        content: req.body.content,
        activity: {
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
        },
      }));
    },
  );

  return router;
}