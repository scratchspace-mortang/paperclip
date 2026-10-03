# RECONSTRUCTED.md

This tree is a recovery, not the original work. Every file on the branch
`fix/preserve-literal-backslash-n-in-text` was rebuilt from the recovered Hermes
transcript. Nothing here is the original bytes, with one exception noted below.

Built by the worker for kanban card `t_8ff0149a` on 2026-10-03.

## Which paperclip this is

The patched tree's upstream is the fork `mortang2410/paperclip`. The public
upstream is `paperclipai/paperclip`. They are not the same repository, and the
sentinel string `paperclipOrgPolicy` exists in neither remote's history. Any
claim about "the paperclip" must say which of the two.

## The sentinel

Judged by the string `paperclipOrgPolicy`, never by a commit id, because the
commit ids are gone.

```
git grep -n paperclipOrgPolicy fix/preserve-literal-backslash-n-in-text
```

It is present in 16 places on the branch. The one that matters is:

```
server/src/services/native-runtime/native-execution-input.ts:170
```

which is the line position the transcript recorded. It is absent at the base.

The recorded value of that line was `paperclipOrgPolicy: input.orgPolicy`. The
rebuilt line reads `paperclipOrgPolicy: undefined`. Both states exist in the
transcript, and the rebuild lands on the later one. The patch that changed it is
recorded at message 209281, timestamp 2026-09-30 15:19:39, and it was a
deliberate edit, not a corruption.

## What is verbatim

One branch only, and it is a different branch from the sentinel one.

`fix/issue-interaction-presentation-update` was recovered byte-for-byte from
upstream pull request 14598 on `paperclipai/paperclip`. Its three commits are
`1ede672f6`, `c6a310f3a`, `eb3dc18f7`, and the combined diffstat is 18 files,
842 insertions, 93 deletions, which matches the pull request metadata exactly.
Nothing on that branch was reconstructed.

## What is reconstructed

Everything on `fix/preserve-literal-backslash-n-in-text`. Nine commits, one per
recorded hash, each commit message naming the hash it stands for.

Recovery used two sources, both read-only:

- `~/.hermes/backups/recovery-20261002-230708/state.recovered.db`, opened
  `mode=ro immutable=1`, never written to.
- `~/.hermes/state/home-recovery/survey-t_998f0c3e/context-paperclip.txt`, the
  decoded transcript the parent card produced.

Two recovery grades were used per file:

- **verbatim** means a whole-file `read_file` result survives untruncated. The
  file is that read, minus the display line numbers.
- **replayed** means a whole-file read survives and recorded `patch` deltas were
  applied in row order to reach the later state. Every patch that did not apply
  is reported; the count per file is below.

Per-commit file lists, as built:

| recorded hash | message | files |
|---|---|---|
| `775b676d3` | store and serve the company org-wide policy | 5 recovered, 7 unrecovered |
| `ca2570424` | render the org policy into every agent prompt | 1 recovered, 2 unrecovered |
| `1b9735b02` | org policy page and sidebar links | 5 recovered, 3 unrecovered |
| `bca06939e` | read the org policy once per run | 1 recovered, 1 unrecovered |
| `8d751dbba` | tell the agent it is working for an organization | 1 recovered, 1 unrecovered |
| `116836a83` | carry the org policy through the native execution path | 2 recovered, 1 unrecovered |
| `0721af392` | tighten the native call-site comment | 0 recovered, empty commit on purpose |
| `dc0740014` | document the org-wide policy and its precedence | 1 recovered |
| `5990bb74f` | append the org policy contract as 9.12 | 0 recovered, empty commit on purpose |

Recovered files, with the grade and the patch arithmetic:

```
verbatim   server/src/routes/index.ts                                   2191B  0 patches
verbatim   server/src/__tests__/heartbeat-org-policy-attachment.test.ts  8375B  0 patches
verbatim   packages/shared/src/validators/company-org-policy.test.ts     1971B  0 patches
replayed   server/src/services/company-org-policy.ts                    3721B  1 patch,  0 missed
replayed   server/src/routes/company-org-policy.ts                      2271B  5 patches, 0 missed
replayed   packages/shared/src/validators/company-org-policy.ts         1575B  1 patch,  0 missed
replayed   packages/adapter-utils/src/org-policy-prompt.test.ts         5141B  4 patches, 3 MISSED
replayed   packages/adapters/gemini-local/src/server/execute.org-policy.test.ts  3451B  2 patches, 3 MISSED
replayed   ui/src/pages/CompanyOrgPolicy.tsx                            9139B  9 patches, 0 missed
replayed   ui/src/pages/CompanyOrgPolicy.test.tsx                      20383B  1 patch,  0 missed
replayed   ui/src/components/Sidebar.test.tsx                          22469B  2 patches, 0 missed
replayed   ui/src/lib/queryKeys.ts                                     30972B  2 patches, 0 missed
replayed   ui/src/App.tsx                                               43400B  3 patches, 2 MISSED
replayed   server/src/services/native-runtime/native-execution-input.ts 14246B  5 patches, 0 missed
replayed   server/src/services/native-runtime/native-execution-input.test.ts  31177B  4 patches, 0 missed
replayed   doc/ORG-POLICY.md                                           10565B  6 patches, 2 MISSED
```

A file marked MISSED had recorded patches whose `old_string` was not found in
the recorded base read. Those files are the least trustworthy here and are
called out again under gaps.

## What is missing, and why it matters

Twelve paths have no whole-file read anywhere in the transcript. Eight more have
only paginated reads. That is 20 of the 37 candidate paths, and the missing set
is not random: it is almost entirely the implementation, with the tests
recovered.

The single most damaging gap:

```
packages/adapter-utils/src/org-policy-prompt.ts    NO whole-file read exists
```

This is the module that defines the renderer. The sentinel on
`native-execution-input.ts:170` is an argument passed to it, and
`native-execution-input.ts:208` calls `renderPaperclipOrgPolicyPrompt`. So the
rebuilt tree contains the caller and the argument and not the callee. The
sentinel string is present and the feature is not runnable.

This confirms, from measurement rather than from memory, what a canonical memory
slot recorded about the earlier 2026-10-01 attempt: that attempt committed test
files whose implementation source was never captured.

The other unrecovered paths:

```
gap   server/src/app.ts
gap   server/src/__tests__/company-org-policy-service.test.ts
gap   server/src/__tests__/routines-service.test.ts
gap   server/src/__tests__/built-in-agents.test.ts
gap   server/src/services/routines.ts
gap   packages/db/src/schema/company-org-policies.ts
gap   packages/db/src/schema/index.ts
gap   packages/db/drizzle/0287_org_policy.sql
gap   packages/db/drizzle/meta/0287_snapshot.json
gap   ui/src/api/companyOrgPolicy.ts
gap   ui/src/App.org-policy-routing.test.tsx
gap   packages/adapter-utils/src/org-policy-prompt.ts

truncated-only  server/src/services/heartbeat.ts
truncated-only  server/src/__tests__/heartbeat-process-recovery.test.ts
truncated-only  server/src/__tests__/company-org-policy-routes.test.ts
truncated-only  server/src/services/built-in-agents.ts
truncated-only  packages/adapter-utils/src/server-utils.ts
truncated-only  ui/src/components/Sidebar.tsx
truncated-only  packages/adapters/gemini-local/src/server/execute.ts
truncated-only  doc/SPEC-implementation.md
```

Note what that list contains: the database schema file, the migration, the
service that reads the policy per run, the prompt renderer, and the spec section
that is the branch's whole contract. `heartbeat.ts` is the call site the chief
implementer had to apply by hand.

## The base is substituted

The recorded savepoint is `629187dda`. It does not exist in the fork
`mortang2410/paperclip` and it does not exist in upstream
`paperclipai/paperclip`. Probed both remotes directly.

The branch therefore sits on fork master `b3eb03fcb`. This is a substitution, not
a match, and it is not evidence the two trees agreed. One file comparison shows
they did not: the recovered pre-patch read of `native-execution-input.ts` is
13561 bytes against 13695 at fork master, differing by a `codexReasoningEffort`
field the fork has and the recovered base read does not. So fork master is
slightly ahead of the recorded savepoint, and the branch is built on top of
code the original work never saw.

## The branch is larger than nine commits

The transcript records a later coordinator handoff naming branch tip
`3f989921c` and "fifteen commits above the savepoint": the same nine plus six
round-1 critic fixes:

```
dfdefff46  F1  pass the read org policy to the native execution input
e233f9141  F7  deliver the org policy body verbatim
66bd1c953  F2  carry the org policy on the native compact continuation
dbbd2be94  F3+F4  bind draft, revision and save to one company
fefd4b06b  F5  give the org policy Pi's system channel
3f989921c  F6  give the process adapter a real policy delivery contract
```

The card asked for nine. The six fixes are a separate piece of work and are not
built here. `e233f9141` and `dfdefff46` are named in the card as having unknown
parentage relative to `5990bb74f`, and this handoff places them after it, which
is the strongest parentage evidence the transcript holds, but it is still
transcript prose rather than a parent hash.

Note that the sentinel value on the rebuilt branch, `undefined`, matches what a
F1-class fix removes. The `undefined` state is the post-review shape, not the
`116836a83` shape the card quotes.

## Not attempted, deliberately

- No Paperclip server was started, stopped, or rebuilt into
  `~/.paperclip/cli/current/`. There is no `~/.paperclip/cli/current/` on this
  host now, so the recording worker's criterion of comparing `server/dist/`
  against the serving copy cannot be run at all.
- `vq.mjs` was never written. It held a Postgres credential, was never
  committed, and is named in the transcript as needing rotation.
- The four temporary probe files from the ticket 02 worker were not recreated.
- `fix/built-in-bundles-responsible-user` was not built. See
  `~/.hermes/state/home-recovery/clipmender/VERDICT-branch2-built-in-bundles.md`
  for why, including the correction it makes to the survey.

## Verdict in one line

The sentinel string is present and the feature is not: the caller and the
argument survive, the renderer they call does not, and the database schema the
policy would be stored in does not either.
