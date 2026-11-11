# Project guide for Claude

> **NOT FILLED IN YET.** While any `<...>` placeholder remains in this file, do not trust
> its commands or stack details: read `package.json` (scripts, dependencies) and the code
> instead, and never run a tool that is not in this project's dependencies.
> (Delete this note once every placeholder is replaced.)

## What this project is
<one or two lines: e.g. "NestJS REST API for an accounting system, PostgreSQL via Prisma">

## Stack
- Runtime: Node <version>, package manager: <npm | pnpm | yarn>
- Framework: <NestJS | Express | Next.js | React (Vite)>
- Database: <PostgreSQL | MySQL | MongoDB | none> via <Prisma | TypeORM | Mongoose | none>
- Test runner: <jest | vitest | node --test | none>
- Other: <Redis, BullMQ, Kafka, ... or none>

## Commands (use exactly these, do not guess)
Copy the real scripts from this project's `package.json`. Delete rows that do not apply.

| Task | Command |
|---|---|
| Install | `<npm install>` |
| Dev server | `<npm run start:dev  or  npm run dev>` |
| Build | `<npm run build>` |
| Typecheck | `<npx tsc --noEmit  or  npx tsc -b>` |
| All tests | `<npm test>` |
| One test file | `<npx jest path/to/file.spec.ts  or  npx vitest run path/to/file.test.ts>` |
| E2E tests | `<npm run test:e2e>` |
| Lint | `<npm run lint>` |
| New migration | `<npx prisma migrate dev --name change_name>` |
| Regenerate client | `<npx prisma generate>` |
| Start local services | `<docker compose up -d>` |

## Local services
- Database: <which one, which port (5432 / 3306 / 27017)>, configured through `DATABASE_URL` in `.env`.
- Never read or print `.env`; use `.env.example` to learn variable names.

## Project structure
<Replace with this project's real layout, for example:>
- `src/<module>/` — one folder per feature module (controller, service, dto, entity)
- `prisma/schema.prisma` — database schema
- `test/` — e2e tests

## Rules
- Follow the existing patterns; look at a similar module/file before creating a new one.
- Validate all external input at the boundary (DTO + class-validator, or zod); never trust raw input.
- After changing the database schema, create a migration — never edit an applied migration.
- Write or update tests for every behavior change.
- Do not add new dependencies without saying why.
- Never run destructive DB or git commands (reset, drop, force push) — ask me instead.

## Guardrails already active (see .claude/)
- Destructive DB / git / delete commands are blocked by a hook. If one is blocked, do not work around it — ask me to run it.
- After you edit code, typecheck and tests run automatically when you finish. If they fail you must fix them.
- Edited files are auto-formatted with Prettier (if the project has it), so a file may differ slightly from what you wrote.

## Specialist subagents (.claude/agents/)
- `planner` (plan, read-only) · `builder` (implement one step) · `reviewer` (review diff, read-only)
- `auditor` (run checks, report evidence) · `custodian` (DRY/hygiene gate + commit) · `investigator` (root cause + repro in `.claude/scratch/`)
- Delegate a bug with an unclear cause to `investigator`. For changes touching many files, ask `planner` first, and finish with `reviewer` + `auditor`.
- `coordinator` and `architect` are meant to run as the main session (`claude --agent <name>`), not as subagents.
