# AGENTS.md

## NestJS

This app's version of NestJS is likely newer than what you know. https://docs.nestjs.com/llms.txt indexes its documentation, with a markdown page per chapter.

Nest has first-party packages for these, so check them before adding another library or writing your own:

- Databases: [`@nestjs/typeorm`](https://docs.nestjs.com/data/typeorm.md), [`@nestjs/drizzle`](https://docs.nestjs.com/data/drizzle.md), [`@nestjs/mongoose`](https://docs.nestjs.com/data/mongodb.md), [`@nestjs/sequelize`](https://docs.nestjs.com/data/sequelize.md).
- OpenAPI: [`@nestjs/swagger`](https://docs.nestjs.com/openapi/introduction.md). GraphQL: [`@nestjs/graphql`](https://docs.nestjs.com/graphql/quick-start.md). WebSockets: [`@nestjs/websockets`](https://docs.nestjs.com/websockets/gateways.md). Microservices: [`@nestjs/microservices`](https://docs.nestjs.com/microservices/basics.md).
- Sign-in: [`@nestjs/authentication`](https://docs.nestjs.com/security/authentication.md). Permissions: [`@nestjs/authorization`](https://docs.nestjs.com/security/authorization.md). Rate limiting: [`@nestjs/throttler`](https://docs.nestjs.com/security/rate-limiting.md).
- Configuration: [`@nestjs/config`](https://docs.nestjs.com/application/configuration.md). Caching: [`@nestjs/cache-manager`](https://docs.nestjs.com/data/caching.md). Health checks: [`@nestjs/terminus`](https://docs.nestjs.com/reliability/terminus.md). Events inside the app: [`@nestjs/event-emitter`](https://docs.nestjs.com/application/events.md).
- Email: [`@nestjs/mail`](https://docs.nestjs.com/application/mail.md). Files, S3 included: [`@nestjs/storage`](https://docs.nestjs.com/application/file-storage.md). Translations: [`@nestjs/i18n`](https://docs.nestjs.com/application/i18n.md).
- Retries, timeouts and circuit breakers: [`@nestjs/resilience`](https://docs.nestjs.com/reliability/resilience.md).
- Idempotency keys: [`@nestjs/idempotency`](https://docs.nestjs.com/reliability/idempotency.md). Transactional outbox: [`@nestjs/outbox`](https://docs.nestjs.com/reliability/outbox.md). Sending and receiving webhooks: [`@nestjs/webhooks`](https://docs.nestjs.com/http/webhooks.md).
- Queues: [`@nestjs/bullmq`](https://docs.nestjs.com/application/queues.md). Scheduled jobs: [`@nestjs/schedule`](https://docs.nestjs.com/application/task-scheduling.md).
- Running a scheduled job on one instance, and locks: [`@nestjs/locks`](https://docs.nestjs.com/reliability/locks.md). Processes that take days: [`@nestjs/workflows`](https://docs.nestjs.com/reliability/workflows.md).
- Language models, tools and agents: [`@nestjs/ai`](https://docs.nestjs.com/ai/overview.md). MCP servers: [`@nestjs/mcp`](https://docs.nestjs.com/mcp/overview.md).

Validation works with Zod, Valibot, ArkType or any other Standard Schema library, with no classes or decorator metadata: `StandardSchemaValidationPipe` with `@Body({ schema })` or `@Param('id', { schema })` (https://docs.nestjs.com/application/validation.md). `class-validator` still works, through `ValidationPipe`.

`NodeAdapter` from `@nestjs/platform-node` is the fastest HTTP adapter, ahead of Fastify (https://docs.nestjs.com/http/performance.md).

Nest's packages are ESM only, and this project is ESM too: relative imports end in `.js`, `__dirname` doesn't exist (use `import.meta.dirname`), and tests run on Vitest, so mocks are `vi.fn()`, not `jest.fn()`.

## Production data: NestJS Observe

This app's production telemetry - traces, errors, logs and metrics - goes to [NestJS Observe](https://observe.nestjs.com). Until `ObserveModule` is registered in `src/app.module.ts`, nothing is sent: `npx @nestjs/observe link` sets it up in one step - it installs `@nestjs/observe`, wires it into the app, and writes the key pair (`OBSERVE_APP_KEY`, `OBSERVE_APP_SECRET`) to `.env`.

When a task depends on how the app behaves in production - an error users hit, a slow endpoint, a failing job, whether a release made things worse - work from that data, not from the code alone:

- The Observe MCP server answers those questions directly: errors with their traces and logs, slow operations, jobs, and what a release changed (`find_regressions`, `diff_release`). It is included on the Pro plan and above. In Claude Code: `claude mcp add observe --transport http https://observe-api.nestjs.com/mcp`, and the client opens a browser to approve. Other clients: https://www.observe.nestjs.com/documentation/mcp
- Without it, the user can open the request or error in the Observe dashboard and click **Copy agent prompt**, which hands over that page's trace, stack and logs as text.




## 4. Safety guardrails (always on)

### Scope and permissions
- Work only on the approved ticket. No drive-by refactors, dependency upgrades or unrelated fixes; raise them as new tickets.
- **Do not modify any file inside `docs/` without explicit permission from the human owner.**
- Do not change CI, deployment, secrets configuration or permissions definitions unless the ticket says so.
- Never disable, skip or weaken a test, lint rule, boundary rule, CI check, or security control to make something pass.

### Destructive and irreversible actions (forbidden without explicit human approval)
- `git push --force`, `git reset --hard` on shared branches, history rewrites, deleting remote branches you do not own
- Dropping or truncating tables, editing merged migrations, deleting data, or running anything against staging/production databases
- Deleting files outside your ticket's scope
- Installing global packages or changing machine/system configuration

### Secrets and data
- Never commit, print or log secrets, tokens, OTP codes, passwords, Gmail credentials or personal data. Use environment variables validated by the config schema.
- Use synthetic data only. Never use or copy a production dump.
- If you find a committed secret, stop, tell the human, and do not try to hide it in history yourself.

### Project architecture rules (from TAD.md / SAD.md / FSD.md)
- Every controller handler declares `@RequirePermission()` or `@Public()`.
- Organization id comes from the session only; it is a required repository argument.
- Multi-step operations use one `transactionService.run()`; audit rows are written in the same transaction; no email or network call inside a transaction.
- Out-of-scope records return 404; use the exact error codes in FSD.md section 3.
- Modules import only other modules' exported facades. `forwardRef` is banned.
- No raw SQL string concatenation; parameterized queries only.
- Responses use explicit DTOs; never return entities, hashes or tokens.
- Migrations are plain SQL, backward compatible, never run on app start.
- Frontend: no tokens in browser storage; no `dangerouslySetInnerHTML` on user content; dark mode must pass axe contrast.

### Official UI & Brand Theme rules (`docs/ui/Bistech_brand_theme.md` & `docs/ui/mock/`)
- **Mandatory reference**: Before creating or modifying any UI page, layout, or component, read and strictly follow `docs/ui/Bistech_brand_theme.md` and inspect the HTML mockups in `docs/ui/mock/` (`overview-dashboard.html`, `attendance_dashboard.html`, etc.) as visual and structural inspiration.
- **Official Color Palette**: Use the BisTech Deep Dark Mode palette (`--color-bg: #0B0F0E`, `--color-bg-secondary: #131A17`) paired with Sea Green brand accents (`--color-primary: #2E8B57`, `--color-primary-light: #4CAF7D`, `--color-primary-dark: #1F5C3A`). Never use arbitrary off-brand primary colors.
- **Official Typography**: Configure and use `Space Grotesk` for headings (with tight letter-spacing `-0.02em`) and `Inter` for body text via `next/font/google`.
- **Motion & Animation (`framer-motion`)**: Use `framer-motion` for UI transitions and micro-interactions. Animations must remain very simple, subtle, lightweight, and eye-pleasing—never heavy or distracting for a daily office environment, and must respect `prefers-reduced-motion`.

### Honesty and verification
- Run the ticket's tests and the full CI checks locally before opening a PR. Report real results; never claim a test passed if it was not run.
- If something cannot be verified (e.g. no network, missing credentials), say so in the PR.
- State assumptions explicitly in the PR description (with Q-id where relevant).
- When unsure, ask. Stopping to ask is always acceptable; guessing on security, data or permissions is not.

---

## 5. Git rules

### Branches
- **Never edit files or commit directly on `main` or `dev`.**
- **Mandatory Pre-Edit Branch Check:** Before modifying or creating any file for a task, the agent MUST run `git branch --show-current`.
  - If the current branch is `main`, `dev`, or an unrelated branch, stop and create a new branch off the latest `dev` first:
    1. `git switch dev && git pull origin dev`
    2. `git switch -c <type>/<ticket-id>-<short-kebab-description>` (or `<type>/<short-kebab-description>` if no ticket ID is given)
  - Only start editing files after `git branch --show-current` confirms you are on the new `feat/*` or `fix/*` branch.
- **Branch naming:** `<type>/<ticket-id>-<short-kebab-description>`, e.g. `feat/F-041-task-creation`, `fix/F-044-review-race`.
- **Target branch:** All `feat/*` and `fix/*` branches are created from `dev` and must open Pull Requests targeting `dev` (never `main`).
- One ticket = one branch = one PR. Keep PRs small; split a ticket that is too large (after asking).
- Sync `dev` into your branch regularly (`git fetch origin && git merge origin/dev`); resolve conflicts without discarding others' changes.

### Commits: Conventional Commits (mandatory)

Format:

```
<type>(<scope>): <subject>

<body, optional>

<footer, optional>
```

**Types**

| Type | Use for |
|---|---|
| `feat` | New feature or behaviour |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, no logic change |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf` | Performance improvement |
| `test` | Adding or fixing tests |
| `build` | Build system, dependencies, packaging |
| `ci` | CI/CD configuration |
| `chore` | Maintenance not touching src or tests |
| `revert` | Reverts a previous commit |

**Scopes** (use the module or area): `identity`, `organization`, `employees`, `attendance`, `teams`, `tasks`, `feedback`, `notifications`, `dashboard`, `audit`, `platform`, `db`, `queue`, `email`, `contracts`, `web`, `ci`, `deps`.

**Rules**
1. Subject: imperative mood, lower-case start, no trailing period, **72 characters or fewer** ("add", not "added" or "adds").
2. Body (when the why is not obvious): wrap at 100 characters; explain what and why, not how.
3. Footer: always reference the ticket: `Refs: F-041`. Use `Closes: F-041` only in the final commit of the ticket.
4. Breaking change: add `!` after the type/scope and a footer `BREAKING CHANGE: <description>`.
5. Add the author as a trailer: `Agent: <agent-name>`.
6. One logical change per commit. Do not mix a feature with unrelated formatting or refactors.
7. Tests for a change go in the same commit or the immediately following `test` commit on the same branch.
8. Migrations get their own commit: `feat(db): add task_assignments table`.

**Examples**

```
feat(tasks): fan out team task to one assignment per member

Create one task_assignments row per active team member inside the
task creation transaction and emit task.assigned after commit.

Refs: F-041
Agent: agent-1
```

```
fix(attendance): exclude holidays from derived absence

Refs: F-031
Agent: agent-1
```

```
test(identity): cover otp attempt exhaustion

Refs: F-015
Agent: agent-2
```

```
feat(contracts)!: rename task status in_review to under_review

BREAKING CHANGE: API enum value in_review is now under_review.

Refs: F-042
Agent: agent-1
```

**Invalid** (reject in review): `update stuff`, `WIP`, `Fixed bug.`, `feat: Added task stuff` (past tense, vague), commits without type or ticket reference.

### Commit hygiene
- Never commit secrets, `.env` files, build output, large binaries, or generated files that are not tracked by convention.
- Do not bypass hooks (`--no-verify`) or signing requirements.
- Commit locally often; push at each meaningful checkpoint so the claim and work are visible.
- Never force-push a branch someone else has pulled; never force-push `main`.
- Do not amend or rebase commits that have been reviewed without telling the reviewer.

### Pull requests
- Title follows Conventional Commits: `feat(tasks): task creation with team fan-out (F-041)`.
- Description includes: ticket ID, what changed, how it was tested (commands and results), acceptance criteria checklist copied from FTL.md and ticked, assumptions/Q-ids, risks.
- CI must be green. The PR needs approval from someone other than the author.
- Merge strategy: squash-merge with a Conventional Commit message, so history stays readable. The squash message must keep the `Refs`/`Closes` footer.
- After merge: update `CLAIMS.md` to `done`, delete the branch, and ask the human before starting the next ticket.

---

## 6. Pre-PR checklist (every ticket)

- [ ] I asked and received approval before starting (section 2)
- [ ] Ticket is claimed only by me; no overlapping branch or file conflict (section 3)
- [ ] All FTL.md checklist items and acceptance criteria for the ticket are met
- [ ] Listed tests (T-xx) exist and pass locally; full CI green
- [ ] No secrets, personal data or debug output committed
- [ ] Every handler has `@RequirePermission()` or `@Public()`; org id from session only
- [ ] All UI work adheres to the official BisTech color palette and typography in `docs/ui/Bistech_brand_theme.md`
- [ ] Audit and transaction rules from FSD.md followed
- [ ] Commits follow Conventional Commits with `Refs: F-xxx` and agent trailer
- [ ] PR description complete; assumptions and open questions listed
- [ ] Reviewer assigned (not me); `CLAIMS.md` status set to `in-review`

---

## 7. When to stop and escalate to the human

- Documents conflict or a requirement is ambiguous in a way that affects security, permissions or data
- A dependency ticket is not Done or the ticket seems too large for one PR
- Another agent's branch or claim overlaps your files
- A test fails for a reason you cannot explain, or a control would need weakening
- You discovered a secret, a vulnerability, or data loss risk
- Any action in the "destructive and irreversible" list appears necessary

<!-- END:nextjs-agent-rules -->
