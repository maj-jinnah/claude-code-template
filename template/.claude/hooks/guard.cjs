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

// Start of a command: beginning of the line, after ; & | ( $( or a backtick, or inside
// `cmd /c "..."` / `powershell -Command "..."`, optionally behind sudo / xargs / nohup ...
// Used for rules about program NAMES, so `grep killall scripts/` or `which pkill` are not blocked.
const AT_CMD =
  String.raw`(?:^|[;&|(\n` +
  '`' +
  String.raw`]|\$\(|\b(?:cmd(?:\.exe)?\s+\/[ck]|(?:powershell|pwsh)(?:\.exe)?(?:\s+-\w+)*)\s*["']?)\s*` +
  String.raw`(?:(?:sudo|doas|exec|nohup|time|command|xargs)(?:\s+-\S+)*\s+)*`;
const atCmd = (body, flags = '') => new RegExp(AT_CMD + body, flags);

// Process names that are too broad to kill by name (every Node app on the machine shares them).
const RUNTIMES = '(?:node|nodejs|node\\.exe|npm|npx|pnpm|yarn|bun|tsx|ts-node|nodemon)';
const NO_HELP = String.raw`(?!\s+(?:--help|-h|--version|-V)\b)`;
const KILL_BY_NAME =
  'killing processes by name stops EVERY matching process on this machine (other projects, dev servers, workers). ' +
  'Stop only the one process you need, by its PID. Port in use? Windows: `netstat -ano | findstr :3000` then ' +
  '`taskkill /PID <pid> /F`. macOS/Linux: `lsof -ti :3000 | xargs kill`';

// Checked on every command (after quoted text of search/print commands is removed, see below).
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

  // --- Processes: killing by NAME stops every process with that name (other projects'
  //     dev servers, Prisma Studio, workers...). Killing one PID is allowed. ---
  [atCmd(String.raw`taskkill\b[^;&|]*[\/-]IM\b`, 'i'), KILL_BY_NAME],
  [atCmd(String.raw`killall\b` + NO_HELP), KILL_BY_NAME],
  [atCmd(String.raw`pkill\b` + NO_HELP + String.raw`(?![^;&|]*\s-[a-zA-Z]*f)`), KILL_BY_NAME], // pkill <name>
  // pkill -f node (the pattern is ONLY a runtime name; `pkill -f "node dist/main.js"` is specific and allowed)
  [atCmd(String.raw`pkill\b[^;&|]*\s-[a-zA-Z]*f[a-zA-Z]*\s+(?:"${RUNTIMES}"|'${RUNTIMES}'|${RUNTIMES})(?=\s|$|[;&|])`), KILL_BY_NAME],
  [atCmd(String.raw`(?:Stop-Process|spps|kill)\b[^;|]*\s-(?:Name|ProcessName)\b`, 'i'), KILL_BY_NAME],
  [atCmd(String.raw`(?:Get-Process|gps)\b(?![^;|]*\s-Id\b)[^;|]*\|\s*(?:Stop-Process|spps|kill)\b`, 'i'), KILL_BY_NAME],
  [atCmd(String.raw`kill\b[^;&]*(?:\$\(|` + '`' + String.raw`)\s*(?:pgrep|pidof)\b`), KILL_BY_NAME], // kill $(pgrep node)
  [atCmd(String.raw`(?:pgrep|pidof)\b[^;&]*\|\s*xargs\s+(?:-\S+\s+)*kill\b`), KILL_BY_NAME], // pgrep node | xargs kill
  [atCmd(String.raw`wmic\b[^;&|]*\bprocess\b[^;&|]*\b(?:delete|call\s+terminate)\b`, 'i'), KILL_BY_NAME],

  // --- Publishing ---
  [/\b(npm|pnpm|yarn|bun)\s+publish\b/, 'publishing a package'],
];

// Checked on the command with only commit/PR text removed — a quoted path like
// `grep KEY "apps/api/.env"` must still count.
const SECRETS = [
  // printing real .env files (.env.example is fine)
  [/\b(cat|less|more|head|tail|bat|type|Get-Content|gc)\s+[^;&|]*\.env(?:\.(?!example|sample|template|dist|defaults)[\w.-]+)?(?=\s|$|["'])/i, 'printing a .env file exposes secrets (read .env.example instead)'],
  // search/stream tools: only when a .env file is the LAST argument (the file being read),
  // so `grep -rn "process.env" src` and `grep .env .gitignore` stay allowed
  [/\b(grep|egrep|fgrep|rg|sed|awk|nl|tac|sort|cut|strings|xxd|findstr|Select-String|sls)\b[^;&|]*(?<!\w)(?<!["'\s]\\)\.env(?:\.(?!example|sample|template|dist|defaults)[\w.-]+)?(?=["']?\s*(?:$|[;&|]))/i, 'reading a .env file exposes secrets (read .env.example instead)'],
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

// Search and print commands only MENTION text: `grep -rn "git reset --hard" docs`,
// `echo "never run git push --force"`. Their quoted arguments are blanked before the
// ALWAYS / DB rules run. Exception: echo/printf piped into another program
// (`echo "DROP TABLE x" | psql`) — then the text IS the command, so it is kept.
const MENTION =
  /(^|[;&|(\n]\s*)((?:grep|egrep|fgrep|rg|ag|ack|findstr|Select-String|sls|man|which|where|git\s+(?:log|grep|show)|echo|printf|Write-Host|Write-Output)\b(?:"[^"\n]*"|'[^'\n]*'|[^;&|\n])*)/gi;
function blankMentions(text) {
  return text.replace(MENTION, (whole, lead, seg, offset) => {
    const isPrint = /^(?:echo|printf|Write-Host|Write-Output)\b/i.test(seg);
    const pipedOn = /^\s*\|(?!\|)/.test(text.slice(offset + whole.length));
    if (isPrint && pipedOn) return whole;
    return lead + seg.replace(/"[^"\n]*"|'[^'\n]*'/g, '""');
  });
}

const raw = String((input.tool_input && input.tool_input.command) || '');
if (!raw) process.exit(0);
const cmd = raw.replace(PROSE, ' <text> ');
const code = blankMentions(cmd);

const checks = [
  ...SECRETS.map((r) => [cmd, r]),
  ...ALWAYS.map((r) => [code, r]),
  ...(DB_CONTEXT.test(code) ? DB_ONLY.map((r) => [code, r]) : []),
];

for (const [text, [pattern, reason]] of checks) {
  if (pattern.test(text)) {
    process.stderr.write(
      `Blocked by .claude/hooks/guard.cjs: ${reason}.\n` +
        `Do not try to work around this. If it is really needed, ask the user to run it themselves.\n`
    );
    process.exit(2);
  }
}
process.exit(0);
