# Organization policy

A company writes one Markdown policy. Every agent run in that company receives
that text in its prompt, on every run, including a run that resumes an older
conversation. The text is standing instruction to the model. The server does
not enforce it.

## What the server does and does not do

The policy is an instruction to the model. The server never evaluates the text
and blocks nothing on it. An agent that ignores the policy still completes its
run.

Allow and deny enforcement lives in a different feature, the company skill
policy. Its evaluator decides whether a skill operation is allowed and returns
`skill_policy_denied` from the skill mutation routes
(`server/src/routes/company-skills.ts:143`). The organization policy is not
consulted there, and a rule written in it cannot deny an operation. A company
that needs something blocked must express it in the skill policy.

## Precedence

A run receives instructions from several sources. The wrapper states the
following order to the model:

1. platform, host, and security constraints
2. the organization policy
3. the agent's own instructions
4. task and comment instructions

The policy does not outrank platform, host, or security rules, and the wrapper
says so. Those are not the company's to give. None of this is checked by the
server. The order is instruction the model is asked to follow, and it holds only
as far as the model follows it.

Where the policy physically lands in an assembled prompt is narrower than the
order above. It is prepended inside the wake prompt carrier, and the wake
carrier is placed ahead of the task context carrier
(`packages/adapter-utils/src/server-utils.ts:2238`,
`packages/adapters/gemini-local/src/server/execute.ts:573`). So the policy always
reaches the model before the task and comment instructions. Where an adapter
places the agent's own instruction block relative to the wake carrier varies by
adapter and is not something this feature controls.

## How the text is assembled

The renderer owns the wording around the policy. A person editing the policy
cannot change any of it. The section reads as a fixed heading, then a fixed
paragraph stating that the agent is working as part of an organization and that
the text is standing instruction, then a fixed paragraph stating the
precedence above, then a fixed line naming the save endpoint and its request
shape, then the person's policy text as data.

Because the body arrives after the wrapper as data, a policy body that imitates
wrapper instructions cannot move a single character of it
(`packages/adapter-utils/src/server-utils.ts:2272`).

The renderer omits the whole section when the policy text is missing, empty, or
whitespace only (`packages/adapter-utils/src/server-utils.ts:2302`). A company
that has never saved a policy gets a prompt identical to the one it got before
this feature existed.

The delivered body is the stored text byte for byte, including leading
indentation and a trailing newline, because a policy that opens with an
indented Markdown block means something different from the same text unindented.
The trim is used only to decide whether a section exists at all
(`packages/adapter-utils/src/server-utils.ts:2295`).

Chat runs build a prompt through the same function as task runs, so the policy
lands in both without a separate path.

## Delivery

The server reads the policy once per run, while the run is being assembled, next
to where connector skills are already resolved
(`server/src/services/heartbeat.ts:21476`). There is no cache, so a saved
change takes effect on the next run without a restart. A run already in flight
keeps the policy it started with, because nothing re-reads it mid-run.

The policy is a runtime-only field on the object handed to the agent. It is
never written back onto the run's persisted context snapshot, so the text does
not accumulate in run history (`server/src/services/heartbeat.ts:21472`,
asserted by `server/src/__tests__/heartbeat-org-policy-attachment.test.ts:209`).

A run that resumes an older conversation receives the current policy again, not
the text that was current when the conversation started. The task markdown is
shrunk on a resumed run on purpose. The policy is not part of it and is never
shrunk.

## Delivery by adapter

The shared renderer puts the policy in the wake prompt carrier, so every
adapter that assembles a model prompt from `selectPaperclipPromptSections`
delivers it. Three adapters do not, and each says so rather than pretending:

- **pi-local** delivers it in the system extension after the individual
  agent's own instructions, because it loads those instructions into the
  system channel, where the lower user prompt would rank below them
  (`packages/adapters/pi-local/src/server/execute.ts:637`).
- **claude-local** puts the agent's instructions in
  `--append-system-prompt-file`, but deliberately does not re-send that file on
  a resumed session, so the policy reaches the model through the user prompt on
  exactly the turns when the agent's instructions are already cached in the
  session. The two never compete on the same turn. Changing that would change
  Claude's session-cache identity, which is a separate decision.
- **process** launches an arbitrary configured command, which has no way to
  read a prompt. Delivery is opt-in: set `stdinPrompt` (alias `stdin`) and
  Paperclip writes the rendered policy to the child's stdin and closes the
  stream. With the option off, the child receives nothing,
  `PAPERCLIP_ORG_POLICY_DELIVERY` is `disabled`, and the run log states in
  words that the policy was not delivered
  (`server/src/adapters/process/execute.ts:41`).

The HTTP adapter forwards the raw run context to the configured endpoint,
including `paperclipOrgPolicy`, and renders no model prompt of its own. A
receiver that wants a policy reads that field.

## The native lane

The native execution path builds a smaller context from the task markdown and
the wake data instead of receiving the run context, so a field on the run
context does not reach it. The native input constructor therefore takes the
policy as an explicit argument and passes it into the shared renderer
(`server/src/services/native-runtime/native-execution-input.ts:51`).

Any future execution lane that rebuilds its own context will miss the policy
silently. Such a lane must pass it explicitly, the way the native path does.

A resumed native turn does not always send the full task prompt. When the wake
carries a matching resume delta, the runner sends a compact continuation
instead, and that envelope replaces the bootstrap prompt entirely. The
rendered policy therefore rides on the continuation as an
`organizationPolicy` field beside the new events
(`server/src/services/native-runtime/native-continuation.ts:72`), so a policy
change reaches a retained provider session rather than only the session that
started under the old text.

## Limits

The policy is capped at 20,000 characters, the same ceiling this codebase
applies to other long text fields
(`packages/shared/src/validators/company-org-policy.ts:7`). A longer policy is
refused with `422` and code `org_policy_validation_failed`.

The cap is a per-run token cost, not a storage limit. Every run of every agent
in the company pays the full policy text plus the fixed wrapper, for as long as
the policy is saved. A company that saves the full 20,000 characters pays that
cost on every run.

One row exists per company, holding the content, a revision integer, and
timestamps. The row cascades away when the company is deleted. A missing row
and an empty row behave identically: both read as no policy, and neither
injects anything. Saving empty content keeps the row and still increments the
revision, so the revision counts every save.

The policy is not carried by company export or import. Neither service
references it, the same as the company skill policy.

## Saving the policy

- `GET /api/companies/:companyId/org-policy` returns the content, the revision,
  and the last-updated time. A company with no policy reads as empty content
  with revision 0 rather than as an error.
- `PUT /api/companies/:companyId/org-policy` replaces the policy. The body
  carries `expectedRevision` and `content`.

Reading and writing need company access, and nothing else. An agent key from
another company is refused before the membership check
(`server/src/routes/company-org-policy.ts:39`). Writing carries no separate
administration grant: every authenticated principal of the company may save,
board or agent. The policy is not a privilege boundary inside one company, and
an administration permission would be one an agent could never be given, which
would make the agent side of the feature unusable.

A save whose `expectedRevision` does not match the stored revision is refused
with `409` and code `org_policy_revision_conflict`, so a concurrent edit is not
silently overwritten. This is the same rule the company skill policy uses.

Every save writes an activity record with action `company.org_policy_saved`. The
record carries the previous revision, the new revision, and the content length.
It does not carry the policy body
(`server/src/services/company-org-policy.ts:88`).

## The page

The page lives at `/org-policy` and is linked from the organization section of
the sidebar, in both the streamlined layout and the older one
(`ui/src/components/Sidebar.tsx:246`, `ui/src/components/Sidebar.tsx:270`).

It shows the revision and the last-updated time, a plain monospaced text area,
and a save button. The Markdown is stored and delivered exactly as typed, so
there is no rich text editor: anything a formatting layer rewrote would be a
bug. The page states that the policy overrides each agent's own instructions,
that every run receives it including resumed runs, that it costs context on
every run, and that the server does not enforce it
(`ui/src/pages/CompanyOrgPolicy.tsx:121`).

## Where the pieces live

- `packages/db/src/schema/company_org_policies.ts`: the one-row-per-company
  table.
- `packages/shared/src/validators/company-org-policy.ts`: the character cap and
  the request schemas.
- `server/src/services/company-org-policy.ts`: read, save, revision conflict,
  audit record.
- `server/src/routes/company-org-policy.ts`: the two endpoints and the
  authorization rules.
- `packages/adapter-utils/src/server-utils.ts`: the shared renderer, the only
  place the wrapper text lives.
- `server/src/services/heartbeat.ts`: the per-run read and the attachment to
  the agent-facing context.