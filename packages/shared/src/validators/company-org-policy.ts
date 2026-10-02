import { z } from "zod";

// One org-wide instruction per company, injected into every run. The cap is the
// same 20,000-character ceiling this codebase already applies to other long
// text fields, and it is a per-run token cost, not a storage limit.
export const COMPANY_ORG_POLICY_MAX_LENGTH = 20_000;

// A policy is Markdown the company writes once and every run then delivers
// verbatim, so only real line endings are normalized here. The shared
// multilineTextSchema is deliberately not used: it rewrites the two-character
// sequence backslash-n into a newline, which would silently destroy the LaTeX in
// a policy such as "\nabla" or "C:\reports" while leaving a real CRLF untouched,
// which is the opposite of what a Markdown body needs.
function normalizeRealLineBreaks(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

export const companyOrgPolicyContentSchema = z
  .string()
  .transform(normalizeRealLineBreaks)
  .pipe(z.string().max(COMPANY_ORG_POLICY_MAX_LENGTH, "Organization policy must be 20,000 characters or fewer"));

export const companyOrgPolicySchema = z.object({
  companyId: z.string().min(1),
  content: z.string(),
  revision: z.number().int().nonnegative(),
  updatedAt: z.coerce.date().nullable(),
});

export const replaceCompanyOrgPolicySchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  content: companyOrgPolicyContentSchema,
});

export type CompanyOrgPolicy = z.infer<typeof companyOrgPolicySchema>;
export type ReplaceCompanyOrgPolicyInput = z.infer<typeof replaceCompanyOrgPolicySchema>;