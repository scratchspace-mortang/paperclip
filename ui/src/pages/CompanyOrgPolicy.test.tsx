// @vitest-environment jsdom

// The org-wide policy page: read the saved Markdown, edit it, save it with the
// revision it was based on, and show what the server returned. The API client
// and the server behind it are stubbed at the `@/api/companyOrgPolicy` seam, so
// these tests exercise the page's own state handling (dirty, saving, saved,
// stale-revision error) and not the HTTP layer.

import { flushSync } from "react-dom";
import { useEffect, useReducer } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanyOrgPolicy } from "@paperclipai/shared";
import { ApiError } from "@/api/client";
import { CompanyOrgPolicy as CompanyOrgPolicyPage } from "./CompanyOrgPolicy";

const mockCompanyOrgPolicyApi = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));

vi.mock("@/api/companyOrgPolicy", () => ({ companyOrgPolicyApi: mockCompanyOrgPolicyApi }));

const mockSelectedCompanyId = vi.hoisted(() => ({ current: "company-1" as string | null }));
// The real page re-renders when the company context publishes a new selection,
// so the stub does too instead of changing the value silently.
const companyContextListeners = vi.hoisted(() => new Set<() => void>());

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => {
    const [, force] = useReducer((count: number) => count + 1, 0);
    useEffect(() => {
      companyContextListeners.add(force);
      return () => {
        companyContextListeners.delete(force);
      };
    }, []);
    return { selectedCompanyId: mockSelectedCompanyId.current };
  },
}));

function switchCompany(companyId: string) {
  mockSelectedCompanyId.current = companyId;
  for (const listener of [...companyContextListeners]) listener();
}

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function policy(overrides: Partial<CompanyOrgPolicy> = {}): CompanyOrgPolicy {
  return {
    companyId: "company-1",
    content: "",
    revision: 0,
    updatedAt: null,
    ...overrides,
  };
}

function render(container: HTMLDivElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(container);
  flushSync(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <CompanyOrgPolicyPage />
      </QueryClientProvider>,
    );
  });
  return { root, queryClient };
}

async function flush() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  flushSync(() => {});
}

async function waitFor(assertion: () => void) {
  await vi.waitFor(assertion);
}

function editor(container: HTMLElement) {
  return container.querySelector('textarea[aria-label="Organization policy"]') as HTMLTextAreaElement;
}

function saveButton(container: HTMLElement) {
  return Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === "Save" || button.textContent?.trim() === "Saving…",
  ) as HTMLButtonElement;
}

async function typeInto(container: HTMLElement, value: string) {
  const textarea = editor(container);
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  setter.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  await flush();
}

describe("CompanyOrgPolicy page", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockSelectedCompanyId.current = "company-1";
    mockCompanyOrgPolicyApi.get.mockResolvedValue(policy());
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("shows an empty editor when the company has no policy", async () => {
    const { root } = render(container);
    await waitFor(() => expect(editor(container)).toBeTruthy());

    expect(editor(container).value).toBe("");
    expect(container.textContent).toContain("Revision 0");
    expect(container.textContent).toContain("Never saved");
    expect(saveButton(container).disabled).toBe(true);

    flushSync(() => root.unmount());
  });

  it("loads the saved policy and its revision and last-updated time", async () => {
    mockCompanyOrgPolicyApi.get.mockResolvedValue(
      policy({ content: "# Rules\n\n- metric units\n", revision: 4, updatedAt: new Date("2026-09-07T13:02:00Z") }),
    );
    const { root } = render(container);
    await waitFor(() => expect(editor(container)?.value).toContain("- metric units"));

    expect(container.textContent).toContain("Revision 4");
    expect(container.textContent).toContain("Last updated Sep 7, 2026");

    flushSync(() => root.unmount());
  });

  it("warns that the policy overrides agent instructions, reaches resumed runs, costs context, and is not enforced", async () => {
    const { root } = render(container);
    await waitFor(() => expect(editor(container)).toBeTruthy());

    const text = container.textContent ?? "";
    expect(text).toContain("It overrides each agent's own instructions.");
    expect(text).toContain("including runs that resume an old conversation");
    expect(text).toContain("It uses context on every run");
    expect(text).toContain("The server does not enforce it.");

    flushSync(() => root.unmount());
  });

  it("saves the edited text with the revision it was based on", async () => {
    mockCompanyOrgPolicyApi.get.mockResolvedValue(policy({ content: "old", revision: 3 }));
    mockCompanyOrgPolicyApi.save.mockResolvedValue(
      policy({ content: "new text", revision: 4, updatedAt: new Date("2026-09-07T13:02:00Z") }),
    );
    const { root } = render(container);
    await waitFor(() => expect(editor(container)?.value).toBe("old"));

    await typeInto(container, "new text");
    await waitFor(() => expect(saveButton(container).disabled).toBe(false));
    await waitFor(() => expect(container.textContent).toContain("Unsaved changes"));

    flushSync(() => saveButton(container).click());
    await waitFor(() => expect(mockCompanyOrgPolicyApi.save).toHaveBeenCalledTimes(1));

    expect(mockCompanyOrgPolicyApi.save).toHaveBeenCalledWith("company-1", {
      expectedRevision: 3,
      content: "new text",
    });

    // The saved response, not the local draft, is what the page now shows.
    await waitFor(() => expect(container.textContent).toContain("Revision 4"));
    expect(editor(container).value).toBe("new text");
    expect(container.textContent).toContain("Saved");
    expect(container.textContent).not.toContain("Unsaved changes");
    expect(saveButton(container).disabled).toBe(true);

    flushSync(() => root.unmount());
  });

  it("keeps whitespace and line breaks through a save and reload", async () => {
    const markdown = "# Units\n\n  indented line  \n\n- metric\n- imperial\n";
    mockCompanyOrgPolicyApi.get.mockResolvedValue(policy({ content: markdown, revision: 1 }));
    mockCompanyOrgPolicyApi.save.mockImplementation((_companyId: string, input: { content: string }) =>
      Promise.resolve(policy({ content: input.content, revision: 2, updatedAt: null })),
    );
    const { root } = render(container);
    await waitFor(() => expect(editor(container)?.value).toBe(markdown));

    await typeInto(container, `${markdown}\ntrailing paragraph\n`);
    flushSync(() => saveButton(container).click());
    await waitFor(() => expect(mockCompanyOrgPolicyApi.save).toHaveBeenCalled());

    expect(mockCompanyOrgPolicyApi.save.mock.calls[0]![1].content).toBe(`${markdown}\ntrailing paragraph\n`);

    // A fresh page load reads the saved text back byte for byte.
    const reloadedContainer = document.createElement("div");
    document.body.appendChild(reloadedContainer);
    mockCompanyOrgPolicyApi.get.mockResolvedValue(
      policy({ content: `${markdown}\ntrailing paragraph\n`, revision: 2 }),
    );
    const { root: reloaded } = render(reloadedContainer);
    await waitFor(() => expect(editor(reloadedContainer)?.value).toBe(`${markdown}\ntrailing paragraph\n`));

    flushSync(() => reloaded.unmount());
    reloadedContainer.remove();
    flushSync(() => root.unmount());
  });

  it("surfaces a stale-revision refusal as an error rather than a save", async () => {
    mockCompanyOrgPolicyApi.get.mockResolvedValue(policy({ content: "old", revision: 3 }));
    mockCompanyOrgPolicyApi.save.mockRejectedValue(
      new ApiError("Organization policy revision is stale", 409, {
        code: "org_policy_revision_conflict",
        details: { expectedRevision: 3, currentRevision: 7 },
      }),
    );
    const { root } = render(container);
    await waitFor(() => expect(editor(container)?.value).toBe("old"));

    await typeInto(container, "mine");
    flushSync(() => saveButton(container).click());
    await waitFor(() => expect(container.textContent).toContain("Someone else saved the policy"));

    expect(container.textContent).not.toContain("Saved");
    expect(container.textContent).toContain("Unsaved changes");
    // The page keeps showing the revision it was working from, not the server's.
    expect(container.textContent).toContain("Revision 3");

    flushSync(() => root.unmount());
  });

  it("surfaces the size-cap refusal as an error", async () => {
    mockCompanyOrgPolicyApi.get.mockResolvedValue(policy({ content: "old", revision: 1 }));
    mockCompanyOrgPolicyApi.save.mockRejectedValue(
      new ApiError("Invalid organization policy document", 422, {
        code: "org_policy_validation_failed",
      }),
    );
    const { root } = render(container);
    await waitFor(() => expect(editor(container)?.value).toBe("old"));

    await typeInto(container, "too long");
    flushSync(() => saveButton(container).click());
    await waitFor(() => expect(container.textContent).toContain("20,000 characters"));

    flushSync(() => root.unmount());
  });

  it("surfaces a refused save for lack of administration access as an error", async () => {
    mockCompanyOrgPolicyApi.get.mockResolvedValue(policy({ content: "old", revision: 1 }));
    mockCompanyOrgPolicyApi.save.mockRejectedValue(
      new ApiError("Organization policy administration authority required", 403, {
        code: "org_policy_admin_required",
      }),
    );
    const { root } = render(container);
    await waitFor(() => expect(editor(container)?.value).toBe("old"));

    await typeInto(container, "mine");
    flushSync(() => saveButton(container).click());
    await waitFor(() => expect(container.textContent).toContain("administration access"));

    expect(container.textContent).not.toContain("Saved");

    flushSync(() => root.unmount());
  });

  it("reports a failed load instead of showing an editor", async () => {
    mockCompanyOrgPolicyApi.get.mockRejectedValue(new Error("Policy endpoint is down"));
    const { root } = render(container);
    await waitFor(() => expect(container.textContent).toContain("Policy endpoint is down"));

    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();

    flushSync(() => root.unmount());
  });

  it("sends the revision the draft was based on after a background refetch advances it", async () => {
    // Another operator saved revision 4 while this page held an unsaved edit to
    // revision 3. The draft survives the refetch, so the save must still carry
    // revision 3 and be refused rather than overwriting their edit.
    mockCompanyOrgPolicyApi.get.mockResolvedValue(policy({ content: "old", revision: 3 }));
    mockCompanyOrgPolicyApi.save.mockRejectedValue(
      new ApiError("Organization policy revision is stale", 409, {
        code: "org_policy_revision_conflict",
        details: { expectedRevision: 3, currentRevision: 4 },
      }),
    );
    const { root, queryClient } = render(container);
    await waitFor(() => expect(editor(container)?.value).toBe("old"));

    await typeInto(container, "mine");

    // A focus refetch delivers the other operator's revision 4 text. Wait for
    // the page to actually show it, otherwise this asserts nothing about the
    // state Save sees.
    mockCompanyOrgPolicyApi.get.mockResolvedValue(
      policy({ content: "their revision", revision: 4 }),
    );
    await queryClient.refetchQueries({ queryKey: ["org-policy", "company-1"] });
    await waitFor(() => expect(container.textContent).toContain("Revision 4"));
    expect(editor(container)?.value).toBe("mine");

    flushSync(() => saveButton(container).click());
    await waitFor(() => expect(mockCompanyOrgPolicyApi.save).toHaveBeenCalledTimes(1));

    expect(mockCompanyOrgPolicyApi.save).toHaveBeenCalledWith("company-1", {
      expectedRevision: 3,
      content: "mine",
    });
    await waitFor(() => expect(container.textContent).toContain("Someone else saved the policy"));
    expect(container.textContent).toContain("Unsaved changes");

    flushSync(() => root.unmount());
  });

  it("does not carry a dirty draft for one company into another company's save", async () => {
    mockCompanyOrgPolicyApi.get.mockImplementation((companyId: string) =>
      Promise.resolve(
        companyId === "company-1"
          ? policy({ content: "company one rules", revision: 3 })
          : { ...policy({ content: "company two rules", revision: 1 }), companyId: "company-2" },
      ),
    );
    mockCompanyOrgPolicyApi.save.mockResolvedValue(
      { ...policy({ content: "company one rules edited", revision: 4 }), companyId: "company-1" },
    );
    const { root } = render(container);
    await waitFor(() => expect(editor(container)?.value).toBe("company one rules"));

    await typeInto(container, "company one rules edited");

    // Switch companies without unmounting the page.
    switchCompany("company-2");
    await waitFor(() => expect(editor(container)?.value).toBe("company two rules"));
    expect(saveButton(container).disabled).toBe(true);

    // Company A's text must not reappear, and a save on B must carry B.
    await typeInto(container, "company two rules edited");
    flushSync(() => saveButton(container).click());
    await waitFor(() => expect(mockCompanyOrgPolicyApi.save).toHaveBeenCalledTimes(1));

    expect(mockCompanyOrgPolicyApi.save).toHaveBeenCalledWith("company-2", {
      expectedRevision: 1,
      content: "company two rules edited",
    });

    flushSync(() => root.unmount());
  });

  it("advances the draft revision after a save that landed under a newer edit", async () => {
    // The operator edits again while revision 3 is still in flight. That save
    // lands as revision 4 carrying the older text, and the newer text stays in
    // the editor. The next save must carry revision 4 or it is refused forever.
    mockCompanyOrgPolicyApi.get.mockResolvedValue(policy({ content: "old", revision: 3 }));
    let resolveSave: ((value: CompanyOrgPolicy) => void) | null = null;
    mockCompanyOrgPolicyApi.save.mockImplementation(
      () => new Promise<CompanyOrgPolicy>((resolve) => {
        resolveSave = resolve;
      }),
    );
    const { root } = render(container);
    await waitFor(() => expect(editor(container)?.value).toBe("old"));

    await typeInto(container, "second draft");
    flushSync(() => saveButton(container).click());
    await waitFor(() => expect(mockCompanyOrgPolicyApi.save).toHaveBeenCalledTimes(1));

    // Typed after the request went out, so it is not what revision 4 will hold.
    await typeInto(container, "third draft");
    resolveSave!(policy({ content: "second draft", revision: 4, updatedAt: null }));
    await waitFor(() => expect(container.textContent).toContain("Revision 4"));

    // The newer text survives; the save that landed did not overwrite it.
    expect(editor(container).value).toBe("third draft");
    expect(container.textContent).toContain("Unsaved changes");

    flushSync(() => saveButton(container).click());
    await waitFor(() => expect(mockCompanyOrgPolicyApi.save).toHaveBeenCalledTimes(2));

    expect(mockCompanyOrgPolicyApi.save.mock.calls[1]).toEqual([
      "company-1",
      { expectedRevision: 4, content: "third draft" },
    ]);

    flushSync(() => root.unmount());
  });

  it("does not carry a revision across a company switch during a pending save", async () => {
    mockCompanyOrgPolicyApi.get.mockImplementation((companyId: string) =>
      Promise.resolve(
        companyId === "company-1"
          ? policy({ content: "company one rules", revision: 3 })
          : { ...policy({ content: "company two rules", revision: 1 }), companyId: "company-2" },
      ),
    );
    let resolveSave: ((value: CompanyOrgPolicy) => void) | null = null;
    mockCompanyOrgPolicyApi.save.mockImplementation(
      () => new Promise<CompanyOrgPolicy>((resolve) => {
        resolveSave = resolve;
      }),
    );
    const { root, queryClient } = render(container);
    await waitFor(() => expect(editor(container)?.value).toBe("company one rules"));

    await typeInto(container, "company one rules edited");
    flushSync(() => saveButton(container).click());
    await waitFor(() => expect(mockCompanyOrgPolicyApi.save).toHaveBeenCalledTimes(1));

    switchCompany("company-2");
    await waitFor(() =>
      expect(queryClient.getQueryData(["org-policy", "company-2"])).toMatchObject({
        companyId: "company-2",
        revision: 1,
      }),
    );
    await typeInto(container, "company two rules edited");
    resolveSave!({ ...policy({ content: "company one rules edited", revision: 4 }), companyId: "company-1" });
    await flush();

    // Company B's draft is untouched by company A's landing save, so its own
    // revision 1 baseline is still what a save of B must carry.
    flushSync(() => saveButton(container).click());
    await waitFor(() => expect(mockCompanyOrgPolicyApi.save).toHaveBeenCalledTimes(2));

    expect(mockCompanyOrgPolicyApi.save.mock.calls[1]).toEqual([
      "company-2",
      { expectedRevision: 1, content: "company two rules edited" },
    ]);

    flushSync(() => root.unmount());
  });

  it("writes a successful save back to the company the save was issued for, not the selected one", async () => {
    mockCompanyOrgPolicyApi.get.mockImplementation((companyId: string) =>
      Promise.resolve(
        companyId === "company-1"
          ? policy({ content: "company one rules", revision: 3 })
          : { ...policy({ content: "company two rules", revision: 1 }), companyId: "company-2" },
      ),
    );
    let resolveSave: ((value: CompanyOrgPolicy) => void) | null = null;
    mockCompanyOrgPolicyApi.save.mockImplementation(
      () => new Promise<CompanyOrgPolicy>((resolve) => {
        resolveSave = resolve;
      }),
    );
    const { root, queryClient } = render(container);
    await waitFor(() => expect(editor(container)?.value).toBe("company one rules"));

    await typeInto(container, "edited for company one");
    flushSync(() => saveButton(container).click());
    await waitFor(() => expect(mockCompanyOrgPolicyApi.save).toHaveBeenCalledTimes(1));

    // The response lands after the operator has moved to another company. Wait
    // for company B's own cache entry first, otherwise there is nothing there
    // for a misdirected write to corrupt and the assertion cannot fail.
    switchCompany("company-2");
    await waitFor(() =>
      expect(queryClient.getQueryData(["org-policy", "company-2"])).toMatchObject({
        companyId: "company-2",
        revision: 1,
      }),
    );
    resolveSave!({ ...policy({ content: "edited for company one", revision: 4 }), companyId: "company-1" });
    await flush();

    // Company A's cache holds its own saved revision, not the selected company's.
    expect(queryClient.getQueryData(["org-policy", "company-1"])).toMatchObject({
      companyId: "company-1",
      revision: 4,
    });
    expect(queryClient.getQueryData(["org-policy", "company-2"])).toMatchObject({
      companyId: "company-2",
      revision: 1,
      content: "company two rules",
    });

    flushSync(() => root.unmount());
  });
});