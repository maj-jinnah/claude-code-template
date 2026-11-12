#!/usr/bin/env node
// PreToolUse hook (Bash | PowerShell) — "command safety" (idea from agyis-harness).
// Blocks commands that can destroy data or history. Exit 2 = blocked,
// and the message on stderr is shown to Claude.
//
// Need to run one of these yourself? Run it in your own terminal.
// Want to allow one for this project? Delete its line below.
//
// Note: `[^;&|]*` means "anything inside the SAME command" — it stops at
// `&&`, `;` and `|` so a flag of the next command is never matched by mistake.

const fs = require('fs');

// Checked on every command.
const ALWAYS = [
  // --- ORMs / migrations ---
  [/prisma\s+migrate\s+reset/, 'prisma migrate reset deletes all data in the database'],
  [/prisma\s+db\s+push\b[^;&|]*--force-reset/, 'prisma db push --force-reset deletes all data'],
  [/prisma\s+db\s+push\b[^;&|]*--accept-data-loss/, 'prisma db push --accept-data-loss can drop columns/tables'],
  [/typeorm\b[^;&|]*\bschema:drop/, 'typeorm schema:drop deletes all tables'],
  [/sequelize\b[^;&|]*\bdb:drop/, 'sequelize db:drop deletes the database'],

  // --- Docker (database volumes) ---
  [/docker[\s-]+compose\b[^;&|]*\bdown\b[^;&|]*(\s-v\b|--volumes)/, 'docker compose down -v deletes database volumes'],
  [/docker\s+volume\s+(rm|prune)/, 'deleting docker volumes deletes database data'],

  // --- Git ---
  [/git\s+push\b[^;&|]*(--force(?!-with-lease|-if-includes)|\s-f\b|\s\+[\w\/.-]+)/, 'force push rewrites remote history (use --force-with-lease if really needed)'],
  [/git\s+reset\s+--hard/, 'git reset --hard throws away uncommitted work'],
  [/git\s+clean\b[^;&|]*\s(-[a-zA-Z]*f[a-zA-Z]*|--force)(?=\s|$)/, 'git clean -f deletes untracked files'],
  [/git\s+checkout\s+(--\s+)?\.(\s|$)/, 'git checkout . throws away uncommitted work'],
  [/git\s+restore\s+(--\s+)?\.(\s|$)/, 'git restore . throws away uncommitted work'],

  // --- Filesystem: recursive delete of / ~ * . .. (and /* ~/ ./* etc.) ---
  [/\brm\s+(?:-\S+\s+)*(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\s+(?:-\S+\s+)*(?:\/\*?|~\/?\*?|["']?\$\{?HOME\}?["']?\/?\*?|\*|\.{1,2}\/?\*?)(?:\s|$)/, 'recursive delete of root / home / current folder'],
  [/Remove-Item\b(?=[^;|]*-Recurse\b)[^;|]*\s(?:\.{1,2}[\\\/]?\*?|\*|~[\\\/]?\*?|[A-Za-z]:[\\\/]?\*?)(?:\s|$)/i, 'recursive delete of drive / home / current folder'],

  // --- Secrets: printing real .env files (.env.example is fine) ---
  [/\b(cat|less|more|head|tail|bat|type|Get-Content|gc)\s+[^;&|]*\.env(?:\.(?!example|sample|template|dist|defaults)[\w.-]+)?(?=\s|$|["'])/i, 'printing a .env file exposes secrets (read .env.example instead)'],
  // search/stream tools: only when a .env file is the LAST argument (the file being read),
  // so `grep -rn "process.env" src` and `grep .env .gitignore` stay allowed
  [/\b(grep|egrep|fgrep|rg|sed|awk|nl|tac|sort|cut|strings|xxd|findstr|Select-String|sls)\b[^;&|]*(?<!\w)(?<!["'\s]\\)\.env(?:\.(?!example|sample|template|dist|defaults)[\w.-]+)?(?=["']?\s*(?:$|[;&|]))/i, 'reading a .env file exposes secrets (read .env.example instead)'],

  // --- Publishing ---
  [/\b(npm|pnpm|yarn|bun)\s+publish\b/, 'publishing a package'],
];

// Checked only when the command actually talks to a database or runs code,
// so that `git commit -m "drop table ..."` or `grep "DROP TABLE"` stay allowed.
const DB_CONTEXT = /\b(psql|mysql|mariadb|mongosh|mongo|sqlite3|sqlcmd|redis-cli|typeorm|sequelize|knex|node|ts-node|tsx|bun|deno)\b|prisma\s+db\s+execute/i;
const DB_ONLY = [
  [/\bdrop\s+(database|schema|table)\b/i, 'DROP DATABASE / SCHEMA / TABLE'],
  [/\btruncate\s+(table\s+)?[\w"`.]+/i, 'TRUNCATE deletes all rows'],
  [/\bdelete\s+from\s+[\w"`.]+\s*(;|["']|$)/i, 'DELETE FROM without WHERE deletes all rows'],
  [/dropDatabase\s*\(/, 'MongoDB dropDatabase()'],
  [/\.drop\s*\(\s*\)/, 'MongoDB collection.drop()'],
  [/\.deleteMany\s*\(\s*(\{\s*\})?\s*\)/, 'MongoDB deleteMany({}) deletes every document'],
  [/\bflush(all|db)\b/i, 'Redis FLUSHALL / FLUSHDB deletes all keys'],
];

let input = {};
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
} catch {
  process.exit(0);
}

// Commit messages and PR / issue text are prose, not commands. Claude usually passes them as
//   git commit -m "$(cat <<'EOF' ... EOF)"
// so that text is removed before matching: a message that merely MENTIONS `.env` or
// `git reset --hard` must not be blocked. Everything after the next `&&`, `;` or `|` is still checked.
const PROSE =
  /\b(?:git\s+(?:commit|tag)|gh\s+(?:pr|issue|release)\s+\w+)\b(?:(?:"[^"\n]*"|'[^'\n]*'|[^;&|\n])*?<<-?\s*['"]?(\w+)['"]?[\s\S]*?\n[ \t]*\1\b[^;&|\n]*|(?:"[^"]*"|'[^']*'|[^;&|\n])*)/g;

const raw = String((input.tool_input && input.tool_input.command) || '');
if (!raw) process.exit(0);
const cmd = raw.replace(PROSE, ' <text> ');

const rules = DB_CONTEXT.test(cmd) ? [...ALWAYS, ...DB_ONLY] : ALWAYS;

for (const [pattern, reason] of rules) {
  if (pattern.test(cmd)) {
    process.stderr.write(
      `Blocked by .claude/hooks/guard.cjs: ${reason}.\n` +
        `Do not try to work around this. If it is really needed, ask the user to run it themselves.\n`
    );
    process.exit(2);
  }
}
process.exit(0);
