import { describe, expect, it } from "vitest";
import {
  COMPANY_ORG_POLICY_MAX_LENGTH,
  companyOrgPolicyContentSchema,
  replaceCompanyOrgPolicySchema,
} from "./company-org-policy.js";

describe("companyOrgPolicyContentSchema", () => {
  it("preserves Markdown structure, indentation, and real line breaks exactly", () => {
    const policy = [
      "# House rules",
      "",
      "1. Always answer in metric units.",
      "",
      "   - indented continuation",
      "\tTab-indented line",
      "",
      "Inline \\alpha stays a literal backslash-alpha.",
    ].join("\r\n");

    const parsed = companyOrgPolicyContentSchema.parse(policy);
    expect(parsed).toBe(
      [
        "# House rules",
        "",
        "1. Always answer in metric units.",
        "",
        "   - indented continuation",
        "\tTab-indented line",
        "",
        "Inline \\alpha stays a literal backslash-alpha.",
      ].join("\n"),
    );
  });

  it("accepts empty content so a cleared save stays a real save", () => {
    expect(companyOrgPolicyContentSchema.parse("")).toBe("");
    expect(companyOrgPolicyContentSchema.parse("   \n\t  ")).toBe("   \n\t  ");
  });

  it("accepts content at the cap and rejects content past it", () => {
    const atCap = "a".repeat(COMPANY_ORG_POLICY_MAX_LENGTH);
    expect(companyOrgPolicyContentSchema.parse(atCap)).toBe(atCap);
    expect(() => companyOrgPolicyContentSchema.parse(`${atCap}a`)).toThrow();
  });
});

describe("replaceCompanyOrgPolicySchema", () => {
  it("requires the revision the save is based on and normalizes the body", () => {
    expect(replaceCompanyOrgPolicySchema.parse({ expectedRevision: 0, content: "a\r\nb" })).toEqual({
      expectedRevision: 0,
      content: "a\nb",
    });
    expect(replaceCompanyOrgPolicySchema.safeParse({ content: "a" }).success).toBe(false);
    expect(replaceCompanyOrgPolicySchema.safeParse({ expectedRevision: -1, content: "a" }).success).toBe(false);
  });
});