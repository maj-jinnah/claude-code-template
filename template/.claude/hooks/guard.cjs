#!/usr/bin/env node
// PreToolUse hook (Bash | PowerShell) — "command safety" (idea from agyis-harness).
// Blocks commands that can destroy data or history, or print secrets. Exit 2 = blocked,
// and the message on stderr is shown to Claude.
//
// Need to run one of these yourself? Run it in your own terminal.
// Want to allow one for this project? Delete its line below.
//
// This is a safety net for MISTAKES, not a sandbox: a command written to get around
// it (e.g. a script file that deletes things) is not detected.
//
// Note: `[^;&|]*` means "anything inside the SAME command" — it stops at
// `&&`, `;` and `|` so a flag of the next command is never matched by mistake.

const fs = require('fs');

// ---------------------------------------------------------------- building blocks

// Start of a command: beginning of the line, after ; & | ( { $( or a backtick, after
// then/do/else, or inside `cmd /c "..."`, `powershell -Command "..."`, `bash -c "..."`,
// optionally behind VAR=x / sudo / env / timeout 5 / xargs ... and a folder path.
// Used for rules about program NAMES, so `grep killall scripts/` or `which pkill` are not blocked.
const AT_CMD =
  String.raw`(?:^|[;&|({\n` +
  '`' +
  String.raw`]|\$\(|\b(?:then|do|else)\s|` +
  String.raw`\b(?:cmd(?:\.exe)?(?:\s+\/[a-bd-jl-z]\b)*\s+\/[ck]|` +
  String.raw`(?:powershell|pwsh)(?:\.exe)?(?:\s+-\w+(?:\s+[A-Za-z]\w*)?)*|` +
  String.raw`(?:bash|sh|zsh|dash)(?:\s+-\w+)*\s+-\w*c)\s*["']?)\s*` +
  String.raw`(?:(?:\w+=\S*|(?:sudo|doas)(?:\s+-[ugUCDhprT]\s+\S+|\s+-\S+)*|(?:env|exec|nohup|time|nice|xargs)(?:\s+-\S+)*|command(?!\s+-)|timeout(?:\s+-\S+)*\s+\S+)\s+)*` +
  String.raw`(?:[\w.~:\/\\-]*[\/\\])?`;
const atCmd = (body, flags = '') => new RegExp(AT_CMD + body, flags);

// End of an argument.
const END = String.raw`(?=\s|$|[;&|)])`;

// `git` plus any global options before the subcommand, so `git -C ../api reset --hard`,
// `git -c core.x=y clean -fd` and `git --no-pager reset --hard` are caught too.
const ARG = String.raw`(?:"[^"\n]*"|'[^'\n]*'|[^\s;&|"']+)`;
const GIT =
  String.raw`\bgit(?:\.exe)?(?:\s+(?:-[cC]\s+${ARG}|--(?:git-dir|work-tree|namespace|exec-path|config-env)\s+${ARG}|--[\w-]+(?:=${ARG})?))*\s+`;
const git = (body) => new RegExp(GIT + body);

// One piece of a command line: a "quoted string", a 'quoted string', a quote with no
// partner on that line, or any other character except ; & | and newline. The pieces never
// overlap, so matching stays fast even on long commit messages.
const PIECE = String.raw`(?:"[^"\n]*"|'[^'\n]*'|"(?![^"\n]*")|'(?![^'\n]*')|[^;&|\n"'])`;

// Process names that are too broad to kill by name (every Node app on the machine shares them).
const RUNTIMES = String.raw`(?:node|nodejs|node\.exe|npm|npx|pnpm|yarn|bun|deno|tsx|ts-node|nodemon|nest|next|vite|vitest|jest|webpack|tsc|prisma)`;
const NO_HELP = String.raw`(?!\s+(?:--help|-h|--version|-V)\b)`;
// pgrep / pidof that selects by a broad name (`pgrep node`, `pgrep -f nest`), not a specific command line
const PGREP_BROAD =
  String.raw`(?:pgrep|pidof)\b(?:(?![^;&|)` + '`' + String.raw`]*\s(?:-[a-zA-Z]*f|--full\b))|` +
  String.raw`[^;&|)` + '`' + String.raw`]*\s(?:-[a-zA-Z]*f[a-zA-Z]*|--full)\s+(?:-\S+\s+)*(?:"${RUNTIMES}"|'${RUNTIMES}'|${RUNTIMES})(?=[\s;&|)` + '`' + String.raw`]|$))`;
const KILL_BY_NAME =
  'killing processes by name stops EVERY matching process on this machine (other projects, dev servers, workers). ' +
  'Stop only the one process you need, by its PID. Port in use? Windows: `netstat -ano | findstr :3000` then ' +
  '`taskkill /PID <pid> /F`. macOS/Linux: `lsof -ti :3000 | xargs kill`';

// ---------------------------------------------------------------- rules

// Checked on every command (after quoted text of search/print commands is removed, see below).
const ALWAYS = [
  // --- ORMs / migrations ---
  [/prisma\s+migrate\s+reset/, 'prisma migrate reset deletes all data in the database'],
  [/prisma\s+db\s+push\b[^;&|]*--force-reset/, 'prisma db push --force-reset deletes all data'],
  [/prisma\s+db\s+push\b[^;&|]*--accept-data-loss/, 'prisma db push --accept-data-loss can drop columns/tables'],
  [/typeorm\b[^;&|]*\bschema:drop/, 'typeorm schema:drop deletes all tables'],
  [/sequelize\b[^;&|]*\bdb:drop/, 'sequelize db:drop deletes the database'],
  [/mikro-orm\b[^;&|]*\bschema:(?:drop|fresh)/, 'mikro-orm schema:drop / schema:fresh deletes all tables'],

  // --- Database command-line tools ---
  [atCmd(String.raw`dropdb\b` + NO_HELP), 'dropdb deletes a database'],
  [atCmd(String.raw`mysqladmin\b[^;&|]*\sdrop\b`, 'i'), 'mysqladmin drop deletes a database'],

  // --- Docker (database volumes) ---
  [/docker[\s-]+compose\b[^;&|]*\bdown\b[^;&|]*(\s-v\b|--volumes)/, 'docker compose down -v deletes database volumes'],
  [/docker\s+volume\s+(rm|prune)/, 'deleting docker volumes deletes database data'],
  [/docker\s+system\s+prune\b[^;&|]*--volumes/, 'docker system prune --volumes deletes database volumes'],

  // --- Git ---
  [git(String.raw`push\b[^;&|]*(--force(?!-with-lease|-if-includes)|\s-[a-zA-Z]*f[a-zA-Z]*\b|\s\+[\w\/.-]+)`), 'force push rewrites remote history (use --force-with-lease if really needed)'],
  [git(String.raw`reset\b[^;&|]*\s--hard\b`), 'git reset --hard throws away uncommitted work'],
  [git(String.raw`clean\b(?![^;&|]*\s(?:--dry-run\b|-[a-zA-Z]*n))[^;&|]*\s(?:-[a-zA-Z]*f[a-zA-Z]*|--force)${END}`), 'git clean -f deletes untracked files'],
  [git(String.raw`checkout\b[^;&|]*\s\.\/?${END}`), 'git checkout . throws away uncommitted work'],
  // `git restore .` touches the working tree unless ONLY --staged is given
  [git(String.raw`restore\b(?![^;&|]*\s(?:--staged\b|-[a-zA-Z]*S))[^;&|]*\s\.\/?${END}`), 'git restore . throws away uncommitted work'],
  [git(String.raw`restore\b(?=[^;&|]*\s(?:--worktree\b|-[a-zA-Z]*W))[^;&|]*\s\.\/?${END}`), 'git restore --worktree . throws away uncommitted work'],

  // --- Filesystem: recursive delete of / ~ $HOME $PWD * . .. ../.. (and /* ~/ ./* etc.) ---
  [new RegExp(String.raw`\brm\s+(?:-\S+\s+)*(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\s+(?:-\S+\s+)*` +
    String.raw`["']?(?:\/|~|\$\{?(?:HOME|PWD)\}?|\$\(pwd\)|\*|\.{1,2}(?:\/\.\.)*)\/?\*?["']?\/?\*?${END}`),
    'recursive delete of root / home / current folder'],
  [new RegExp(String.raw`\b(?:Remove-Item|ri)\b(?=[^;&|]*\s-r(?:e(?:c(?:u(?:r(?:s(?:e)?)?)?)?)?)?\b)[^;&|]*\s` +
    String.raw`["']?(?:\.{1,2}|\*|~|[A-Za-z]:|\$HOME|\$PWD|\$env:(?:USERPROFILE|HOMEDRIVE|HOMEPATH|SystemDrive))["']?[\\\/]?\*?["']?${END}`, 'i'),
    'recursive delete of drive / home / current folder'],
  [new RegExp(String.raw`\b(?:rmdir|rd)\b[^;&|]*\s\/s\b[^;&|]*\s["']?(?:\.{1,2}|[A-Za-z]:|%USERPROFILE%|%HOMEPATH%|%CD%|\\)["']?\\?${END}`, 'i'),
    'recursive delete of drive / home / current folder'],
  // .git holds the whole history of the project; commits that were never pushed would be lost
  [new RegExp(String.raw`\b(?:rm|Remove-Item|ri|rmdir|rd|del)\b[^;&|]*\s["']?(?:\.[\\\/])?\.git[\\\/]?\*?["']?${END}`, 'i'),
    'deleting .git destroys the git history of this project'],

  // --- Processes: killing by NAME stops every process with that name (other projects'
  //     dev servers, Prisma Studio, workers...). Killing one PID is allowed. ---
  [atCmd(String.raw`taskkill\b[^;&|]*(?:[\/-]IM\b|[\/-]FI\s+["']?IMAGENAME\b)`, 'i'), KILL_BY_NAME],
  [atCmd(String.raw`killall\b` + NO_HELP), KILL_BY_NAME],
  [atCmd(String.raw`pkill\b` + NO_HELP + String.raw`(?![^;&|]*\s(?:-[a-zA-Z]*f|--full\b))`), KILL_BY_NAME], // pkill <name>
  // pkill -f node (the pattern is ONLY a runtime name; `pkill -f "node dist/main.js"` is specific and allowed)
  [atCmd(String.raw`pkill\b[^;&|]*\s(?:-[a-zA-Z]*f[a-zA-Z]*|--full)\s+(?:-\S+\s+)*(?:"${RUNTIMES}"|'${RUNTIMES}'|${RUNTIMES})(?=\s|$|[;&|)])`), KILL_BY_NAME],
  [atCmd(String.raw`(?:Stop-Process|spps|kill)\b[^;&|]*\s-(?:Name|ProcessName)\b`, 'i'), KILL_BY_NAME],
  [atCmd(String.raw`(?:Get-Process|gps|ps)\b(?![^;&|]*\s-Id\b)[^;&]*\|[^;&]*\b(?:Stop-Process|spps)\b`, 'i'), KILL_BY_NAME],
  [atCmd(String.raw`(?:Get-Process|gps)\b(?![^;&|]*\s-Id\b)[^;&|]*\|\s*kill\b`, 'i'), KILL_BY_NAME],
  [atCmd(String.raw`kill\b[^;&]*(?:\$\(|` + '`' + String.raw`)\s*` + PGREP_BROAD), KILL_BY_NAME], // kill $(pgrep node)
  [atCmd(PGREP_BROAD + String.raw`[^;&]*\|\s*xargs\s+(?:-\S+\s+)*kill\b`), KILL_BY_NAME], // pgrep node | xargs kill
  [atCmd(String.raw`ps\b[^;&]*\|[^;&]*\bxargs\s+(?:-\S+\s+)*kill\b`), KILL_BY_NAME], // ps aux | grep node | ... | xargs kill
  [atCmd(String.raw`wmic\b[^;&|]*\bprocess\b[^;&|]*\b(?:delete|call\s+terminate)\b`, 'i'), KILL_BY_NAME],

  // --- Publishing (a dry run is fine) ---
  [/\b(?:npm|pnpm|yarn|bun|lerna|changeset)\b[^;&|]*\spublish(?![\w-])(?![^;&|]*--dry-run)/, 'publishing a package'],
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
  [/\.(?:deleteMany|remove)\s*\(\s*(\{\s*\})?\s*\)/, 'MongoDB deleteMany({}) / remove({}) deletes every document'],
  [/\bflush(all|db)\b/i, 'Redis FLUSHALL / FLUSHDB deletes all keys'],
];

// ---------------------------------------------------------------- .env files

// A real .env file: .env, .env.local, apps/api/.env.production ... but not .env.example etc.
// (`.env*` counts too: it includes the real files)
function isEnvFile(word) {
  const base = String(word).split(/[\\/]/).pop();
  return /^\.env(?:\.[\w.-]+)?\*?$/.test(base) && !/\.(?:example|sample|template|dist|defaults)(?:\.|$)/i.test(base.slice(4));
}

// Splits a command line into simple commands, each a list of words with quotes removed.
// `<` and `>` become their own words; `2>` / `>>` work too.
function splitCommands(text) {
  const out = [];
  let words = [];
  let word = '';
  let has = false;
  let quote = null;
  const endWord = () => {
    if (has) words.push(word);
    word = '';
    has = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length) out.push(words);
    words = [];
  };
  for (const c of text) {
    if (quote) {
      if (c === quote) quote = null;
      else word += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      has = true;
    } else if (';&|\n(){}`'.includes(c)) {
      endCommand();
    } else if (c === '<' || c === '>') {
      if (/^\d*$/.test(word)) {
        word = ''; // the 2 of 2>/dev/null
        has = false;
      }
      endWord();
      words.push(c);
    } else if (/\s/.test(c)) {
      endWord();
    } else {
      word += c;
      has = true;
    }
  }
  endCommand();
  return out;
}

const PRINTERS = /^(?:cat|less|more|head|tail|bat|type|get-content|gc|nl|tac|sort|uniq|cut|strings|xxd|od|hexdump|base64|column|paste|fold|rev)$/i;
const SEARCHERS = /^(?:grep|egrep|fgrep|rg|ag|ack|findstr|select-string|sls)$/i;
const SCRIPTED = /^(?:sed|awk|gawk|perl)$/i; // first argument is the script
const MENTION_ONLY = /^(?:echo|printf|write-host|write-output|man|which|where|whereis|git|gh)$/i;
const SHELLS = /^(?:bash|sh|zsh|dash|cmd|powershell|pwsh|docker|kubectl|ssh|wsl)$/i;
// flags whose value is the next word (so that value is not taken for a file name)
const VALUE_FLAGS = new Set([
  '-m', '-A', '-B', '-C', '-t', '-T', '-j', '-M', '-d', '-D',
  '--max-count', '--context', '--after-context', '--before-context', '--type', '--type-not', '--threads',
  '--include', '--exclude', '--exclude-dir', '--color', '--colors', '--label', '--binary-files',
  '--max-columns', '--max-depth', '--sort', '--encoding', '-Encoding', '-Pattern',
]);
const PATTERN_FLAGS = /^(?:-e|--regexp|--expression|-f|--file|-Pattern|\/c:.*)$/i; // the pattern/script comes from a flag
const FILE_FLAGS = /^(?:-f|--file|-g|--glob|--iglob|-Path|-LiteralPath)$/i; // the next word is a file (or glob) that is read

const baseName = (w) => w.split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase();

// Does this one command read a real .env file?
function readsEnv(words) {
  // input redirection `< .env` reads the file, whatever the program is
  for (let i = 0; i < words.length - 1; i++) if (words[i] === '<' && isEnvFile(words[i + 1])) return true;

  // skip VAR=x / sudo / env / xargs ... to find the program
  let i = 0;
  while (i < words.length && /^(?:\w+=.*|sudo|doas|env|exec|nohup|time|nice|xargs|command)$/.test(words[i])) i++;
  const name = words[i] ? baseName(words[i]) : '';
  if (!name || MENTION_ONLY.test(name)) return false;

  // the program may be run through another one: `docker exec api cat .env`, `sh -c "cat .env"`
  for (let j = i; j < words.length; j++) {
    const n = baseName(words[j]);
    if (j > i && (PRINTERS.test(n) || SEARCHERS.test(n) || SCRIPTED.test(n))) {
      if (readsEnv(words.slice(j))) return true;
    }
    if (SHELLS.test(name) && /\s/.test(words[j]) && splitCommands(words[j]).some(readsEnv)) return true;
  }

  // the arguments, without redirections (`> out.txt` is written, not read)
  const args = [];
  let patternFromFlag = false;
  for (let j = i + 1; j < words.length; j++) {
    const w = words[j];
    if (w === '>') {
      j++;
      while (words[j] === '>') j++;
      continue;
    }
    if (w === '<') continue;
    if (FILE_FLAGS.test(w) && isEnvFile(words[j + 1] || '')) return true; // grep -f .env, rg -g '.env*'
    if (/^--(?:file|glob|iglob)=/.test(w) && isEnvFile(w.split('=')[1])) return true;
    if (PATTERN_FLAGS.test(w)) patternFromFlag = true;
    const awkValue = /^g?awk$/.test(name) && (w === '-F' || w === '-v'); // awk -F , / -v x=1
    if (VALUE_FLAGS.has(w) || awkValue || (PATTERN_FLAGS.test(w) && !/^\/c:/i.test(w))) {
      j++; // skip the flag's value
      continue;
    }
    if (/^-/.test(w) || (name === 'findstr' && /^\//.test(w))) continue; // other flags
    args.push(w);
  }

  if (PRINTERS.test(name)) return args.some(isEnvFile);
  if (SEARCHERS.test(name) || SCRIPTED.test(name)) {
    // the first argument is the pattern / script (unless it came from a flag), the rest are files
    const files = patternFromFlag ? args : args.slice(1);
    return files.some(isEnvFile);
  }
  return false;
}

// ---------------------------------------------------------------- prose and mentions

// Commit messages and PR / issue text are prose, not commands. Claude usually passes them as
//   git commit -m "$(cat <<'EOF' ... EOF)"        (bash)
//   git commit -m @' ... '@                        (PowerShell)
// so that text is removed before matching: a message that merely MENTIONS `.env` or
// `git reset --hard` must not be blocked. Everything after the next `&&`, `;` or `|` is still checked.
const PROSE = new RegExp(
  String.raw`(?:${GIT}(?:commit|tag)|\bgh(?:\.exe)?\s+(?:(?:pr|issue|release)\s+\w+|api))\b(?:` +
    String.raw`${PIECE}*?<<-?\s*['"]?(\w+)['"]?[\s\S]*?\n[ \t]*\1\b[^;&|\n]*` + // bash heredoc
    String.raw`|${PIECE}*?@(['"])[ \t]*\r?\n[\s\S]*?\r?\n\2@[^;&|\n]*` + // PowerShell here-string
    String.raw`|(?:"[^"]*"|'[^']*'|[^;&|\n"'])*` + // plain -m "..." (may span lines)
    ')',
  'g'
);

// Search and print commands only MENTION text: `grep -rn "git reset --hard" docs`,
// `echo "never run git push --force"`. Their quoted arguments are blanked before the
// ALWAYS / DB rules run. Exception: echo/printf piped into a database client or shell
// (`echo "DROP TABLE x" | psql`) — then the text IS the command, so it is kept.
const MENTION = new RegExp(
  String.raw`(^\s*|[;&|(\n]\s*|\b(?:xargs|sudo)(?:\s+-\S+)*\s+|\s-exec(?:dir)?\s+)` +
    String.raw`((?:grep|egrep|fgrep|rg|ag|ack|findstr|Select-String|sls|man|which|where|whereis|Get-Command|gcm|sed|git\s+(?:log|grep|show)|echo|printf|Write-Host|Write-Output)\b${PIECE}*)`,
  'gi'
);
const RUNS_TEXT = /^\s*\|(?!\|)\s*(?:\w+=\S*\s+)*(?:sudo\s+)?(?:psql|mysql|mariadb|mongosh|mongo|sqlite3|sqlcmd|redis-cli|bash|sh|zsh|dash|pwsh|powershell|cmd|iex|Invoke-Expression|docker|kubectl|ssh|xargs)\b/i;
function blankMentions(text) {
  return text.replace(MENTION, (whole, lead, seg, offset) => {
    const isPrint = /^(?:echo|printf|Write-Host|Write-Output)\b/i.test(seg);
    if (isPrint && RUNS_TEXT.test(text.slice(offset + whole.length))) return whole;
    return lead + seg.replace(/"[^"\n]*"|'[^'\n]*'/g, '""');
  });
}

// ---------------------------------------------------------------- main

let input = {};
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
} catch {
  process.exit(0);
}

const raw = String((input && input.tool_input && input.tool_input.command) || '');
if (!raw) process.exit(0);
const cmd = raw.replace(PROSE, ' _text_ ');
const code = blankMentions(cmd);

function block(reason) {
  process.stderr.write(
    `Blocked by .claude/hooks/guard.cjs: ${reason}.\n` +
      `Do not try to work around this. If it is really needed, ask the user to run it themselves.\n`
  );
  process.exit(2);
}

if (splitCommands(cmd).some(readsEnv)) block('reading a .env file exposes secrets (read .env.example instead)');
for (const [pattern, reason] of ALWAYS) if (pattern.test(code)) block(reason);
if (DB_CONTEXT.test(code)) for (const [pattern, reason] of DB_ONLY) if (pattern.test(code)) block(reason);
process.exit(0);
