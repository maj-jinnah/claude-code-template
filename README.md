# Claude Code Template (Node.js / TypeScript)

**English** | [বাংলা](README.bn.md)

A drop-in setup that makes Claude Code safer and more reliable in any Node.js / TypeScript project (NestJS, Express, Next.js, React). One command installs it into a project.

It contains three kinds of things:

- **Hooks:** small Node scripts that run automatically before and after Claude's actions. They enforce rules in code instead of asking the model to behave.
- **Subagents:** eight specialists such as a planner, a reviewer and an investigator.
- **`CLAUDE.md`:** a template for the project's commands and rules.

There are no dependencies beyond Node itself.

## What's included

| File | When it runs | What it does |
|---|---|---|
| `.claude/hooks/guard.cjs` | **Before** Claude runs a shell command (Bash and PowerShell) | Blocks destructive commands |
| `.claude/hooks/format.cjs` | **After** Claude edits a file | Runs Prettier on that file |
| `.claude/hooks/verify.cjs` | After edits, before `git commit`, and before Claude finishes | When Claude has changed code, runs typecheck and tests. On failure it blocks the commit and sends Claude back to fix it |
| `.claude/settings.json` | — | Registers the hooks and denies reading real `.env` files |
| `.claude/agents/*.md` | When you or Claude call them | Eight specialist subagents |
| `.claude/scratch/` | — | Where the investigator puts reproduction scripts; never committed |
| `CLAUDE.md` | At the start of every session | Project commands and rules. **You must fill in the `<...>` placeholders** |

## Requirements

- Node.js 18 or newer (tested on Node 24)
- Claude Code 2.1 or newer (tested on 2.1.300)
- Git
- On Windows: **Git for Windows** (Git Bash). Hook commands run in Git Bash. Without it, Claude Code runs them in PowerShell, where this template's commands are not expected to work (not tested).

## Install into a project

```bash
node /path/to/claude-code-template/install.cjs /path/to/your-project
```

From inside the project folder, pass `.` as the target.

- It never deletes or overwrites your files.
- If `.claude/settings.json` already exists, it is **merged**. Your own hooks and permissions stay, and the original is kept as `settings.json.bak`.
- An existing `CLAUDE.md` is left untouched.
- Running it a second time changes nothing.

Then:

1. Open the project's `CLAUDE.md` and fill in the `<...>` placeholders. **Do not skip this.** The easy way is to ask Claude: "Fill in the `<...>` placeholders in CLAUDE.md from package.json and the code." Until they are filled in, a note at the top of the file tells Claude to rely on `package.json` instead.
2. Start a **new** Claude Code session in that project. Hooks and agents load only at session start.
3. Check that they loaded. In the terminal `claude`, type `/agents` to list the agents. In the VS Code extension, hooks are listed under **Hooks** in the Customize section. A quick end-to-end check: ask Claude to run `git reset --hard`. If the guard blocks it, the hooks are active.
4. To share the setup with your team, commit `.claude/` and `CLAUDE.md`. The `*.bak` files do not need to be committed.

### Updating a project after the template changes

Add `--force`:

```bash
node /path/to/claude-code-template/install.cjs /path/to/your-project --force
```

This updates the template's hook and agent files and its entries in `settings.json`. If a file in the project differs from the template (for example, you edited it), the previous version is kept as `<name>.bak`. Your own hooks and your `CLAUDE.md` are not touched.

## How the hooks work

### guard.cjs: blocks destructive commands

Blocked:

- **ORMs:** `prisma migrate reset`, `prisma db push --force-reset` / `--accept-data-loss`, `typeorm schema:drop`, `sequelize db:drop`
- **SQL / Mongo / Redis:** `DROP DATABASE/TABLE/SCHEMA`, `TRUNCATE`, `DELETE FROM` without `WHERE`, `dropDatabase()`, `collection.drop()`, `deleteMany({})`, `FLUSHALL` / `FLUSHDB`
- **Docker:** `docker compose down -v`, `docker volume rm` / `prune`
- **Git:** `git push --force` / `-f` / `+branch`, `git reset --hard`, `git clean -f`, `git checkout .`, `git restore .`
- **Files:** `rm -rf` on `/`, `~`, `$HOME`, `.`, `..` or `*`, and the same with PowerShell's `Remove-Item -Recurse`
- **Secrets:** printing or reading a real `.env` file: `cat .env`, `grep KEY .env`, `sed -n p .env` and similar. `.env.example` is allowed.
- **Publishing:** `npm` / `pnpm` / `yarn` / `bun publish`

Not blocked:

- Safe variants: `prisma migrate dev`, `git push --force-with-lease`, `rm -rf dist`, `docker compose down`, `DELETE` with a `WHERE`.
- The text of commit messages, tags, and PR or issue bodies. A commit whose message mentions `.env` or `git reset --hard` goes through.
- Searches such as `grep -rn "process.env" src` or `grep "DROP TABLE" migrations`. SQL keywords are only checked when the command actually runs a database client or `node`.

If a blocked command is genuinely needed, run it in your own terminal, or delete its line from the project's `.claude/hooks/guard.cjs`.

### verify.cjs: completion fence and commit gate

1. When Claude edits a `.ts/.tsx/.js/.jsx` file inside the project, the hook records that code changed, and which package the file belongs to (the nearest `package.json`).
2. **Commit gate:** if Claude runs `git commit` while changed code is unverified, the checks run first. If they fail, the commit is blocked. To skip the gate on purpose, use `git commit --no-verify`, the same flag that skips git's own hooks.
3. **Completion fence:** when Claude tries to finish, the same checks run. If they pass, Claude stops. If they fail, the tail of the error is shown to Claude and it is sent back to work.
4. If Claude stops again without changing code (for example, it needs a decision from you), or the checks still fail after 3 fix attempts, the hook lets it go and **shows you a warning** ("Stop says: verify hook: ..."). It can never loop forever.

**Which checks run:**

- `tsc --noEmit`, if the package has a `tsconfig.json` and TypeScript is installed
- the `test` script, if `package.json` has one (run with npm, pnpm, yarn or bun, detected from the lock file)
- if `package.json` has a `claude:verify` script, **only that script** runs instead of the two above

**What this guarantees and what it does not:** the fence guarantees that Claude sees the failure, that broken code is not committed, and that you get a warning. It does not guarantee the code gets fixed. When you see the warning, check for yourself.

Other behaviour:

- If Claude changed no code (answering a question, reading docs), nothing runs, even if your working tree already has uncommitted changes.
- It works in projects without git.
- Edits made by subagents (such as the builder) are caught too.
- **Monorepos:** if `package.json` is in a subfolder (for example `services/api/package.json`), the checks run in that folder. If several packages were edited, each one is checked (up to 8). TypeScript installed at the repository root is found.
- If the checks take longer than 270 seconds, the hook stops them (including every process the test run started) and warns you.
- By default only the `test` script runs, not `test:e2e`, so a database that is not running does not cause failures.

### format.cjs: Prettier

Runs only on files inside the project, and only if Prettier is installed (in the file's package or a parent folder). It never downloads anything and never blocks Claude.

NestJS sets up Prettier for you. In a Next.js or Vite project, install it yourself: `npm i -D prettier`.

## The eight subagents

Each agent's tool list decides what it can do. An agent without Edit and Write in its list cannot edit files at all.

| Agent | Job | Edits files? | Runs commands? |
|---|---|---|---|
| `planner` | Reads the code and returns a file-by-file plan | ❌ | ❌ |
| `builder` | Implements one plan step, with tests | ✅ | ✅ |
| `reviewer` | Reviews only the diff for bugs, security holes and weak tests | ❌ | ✅ (by instruction: read-only git) |
| `auditor` | Runs typecheck, lint, tests and build, and reports evidence | ❌ | ✅ |
| `custodian` | Checks for duplicate code and architecture problems, then commits only the intended files | ❌ | ✅ (git) |
| `investigator` | Finds the root cause of a bug and proves it with a reproduction | By instruction: only in `.claude/scratch/` | ✅ |
| `architect` | Large work: designs, implements, and delegates | ✅ | ✅ |
| `coordinator` | Writes no code itself; runs the whole team | ❌ | ❌ |

"By instruction" means the rule is written in the agent's prompt, not enforced in code. The guard hook also applies to commands run by subagents, so destructive commands are still blocked.

### Using them

**From a normal session**, call any agent by name:

```text
Use the reviewer subagent to review my uncommitted changes
Use the investigator to find out why login fails
Use the planner to plan the payment module
Use the custodian to commit this work
```

Claude also calls them on its own when a task matches an agent's description.

**For large work, run the coordinator or architect as the main session:**

```bash
claude --agent coordinator    # writes no code; runs planner → builder → reviewer → custodian → auditor
claude --agent architect      # writes code itself and delegates when useful
```

Do not call these two as ordinary subagents. A subagent in Claude Code can spawn other subagents, but they run in the background, and in testing the coordinator returned its report before its delegates had finished. As the main session, it completes the full ladder.

With `--agent`, the agent's instructions replace Claude Code's default system prompt, and the session gets only that agent's tools.

**In the VS Code extension** there is nowhere to pass `--agent`. The reliable way is to run `claude --agent coordinator` in the VS Code terminal. The alternative is to put `{"agent": "coordinator"}` in the project's `.claude/settings.local.json`. That works with the terminal `claude`; whether it works in the extension has not been verified. It also turns **every** session in that project into the coordinator, so remove it when you are done.

**Cost:** every subagent is a separate model call. For small tasks (fixing one function), asking Claude directly is cheaper and faster. Use the ladder for large features or risky changes. To run an agent on a cheaper model, change `model: inherit` in its file to `model: sonnet` or `model: haiku`.

## Customizing per project

**To choose what verify runs,** add a `claude:verify` script to `package.json`:

```json
"scripts": {
  "claude:verify": "tsc --noEmit && eslint src && jest --onlyChanged"
}
```

| Project | When you need it | `claude:verify` |
|---|---|---|
| NestJS | When the test suite is slow | `tsc --noEmit && jest --onlyChanged` |
| Next.js | When you also want lint | `tsc --noEmit && next lint` |
| React (Vite) | Always. Vite's `tsconfig.json` only holds references, so the default `tsc --noEmit` checks nothing | `tsc -b && vitest run` |
| Express (JS) | Not needed | By default only the `test` script runs |

**To let Claude read `.env`,** remove the lines from `permissions.deny` in `settings.json` and delete the two lines under "Secrets" in `guard.cjs`.

## Limitations

- **The guard is a safety net, not a sandbox.** It cannot see a command hidden inside a script file (such as `npm run reset-db` or `node scripts/wipe.js`). A folder-wide search like `grep -r KEY .` can still print lines from `.env`. The real protection is not keeping production credentials in a local `.env`.
- **verify only sees edits made with Claude's Edit and Write tools.** If Claude changes code with a shell command (such as `sed -i`), the change is not noticed and no checks run.
- **The fence does not guarantee a fix.** See above.
- **The `.env` deny rules list specific names:** `.env`, `.env.local`, `.env.development`, `.env.production`, `.env.staging`, `.env.test`, `.env.*.local`. Add any other secret files to `settings.json`.
- **Agents make mistakes.** In testing (on the haiku model) the coordinator once sent the same task to the builder twice, and once started the reviewer before the builder had finished. The end result was correct both times because the fence and the review caught the problem.
- **The coordinator's todo tool:** its tool list names todo and question tools, but which of them an interactive session really provides could not be verified. Without one, the coordinator keeps its checklist in its replies.

## What was tested

Tested on Windows 11 with Claude Code 2.1.300, Node 24, TypeScript 7 and Prettier 3.

**Scripted tests:**

- guard: 153 commands (76 that must be blocked, 77 that must be allowed), all correct
- verify: single-package and monorepo projects, the commit gate, timeouts, large output and malformed input
- format: file names with spaces, files outside the project and `node_modules`
- installer: fresh install, re-run, merge and `--force` upgrade

**Real Claude Code sessions** (haiku model, headless `claude -p` mode):

- The guard blocked commands in both the main session and a subagent.
- verify caught a type error and made Claude fix it. In a monorepo it ran in the right package.
- The commit gate blocked a commit of broken code. Claude stopped and asked for a decision.
- A commit whose message mentions `.env` was not blocked.
- Reading `.env` was denied; reading `.env.example` worked.
- The reviewer found all 3 deliberately planted bugs, and had only `Read, Grep, Glob, Bash`.
- The coordinator (`--agent`) ran builder → reviewer → auditor on two separate tasks without writing code itself.
- The custodian committed only the intended files. The investigator found the real cause without touching product code. The planner returned a plan in the expected format.

**Not tested:**

- Inside the VS Code extension (every test used the terminal `claude`)
- macOS and Linux
- A real NestJS project with a large jest suite
- Models other than haiku
- The architect as the main session (`--agent architect`)

## Credits

The ideas (command safety, the completion fence, keeping output short, the eight agent roles) come from [agyis-harness](https://github.com/kuasha420/agyis-harness), a harness for Google Antigravity by Arafat Zahan / Purrfect Software Limited, licensed Apache-2.0. The code and agent instructions in this template were written from scratch for Claude Code.
