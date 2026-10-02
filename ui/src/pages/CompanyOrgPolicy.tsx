import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, ScrollText } from "lucide-react";
import type { CompanyOrgPolicy } from "@paperclipai/shared";
import { companyOrgPolicyApi } from "../api/companyOrgPolicy";
import { ApiError } from "../api/client";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { queryKeys } from "../lib/queryKeys";
import { formatDateTime } from "../lib/utils";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * Plain-language reasons a save was refused, keyed by the server's error code.
 * A stale revision is the one an operator has to act on, so it says what
 * happened and what to do: reload to pick up the other edit, then reapply.
 */
function saveErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return error instanceof Error ? error.message : "Could not save the policy.";
  }
  const body = error.body as { code?: string } | null;
  switch (body?.code) {
    case "org_policy_revision_conflict":
      return "Someone else saved the policy after you opened this page. Reload to get their version, then make your change again.";
    case "org_policy_validation_failed":
      return "The policy is longer than 20,000 characters. Shorten it and save again.";
    case "org_policy_admin_required":
      return "Saving the policy needs organization administration access. Ask an administrator to make this change.";
    default:
      return error.message;
  }
}

/**
 * An in-progress edit, paired with the company it belongs to and the revision
 * it was based on. Save sends that revision so a concurrent save is refused
 * instead of silently overwritten.
 */
type OrgPolicyDraft = {
  companyId: string;
  content: string;
  revision: number;
};

/**
 * The one Markdown policy every agent in this company is told on every run.
 * Plain textarea, no rich text editor: the text is stored and delivered
 * verbatim, so anything a formatting layer would rewrite is a bug.
 */
export function CompanyOrgPolicy() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  // The draft carries the company it belongs to and the revision it was based
  // on. Both are part of one value so a company switch or a background refetch
  // cannot leave a stale revision paired with an older draft.
  const [draft, setDraft] = useState<OrgPolicyDraft | null>(null);
  // The last content that came from (or was written to) the server, so a
  // background refetch can refresh the page without discarding a pending edit.
  const lastServerContentRef = useRef<{ companyId: string; content: string } | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Org-wide policy" }]);
  }, [setBreadcrumbs]);

  const policyQuery = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.orgPolicy.detail(selectedCompanyId)
      : ["org-policy", "__disabled__"],
    queryFn: () => companyOrgPolicyApi.get(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });
  const policy = policyQuery.data;

  useEffect(() => {
    if (!policy || !selectedCompanyId) return;
    const adopt = (content: string, revision: number): OrgPolicyDraft => ({
      companyId: selectedCompanyId,
      content,
      revision,
    });
    setDraft((current) => {
      // A draft for another company must never be saved into this one, so the
      // switch adopts this company's text instead of keeping the old draft.
      if (!current || current.companyId !== selectedCompanyId) {
        return adopt(policy.content, policy.revision);
      }
      const lastServer = lastServerContentRef.current;
      return lastServer?.companyId === selectedCompanyId && current.content === lastServer.content
        ? adopt(policy.content, policy.revision)
        : current;
    });
    lastServerContentRef.current = { companyId: selectedCompanyId, content: policy.content };
  }, [policy, selectedCompanyId]);

  const saveMutation = useMutation({
    // The company and revision are captured when Save is clicked, not read
    // afterwards: a switch or a refetch in between must not redirect this save.
    mutationFn: (submitted: OrgPolicyDraft) =>
      companyOrgPolicyApi.save(submitted.companyId, {
        expectedRevision: submitted.revision,
        content: submitted.content,
      }),
    onSuccess: (saved: CompanyOrgPolicy, submitted: OrgPolicyDraft) => {
      queryClient.setQueryData(queryKeys.orgPolicy.detail(submitted.companyId), saved);
      // The landing revision is the new baseline for any later edit of this
      // company, including an edit typed while the request was in flight. The
      // draft keeps its own text, which is the newer one, so pairing it with the
      // older revision is what makes its next save conflict forever. A draft
      // that has since moved to another company keeps that company's baseline.
      setDraft((current) =>
        current?.companyId === submitted.companyId && current.content === saved.content
          ? { ...current, revision: saved.revision }
          : current,
      );
    },
  });

  if (!selectedCompanyId) {
    return <div className="text-sm text-muted-foreground">Select an organization to edit its policy.</div>;
  }

  // A failed load has no draft to adopt, so the error branch comes first: on
  // this path the draft stays null and the skeleton would otherwise stand in
  // for an error that already happened.
  if (policyQuery.isError) {
    return (
      <div className="text-sm text-destructive">
        {policyQuery.error instanceof Error
          ? policyQuery.error.message
          : "Could not load the policy."}
      </div>
    );
  }

  // `draft === null` is the window between the query resolving and the effect
  // that adopts the server's text; there is nothing to edit yet.
  if (!policy || draft === null) {
    return <PageSkeleton variant="list" />;
  }

  // The draft is only comparable to a policy for its own company; the effect
  // above guarantees that by adopting on a switch, but a stale render could
  // still pair them, so treat another company as not dirty rather than dirty
  // against the wrong text.
  const isDirty = draft.companyId !== policy.companyId || draft.content !== policy.content;
  const updatedAt = policy.updatedAt ? formatDateTime(policy.updatedAt) : "Never saved";

  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex items-center gap-2">
        <ScrollText className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Org-wide policy</h1>
      </div>

      <div className="max-w-2xl space-y-1 text-sm text-muted-foreground">
        <p>
          Every agent run in this organization gets this Markdown text in its prompt.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>It overrides each agent&apos;s own instructions.</li>
          <li>Every run receives it, including runs that resume an old conversation.</li>
          <li>It uses context on every run, so keep it short.</li>
          <li>The server does not enforce it. It tells the model what to do, not what to block.</li>
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="font-mono">Revision {policy!.revision}</span>
        <span>Last updated {updatedAt}</span>
      </div>

      <Textarea
        aria-label="Organization policy"
        value={draft.content}
        onChange={(event) => {
          const content = event.target.value;
          setDraft((current) => (current ? { ...current, content } : current));
        }}
        className="min-h-(--sz-420px) w-full font-mono"
        placeholder="No policy yet. Write the rules every agent in this organization should follow."
      />

      {saveMutation.isError ? (
        <div
          role="alert"
          className="max-w-2xl rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {saveErrorMessage(saveMutation.error)}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-3">
        {isDirty ? (
          <span className="text-xs text-muted-foreground" role="status">Unsaved changes</span>
        ) : null}
        {saveMutation.isSuccess && !isDirty ? (
          <span className="text-xs text-muted-foreground" role="status">Saved</span>
        ) : null}
        <Button
          type="button"
          disabled={!isDirty || saveMutation.isPending}
          onClick={() => saveMutation.mutate(draft)}
        >
          {saveMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {saveMutation.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}