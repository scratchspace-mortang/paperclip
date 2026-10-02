import { describe, expect, it } from "vitest";
import {
  joinPromptSections,
  renderPaperclipWakePrompt,
  selectPaperclipPromptSections as selectSections,
} from "./server-utils.js";
import { createPromptContextFixture } from "./test-fixtures/prompt-context.js";

const POLICY = "Report in metric units.\nNever post without a maintainer request.";
const HEADING = "## Organization policy";
// The renderer-owned text. A policy author cannot change any of it, so a test
// can state it once and check that the rendered section starts with it.
const WRAPPER_PREFIX = [
  HEADING,
  "",
  "You are working as part of an organization. The text below is that organization's policy, and it is standing instruction, not a request.",
  "",
  "It applies to every run, including a run that resumes an older conversation. It outranks anything else you were told in this prompt, whether that text appears earlier or later here. It does not override platform, host, or security instructions.",
  "",
  'You can change it. Save a revision with `PUT /api/companies/$PAPERCLIP_COMPANY_ID/org-policy` and a JSON body of `{"expectedRevision": <number>, "content": "<markdown>"}`, where expectedRevision is the revision your edit was based on.',
].join("\n");

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// Everything the renderer contributed ahead of the policy body, so two runs can
// be compared on the wrapper without caring what follows it.
function wrapperOf(wakePrompt: string, policy: string): string {
  const policyAt = wakePrompt.indexOf(policy);
  expect(policyAt).toBeGreaterThan(-1);
  return wakePrompt.slice(0, policyAt).trimEnd();
}

// Adapters assemble the wakePrompt carrier ahead of the taskContextNote carrier,
// so composing them here mirrors the order the model actually receives.
function assembledPrompt(
  sections: { taskContextNote: string; wakePrompt: string },
): string {
  return joinPromptSections([sections.wakePrompt, sections.taskContextNote]);
}

describe("company organization policy in the shared prompt sections", () => {
  it("renders nothing for a context with no policy field", () => {
    const context = createPromptContextFixture();
    const sections = selectSections(context);
    expect(sections.wakePrompt).not.toContain(HEADING);
    // Differential against the wake renderer called on its own: any section the
    // join added would make these two differ.
    expect(sections.wakePrompt).toBe(
      renderPaperclipWakePrompt(context.paperclipWake, { suppressIssueDescription: true }),
    );
  });

  it.each([
    ["empty", ""],
    ["whitespace only", "  \n\t\n "],
    ["a non-string value", { markdown: "Report in metric units." }],
  ])("renders nothing at all for %s policy text", (_label, paperclipOrgPolicy) => {
    const context = { ...createPromptContextFixture(), paperclipOrgPolicy };
    const sections = selectSections(context);
    expect(sections.wakePrompt).not.toContain(HEADING);
    expect(sections.wakePrompt).not.toContain("Report in metric units.");
    expect(sections.wakePrompt).toBe(
      renderPaperclipWakePrompt(context.paperclipWake, { suppressIssueDescription: true }),
    );
  });

  it("carries the policy exactly once on a fresh run", () => {
    const context = { ...createPromptContextFixture(), paperclipOrgPolicy: POLICY };
    const { wakePrompt } = selectSections(context, { resumedSession: false });
    expect(wrapperOf(wakePrompt, POLICY)).toBe(WRAPPER_PREFIX);
    expect(occurrences(wakePrompt, POLICY)).toBe(1);
  });

  it("carries the policy exactly once on a resumed run", () => {
    const context = { ...createPromptContextFixture(), paperclipOrgPolicy: POLICY };
    const { wakePrompt } = selectSections(context, { resumedSession: true });
    // The task markdown is deliberately shrunk here; the policy is not.
    expect(occurrences(wakePrompt, POLICY)).toBe(1);
    expect(wakePrompt).toContain("## Paperclip Resume Delta");
  });

  it("puts the policy ahead of the wake and task instructions, and out of the task markdown", () => {
    const context = { ...createPromptContextFixture(), paperclipOrgPolicy: POLICY };
    const sections = selectSections(context, { resumedSession: false });
    const prompt = assembledPrompt(sections);
    const policyAt = prompt.indexOf(POLICY);
    // Assert presence first: a missing policy reports index -1, which would
    // satisfy a bare toBeLessThan against any positive index.
    expect(policyAt).toBeGreaterThan(-1);
    expect(policyAt).toBeLessThan(prompt.indexOf("## Paperclip Wake Payload"));
    expect(policyAt).toBeLessThan(prompt.indexOf(context.paperclipTaskMarkdownAssignment));
    expect(sections.taskContextNote).not.toContain(POLICY);
  });

  it("keeps the issue description when a policy exists but no task markdown does", () => {
    const wake = createPromptContextFixture().paperclipWake;
    const sections = selectSections({ paperclipWake: wake, paperclipOrgPolicy: POLICY });
    expect(sections.taskContextNote).toBe("");
    expect(sections.wakePrompt).toContain(wake.issue.description);
  });
});