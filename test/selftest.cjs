#!/usr/bin/env node
// Self-test for the template. Run from the template folder:
//
//   node test/selftest.cjs
//
// Checks the hook scripts and the installer directly (no Claude Code, no network,
// no model calls). Run it after updating Node, Claude Code, or any template file.
// It works in a temporary folder and cleans up after itself.

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HOOKS = path.join(ROOT, 'template', '.claude', 'hooks');
const GUARD = path.join(HOOKS, 'guard.cjs');
const VERIFY = path.join(HOOKS, 'verify.cjs');
const FORMAT = path.join(HOOKS, 'format.cjs');
const INSTALL = path.join(ROOT, 'install.cjs');

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++;
  else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? '  — ' + detail : ''}`);
  }
}
function section(title) {
  console.log(`\n${title}`);
}
function runHook(script, input, env = {}) {
  const r = spawnSync(process.execPath, [script], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 60 * 1000,
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cct-selftest-'));
const session = `selftest-${process.pid}`;
const flagDir = path.join(os.tmpdir(), 'claude-code-verify');
const flagPath = path.join(flagDir, `${session}.json`);

try {
  // ------------------------------------------------------------------ guard
  section('guard.cjs');
  const heredoc = (head, body, tail = '') => `${head} "$(cat <<'EOF'\n${body}\nEOF\n)"${tail}`;
  const BLOCK = [
    // ORMs
    'npx prisma migrate reset', 'npx prisma db push --force-reset', 'pnpm prisma db push --accept-data-loss',
    'npx typeorm schema:drop -d src/data-source.ts', 'npx sequelize db:drop',
    // git
    'git push origin main --force', 'git push -f', 'git push --force origin main', 'git push origin +main',
    'git reset --hard HEAD~1', 'git clean -fd', 'git clean --force', 'git checkout .', 'git checkout -- .', 'git restore .',
    'cd api && git push --force',
    // docker
    'docker compose down -v', 'docker-compose down --volumes', 'docker volume rm pgdata', 'docker volume prune',
    // SQL / Mongo / Redis
    "psql -c 'DROP TABLE users'", "psql -c 'TRUNCATE users'", 'psql -c "DELETE FROM users;"', 'mysql -e "drop database app"',
    "mongosh --eval 'db.dropDatabase()'", "mongosh --eval 'db.users.drop()'", "mongosh --eval 'db.users.deleteMany({})'",
    'node -e "await User.deleteMany()"', 'redis-cli FLUSHALL', 'redis-cli -n 1 flushdb',
    'npx typeorm query "DROP TABLE users"', 'npx knex raw "truncate table orders"',
    'docker exec -it pg psql -U postgres -c "DROP DATABASE app"', 'docker compose exec db mysql -e "DELETE FROM users"',
    'psql <<EOF\nDROP TABLE users;\nEOF', 'echo "DROP TABLE users;" | psql', "printf 'TRUNCATE orders;' | psql -U app",
    // filesystem
    'rm -rf .', 'rm -rf /', 'rm -rf /*', 'rm -rf ~/', 'rm -rf ~', 'rm -r -f /', 'rm -f -r .', 'rm -rf ..', 'rm -rf ./*',
    'rm -rf *', 'rm -Rf *', 'rm --recursive --force .', 'rm -Recurse -Force .', 'rm -rf $HOME', 'rm -rf "$HOME"/', 'rm -rf ${HOME}/*',
    'Remove-Item -Recurse -Force .', 'Remove-Item . -Recurse -Force', 'Remove-Item -Recurse C:\\',
    // processes by name
    'taskkill /IM node.exe /F', 'taskkill /F /IM node.exe', 'taskkill /f /im node.exe /t', 'taskkill -IM node.exe -F',
    'cmd /c taskkill /IM node.exe /F', 'cmd /c "taskkill /IM node.exe /F"', 'taskkill /IM chrome.exe',
    'killall node', 'killall -9 node', 'sudo killall nodemon', 'npm stop; killall node',
    'pkill node', 'pkill -9 node', 'pkill nodemon', 'pkill -f node', 'pkill -9 -f node', 'pkill -f "node"', 'pkill -f npm',
    'sudo pkill node', '(pkill node)',
    'Stop-Process -Name node -Force', 'Stop-Process -Force -Name node', 'spps -Name node', 'kill -Name node',
    'Stop-Process -ProcessName node', 'Get-Process node | Stop-Process -Force', 'Get-Process -Name node | Stop-Process',
    'gps node | spps', 'powershell -Command "Stop-Process -Name node -Force"',
    'kill -9 $(pgrep node)', 'kill $(pidof node)', 'kill -9 `pgrep node`', 'pgrep node | xargs kill',
    'pgrep -f nest | xargs kill -9', 'wmic process where name="node.exe" delete',
    'wmic process where "name=\'node.exe\'" call terminate', 'npm run build && taskkill /IM node.exe /F',
    // secrets
    'cat .env', 'cat ./apps/api/.env', 'head -5 .env.local', 'cat .env.production', 'Get-Content .env', 'cat ".env"',
    'cat .env | grep DB', 'grep DATABASE_URL .env', 'grep -n "" .env.local', 'sed -n p .env', 'awk "{print}" apps/api/.env',
    'grep SECRET .env | head -3', 'grep KEY "apps/api/.env"', 'Select-String -Pattern KEY -Path .env', 'grep -v "^#" .env.production',
    // publish
    'npm publish', 'pnpm publish --access public',
    // prose / mentions must NOT hide a real command that follows them
    'git commit -m "wip" && git push --force', 'git commit -m "wip"; git reset --hard HEAD~1',
    heredoc('git commit -m', 'feat: add users', ' && git push --force'),
    'git commit -m "a"\npsql <<EOF\nDROP TABLE users;\nEOF', 'git commit -m "x" && cat .env',
    'git commit -m "x" && taskkill /IM node.exe /F', 'grep -rn TODO src && git reset --hard',
    'echo "cleaning up" && rm -rf .', 'echo done; killall node',
    // git: global options before the subcommand, flags in any order, other ways to discard work
    'git -C ../api reset --hard', 'git -C "my dir/api" reset --hard', 'git -C apps/web push --force',
    'git -c core.x=y clean -fd', 'git --no-pager reset --hard HEAD~1', 'git --git-dir ../x/.git --work-tree ../x checkout .',
    'git reset HEAD~1 --hard', 'git reset -q --hard origin/main', 'git checkout HEAD -- .', 'git checkout HEAD .',
    'git restore -W .', 'git restore --source=HEAD --staged --worktree .', 'git.exe reset --hard', 'git push -uf origin main',
    'git -C api commit -m "wip" && git reset --hard',
    // processes: other ways to kill by name
    'taskkill /F /FI "IMAGENAME eq node.exe"', 'MSYS_NO_PATHCONV=1 taskkill /IM node.exe /F',
    "Get-Process | Where-Object { $_.ProcessName -eq 'node' } | Stop-Process -Force",
    'Get-Process -Name node | ForEach-Object { Stop-Process -Id $_.Id }', 'ps node | Stop-Process',
    "ps aux | grep node | grep -v grep | awk '{print $2}' | xargs kill -9",
    'bash -c "killall node"', 'powershell -ExecutionPolicy Bypass -Command "Stop-Process -Name node"',
    'if pgrep node >/dev/null; then killall node; fi', 'timeout 5 killall node', 'sudo -u me killall node',
    'env killall node', 'cmd.exe /d /c taskkill /IM node.exe', '/usr/bin/killall node', 'pkill --full node',
    'kill $(pgrep -f "node")', 'pgrep -f vite | xargs kill',
    // recursive delete: more spellings
    'Remove-Item -Recurse -Force $HOME', 'Remove-Item -Recurse -Force $env:USERPROFILE', 'Remove-Item -r -fo .',
    'ri -Recurse -Force .', 'rmdir /s /q .', 'rm -rf .git', 'rm -rf ./.git/', 'Remove-Item -Recurse -Force .git', 'rd /s /q .git', 'rd /s /q C:\\', 'rm -rf "$(pwd)"', 'rm -rf $PWD', 'rm -rf ../../', 'rm -rf ../..',
    // databases
    'dropdb myapp_dev', 'mysqladmin -u root drop app', 'docker system prune -a --volumes', 'npx mikro-orm schema:drop --run',
    "mongosh --eval 'db.users.remove({})'",
    // .env with something after the file name, through other programs, globs, redirection
    'grep DATABASE_URL .env 2>/dev/null', 'grep KEY .env -n', "rg X -g '.env*'", 'grep -f .env src', 'grep -e KEY .env',
    'docker compose exec api cat .env', 'sh -c "cat .env"', 'while read l; do echo $l; done < .env', 'cat .env 2>&1',
    'findstr KEY .env', 'awk -F= "{print $1}" .env', 'Get-Content -Path .\\.env', 'cat .env*',
    // publishing
    'pnpm -r publish', 'npx changeset publish', 'npm run publish',
  ];
  const ALLOW = [
    'npm run start:dev', 'npx prisma migrate dev --name add_user', 'npx prisma db push', 'npx prisma generate',
    'npx prisma migrate dev --name drop_table_legacy', 'npx typeorm migration:run -d src/data-source.ts',
    'npx typeorm migration:generate src/migrations/AddUser', 'npx knex migrate:latest', 'npx sequelize db:migrate',
    'git push --force-with-lease', 'git push --force-with-lease --force-if-includes', 'git push origin feature-fix',
    'git push origin main && rm -f tmp.txt', 'git push -u origin feat/x', 'git push --follow-tags', 'git push -u origin feat/add-f-flag',
    'git checkout -b feat/x', 'git checkout main', 'git checkout ./src/a.ts', 'git restore --staged .', 'git reset HEAD~1',
    'git reset --soft HEAD~1', 'git clean -n', 'git clean --dry-run',
    'docker compose down', 'docker compose up -d', 'docker compose down && docker compose up -d -v',
    'grep -rn "DROP TABLE" prisma/migrations', 'git log --grep="delete from"',
    'psql -c "DELETE FROM users WHERE id = 5"', 'psql -c "select * from users"', 'node dist/main.js', 'npx ts-node src/seed.ts',
    'node -e "await User.deleteMany({ role: 1 })"', 'redis-cli get user:1',
    'rm -rf dist', 'rm -rf ./node_modules', 'rm -rf node_modules dist', 'rm -f *.log', 'rm -rf ./dist/*', 'rm tmp.txt',
    'rm -rf $HOME/projects/old-app/dist', 'rm -Recurse -Force dist', 'Remove-Item -Recurse -Force dist', 'Remove-Item -Recurse .\\dist',
    'rm -rf .next .turbo node_modules/.cache',
    // processes by PID / port
    'taskkill /PID 12345 /F', 'taskkill /F /PID 12345 /T', 'kill 12345', 'kill -9 12345', 'kill -TERM 12345', 'kill %1',
    'Stop-Process -Id 12345 -Force', 'Get-Process -Id 12345 | Stop-Process', 'npx kill-port 3000', 'npx kill-port 3000 5432',
    'lsof -ti :3000 | xargs kill', 'lsof -ti:3000 | xargs kill -9', 'netstat -ano | findstr :3000', 'Get-Process node',
    'pgrep -fl node', 'tasklist /FI "IMAGENAME eq node.exe"', 'pkill -f "nest start --watch"', 'pkill -f "node dist/main.js"',
    'npm run kill', 'Get-NetTCPConnection -LocalPort 3000 | Select-Object OwningProcess',
    // only MENTIONING a dangerous command (search, print, help)
    'grep -rn "killall" scripts/', 'grep -rn killall scripts/', 'grep -rn "taskkill /IM" docs README.md', 'rg "pkill node" .',
    'which pkill', 'pkill --help', 'man killall', 'echo "use taskkill /PID instead of taskkill /IM"',
    'cat scripts/stop.sh | grep pkill', 'npm run dev -- --name killall-demo', 'find . -name "*.log" -delete',
    'grep -rn "git reset --hard" docs', 'grep -rn "prisma migrate reset" .', 'echo "never run git push --force"',
    'rg "docker compose down -v" README.md', 'echo "DROP TABLE x" > schema-notes.txt', 'git log --oneline --grep "rm -rf ."',
    // secrets that are fine
    'cat .env.example', 'cat .env.sample', 'cat src/config/env.ts', 'cat .envrc', 'cat package.json',
    'grep -rn "process.env" src', 'grep -rn "import.meta.env" src', 'grep -rn "DATABASE_URL" src', 'grep .env .gitignore',
    'grep -n "\\.env" .gitignore', 'grep -c KEY .env.example', 'grep -rn "dotenv" package.json', 'rg "process\\.env\\.PORT" src',
    'sed -n 1,20p src/main.ts', 'git check-ignore .env', 'ls -la .env',
    'npx jest src/users', 'npm run build', 'npm pack --dry-run', 'yarn install',
    // prose that only MENTIONS risky things (commit messages, PR bodies)
    heredoc('git commit -m', 'fix: load .env before reading config\n\nCo-Authored-By: Claude <noreply@anthropic.com>'),
    heredoc('git add src/a.ts && git commit -m', 'chore: never run git reset --hard; use git stash', ' && git status'),
    heredoc('gh pr create --title "Guard: block a & b" --body', 'Blocks `git reset --hard`, `git push --force` and `prisma migrate reset`.\nAlso stops `cat .env`.'),
    heredoc('gh issue create --title "DB wipe" --body', 'Someone ran DROP TABLE users via psql; add a guard.'),
    'git commit -m "docs: explain why we never run prisma migrate reset"', 'git commit -m "chore: stop using git clean -fd in scripts"',
    'git commit -m "fix: read .env.local in dev"', 'git commit -m "truncate long output in logger"',
    'git commit -m "drop table of contents from README"', "git commit -m 'feat: a; b | c && d (rm -rf / is blocked now)'",
    'git tag -a v1.0.0 -m "release: removes rm -rf . from scripts"', 'git commit -m "first line\nsecond line mentions git push --force"',
    'git commit -m "fix(guard): block taskkill /IM node.exe and killall node"',
    // git with global options, safe variants
    'git -C ../api status', 'git -C api commit -m "docs: never run git reset --hard"', 'git -C api push --force-with-lease',
    'git --no-pager log --oneline', 'git -C api clean -n', 'git clean -fdn', 'git restore . --staged', 'git restore -S .',
    'git -c user.name=x commit -m "$(cat <<\'EOF\'\nexplain git push --force and cat .env\nEOF\n)"',
    // PowerShell here-string commit messages (with an apostrophe)
    "git commit -m @'\nfix: don't block grep\n\nPreviously `git reset --hard` and cat .env were matched\n'@",
    'git commit -m @"\nfix: stop killall node in docs\n"@',
    // .env only mentioned, or written (not read)
    'ls -la | grep .env', 'git ls-files | grep .env', 'dir /a | findstr .env', 'cat .env.local.example', 'cat .env.example > .env',
    'cp .env.example .env', 'grep -v "^#" .env.example', 'echo "cat .env is blocked"',
    // only mentions or lookups
    'find docs -name "*.md" | xargs grep -l "prisma migrate reset"', 'find . -exec grep -n "git reset --hard" {} +',
    '  grep -rn "git push --force" docs', 'sudo grep -rn "killall" /etc/cron.d',
    'echo \'{"tool_input":{"command":"git reset --hard"}}\' | node .claude/hooks/guard.cjs',
    'command -v pkill', 'Get-Command Stop-Process', "sed -i 's/git push --force/git push --force-with-lease/' x.sh",
    'gh api repos/o/r/issues/1/comments -f body="never run git reset --hard"', 'npm publish --dry-run',
    'npm run publish-docs', 'kill 1234 && find . -name "*.log"', 'Remove-Item -Recurse -Force dist && git add .',
    'Remove-Item -Recurse -Force dist && cd ..',
    // kill by PID / specific command line
    'kill $(pgrep -f "node dist/main.js")', 'pgrep -f "nest start" | xargs kill', 'pkill --full "node dist/main.js"',
    'Get-NetTCPConnection -LocalPort 3000 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }',
    'rm -rf ../dist', 'rm -rf ./build/*', 'rm -rf .github/workflows/old.yml', 'rm .gitkeep', 'git rm --cached .gitignore',
    // everyday commands
    'rm -rf node_modules package-lock.json && npm install', 'git stash && git checkout main && git stash pop',
    'docker exec -it pg psql -U postgres -c "select count(*) from users"', 'Test-Path .env', 'node --env-file=.env dist/main.js',
    'Select-String -Path src\\*.ts -Pattern "TODO"', 'git commit --amend --no-edit', 'npx prisma db seed', 'rd /s /q dist', 'Remove-Item -Recurse $env:TEMP\\cct',
  ];
  for (const cmd of BLOCK) {
    const r = runHook(GUARD, { tool_input: { command: cmd } });
    check(`block: ${JSON.stringify(cmd).slice(0, 90)}`, r.code === 2, `exit ${r.code}`);
  }
  for (const cmd of ALLOW) {
    const r = runHook(GUARD, { tool_input: { command: cmd } });
    check(`allow: ${JSON.stringify(cmd).slice(0, 90)}`, r.code === 0, `exit ${r.code}`);
  }
  check('guard: malformed input is allowed', runHook(GUARD, 'not json').code === 0);
  check('guard: null input is allowed', runHook(GUARD, 'null').code === 0);
  {
    // a long commit message must not make the regexes slow (the hook has a 10 s timeout)
    const names = Array.from({ length: 60 }, (_, i) => `'f${i}'`).join(', ');
    for (const cmd of [`git commit -m "refactor: rename ${names}"`, `grep -rn "${names}" src`, `git commit -m "${names}" && git reset --hard`]) {
      const t0 = Date.now();
      const r = runHook(GUARD, { tool_input: { command: cmd } });
      const ms = Date.now() - t0;
      check(`guard: long command is fast (${ms} ms)`, ms < 3000, `${ms} ms`);
      check('guard: long command gives the right answer', r.code === (cmd.includes('reset') ? 2 : 0), `exit ${r.code}`);
    }
  }
  console.log(`  ${BLOCK.length} block + ${ALLOW.length} allow cases`);

  // ------------------------------------------------------------------ verify
  section('verify.cjs');
  const proj = path.join(tmp, 'proj');
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  const env = { CLAUDE_PROJECT_DIR: proj };
  const setTest = (script) =>
    fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'p', scripts: { test: script } }));
  const edit = (file) =>
    runHook(VERIFY, { session_id: session, hook_event_name: 'PostToolUse', tool_input: { file_path: file } }, env);
  const stop = () => runHook(VERIFY, { session_id: session, hook_event_name: 'Stop' }, env);
  const pre = (command) =>
    runHook(VERIFY, { session_id: session, hook_event_name: 'PreToolUse', tool_input: { command } }, env);
  const flagSet = () => fs.existsSync(flagPath);
  const reset = () => fs.rmSync(flagPath, { force: true });
  const PASS = 'node -e "process.exit(0)"';
  const FAIL = 'node -e "console.error(\'FAIL x\');process.exit(1)"';

  reset();
  setTest(FAIL);
  check('no edit -> stop allowed', stop().code === 0);
  edit('README.md');
  check('non-code edit -> no flag', !flagSet());
  edit(path.join(tmp, 'elsewhere.ts'));
  check('edit outside project -> no flag', !flagSet());
  edit('.claude/scratch/repro.ts');
  check('edit in .claude/ -> no flag', !flagSet());
  edit('src/a.ts');
  check('code edit -> flag set', flagSet());
  check('failing check blocks stop (exit 2)', stop().code === 2);
  const again = stop();
  check('stop again without edit -> released with warning', again.code === 0 && /systemMessage/.test(again.out));
  reset();

  edit('src/a.ts');
  check('commit gate: failing check blocks git commit', pre('git commit -m "x"').code === 2);
  check('commit gate: other commands pass', pre('git status').code === 0);
  check('commit gate: --no-verify passes', pre('git commit --no-verify -m "x"').code === 0);
  check('commit gate: -n passes', pre('git commit -n -m "x"').code === 0);
  for (const c of ['grep -rn "git commit" docs', 'echo "remember to git commit"', 'gh pr create --body "run git commit first"']) {
    check(`commit gate: only mentions "git commit" -> passes: ${c}`, pre(c).code === 0);
  }
  for (const c of [
    'git commit -m "docs: explain --no-verify"', 'git commit -m x && git push --no-verify', 'git -C "my app" commit -m x',
    'git.exe commit -m x', 'git add . && git commit -m x', "git commit -m @'\nfix: don't\n'@", 'git -c user.name=x commit -am x',
  ]) {
    check(`commit gate: blocks ${JSON.stringify(c)}`, pre(c).code === 2);
  }
  reset();

  // package manager not installed: the check is skipped with a warning, not counted as a failure
  const bunMissing = spawnSync('bun --version', { shell: true, encoding: 'utf8' }).status !== 0;
  if (bunMissing) {
    setTest(PASS);
    fs.writeFileSync(path.join(proj, 'bun.lock'), '');
    edit('src/a.ts');
    const noPm = stop();
    check('missing package manager -> not a failure, user warned', noPm.code === 0 && /bun is not installed/.test(noPm.out), noPm.err.split('\n')[0]);
    fs.rmSync(path.join(proj, 'bun.lock'));
    reset();
  } else {
    console.log('  (bun is installed here: the "package manager missing" case is not tested)');
  }

  setTest(PASS);
  edit('src/a.ts');
  check('passing check -> commit allowed', pre('git commit -m "x"').code === 0);
  check('passing check clears flag', !flagSet());
  edit('src/a.ts');
  check('passing check -> stop allowed', stop().code === 0 && !flagSet());

  setTest(FAIL);
  edit('src/a.ts');
  stop();
  edit('src/a.ts');
  stop();
  edit('src/a.ts');
  check('third failed attempt still blocks', stop().code === 2);
  edit('src/a.ts');
  const released = stop();
  check('after 3 attempts -> released with warning', released.code === 0 && /STILL failing/.test(released.out));
  reset();

  // monorepo: package.json in a subfolder
  fs.mkdirSync(path.join(proj, 'services', 'api', 'src'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'services', 'api', 'package.json'), JSON.stringify({ name: 'api', scripts: { test: FAIL } }));
  setTest(PASS);
  edit('services/api/src/a.ts');
  const mono = stop();
  check('monorepo: checks run in the edited package', mono.code === 2 && /in services\/api/.test(mono.err), mono.err.split('\n')[0]);
  reset();

  // timeout: the hook must give up and not hang
  setTest('node -e "setTimeout(()=>{},60000)"');
  edit('src/a.ts');
  const t0 = Date.now();
  const slow = runHook(VERIFY, { session_id: session, hook_event_name: 'Stop' }, { ...env, CLAUDE_VERIFY_BUDGET_MS: '2000' });
  check('slow check is stopped with a warning', slow.code === 0 && /took too long/.test(slow.out));
  check('slow check: hook returns quickly', Date.now() - t0 < 20000, `${Date.now() - t0}ms`);
  reset();
  check('verify: malformed input is allowed', runHook(VERIFY, 'not json', env).code === 0);

  // ------------------------------------------------------------------ format
  section('format.cjs');
  const fmt = (file) => runHook(FORMAT, { tool_input: { file_path: file } }, env);
  check('no Prettier installed -> exits 0', fmt('src/a.ts').code === 0);
  check('malformed input -> exits 0', runHook(FORMAT, 'not json', env).code === 0);
  console.log('  (formatting itself needs Prettier installed in a project, so it is not tested here)');

  // ------------------------------------------------------------------ installer
  section('install.cjs');
  const target = path.join(tmp, 'target');
  fs.mkdirSync(target);
  const inst = (...args) => spawnSync(process.execPath, [INSTALL, target, ...args], { encoding: 'utf8' }).stdout || '';
  const first = inst();
  check('fresh install creates 14 files', (first.match(/ create /g) || []).length === 14, `${(first.match(/ create /g) || []).length}`);
  const second = inst();
  check('second run changes nothing', !/ (create|update|merge) /.test(second));
  const installed = JSON.parse(fs.readFileSync(path.join(target, '.claude', 'settings.json'), 'utf8'));
  const tmpl = JSON.parse(fs.readFileSync(path.join(ROOT, 'template', '.claude', 'settings.json'), 'utf8'));
  check('installed settings equal the template', JSON.stringify(installed) === JSON.stringify(tmpl));
  const own = { model: 'sonnet', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } };
  fs.writeFileSync(path.join(target, '.claude', 'settings.json'), JSON.stringify(own));
  inst();
  const merged = JSON.parse(fs.readFileSync(path.join(target, '.claude', 'settings.json'), 'utf8'));
  check(
    'merge keeps your own settings and hooks',
    merged.model === 'sonnet' && merged.hooks.Stop.some((e) => e.hooks.some((h) => h.command === 'echo mine'))
  );
  fs.appendFileSync(path.join(target, '.claude', 'hooks', 'guard.cjs'), '\n// my edit\n');
  check('changed hook is left alone without --force', /guard\.cjs \(differs from template/.test(inst()));
  check('--force updates and keeps a .bak', / update .*guard\.cjs/.test(inst('--force')) &&
    fs.existsSync(path.join(target, '.claude', 'hooks', 'guard.cjs.bak')));
  {
    // a second --force must not overwrite the first backup
    const hooksDir = path.join(target, '.claude', 'hooks');
    const firstBak = fs.readFileSync(path.join(hooksDir, 'guard.cjs.bak'), 'utf8');
    fs.appendFileSync(path.join(hooksDir, 'guard.cjs'), '\n// second edit\n');
    inst('--force');
    const baks = fs.readdirSync(hooksDir).filter((f) => /^guard\.cjs\..*bak$/.test(f));
    check('second --force keeps the first .bak and adds another', baks.length === 2 &&
      fs.readFileSync(path.join(hooksDir, 'guard.cjs.bak'), 'utf8') === firstBak, baks.join(', '));
  }
  {
    // settings.json with a BOM is read; a broken structure stops the install BEFORE anything is copied
    const t2 = path.join(tmp, 'target2');
    fs.mkdirSync(path.join(t2, '.claude'), { recursive: true });
    const sp = path.join(t2, '.claude', 'settings.json');
    fs.writeFileSync(sp, '﻿' + JSON.stringify({ permissions: { deny: 'Bash(rm:*)' } }));
    const r1 = spawnSync(process.execPath, [INSTALL, t2], { encoding: 'utf8' });
    const s1 = JSON.parse(fs.readFileSync(sp, 'utf8'));
    check('settings.json with BOM + string deny is merged', r1.status === 0 && s1.permissions.deny.includes('Bash(rm:*)'), r1.stderr);
    const t3 = path.join(tmp, 'target3');
    fs.mkdirSync(path.join(t3, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(t3, '.claude', 'settings.json'), JSON.stringify({ hooks: { Stop: { command: 'x' } } }));
    const r2 = spawnSync(process.execPath, [INSTALL, t3], { encoding: 'utf8' });
    check('broken hooks structure -> clear error, nothing copied', r2.status === 1 && /hooks\.Stop" must be an array/.test(r2.stderr) &&
      !fs.existsSync(path.join(t3, '.claude', 'hooks')), r2.stderr);
  }

  // ------------------------------------------------------------------ files
  section('template files');
  const agentsDir = path.join(ROOT, 'template', '.claude', 'agents');
  const COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan'];
  for (const f of fs.readdirSync(agentsDir)) {
    const m = fs.readFileSync(path.join(agentsDir, f), 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const fm = m ? Object.fromEntries(m[1].split(/\r?\n/).map((l) => [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1).trim()])) : {};
    check(`agent ${f}: valid frontmatter`, fm.name === f.replace(/\.md$/, '') && !!fm.description && COLORS.includes(fm.color));
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(flagPath, { force: true });
}

console.log(`\n${fail ? 'FAILED' : 'OK'}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
