#!/usr/bin/env node
// "Completion fence" (idea from agyis-harness). One script, three events:
//
//   PostToolUse (Edit|Write|MultiEdit): Claude edited a code file in this
//       project -> remember "code is dirty" for this session, and which
//       package (nearest package.json) the file belongs to.
//   PreToolUse (Bash|PowerShell): commit gate. If code is dirty and the
//       command is `git commit`, run the checks first; block the commit if
//       they fail. (`git commit --no-verify` skips the gate.)
//   Stop: Claude wants to finish. If code is dirty, run typecheck + tests
//       in every package that was touched.
//       - pass  -> clear the flag, let Claude stop.
//       - fail  -> exit 2: Claude sees the error and must keep working.
//       Claude is let go (and you get a warning) when it stops again WITHOUT
//       changing code, or after MAX_BLOCKS failed fix attempts — so it can
//       never loop forever.
//
// Customize per package: add a "claude:verify" script to its package.json and
// ONLY that script is run instead of the defaults. Example:
//   "claude:verify": "tsc --noEmit && eslint src && jest --onlyChanged"

const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CODE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const MAX_BLOCKS = 3; // failed verifications in a row before giving up
const MAX_OUTPUT = 2000; // only the tail of the error goes to Claude (compactor idea)
const KEEP_OUTPUT = 100 * 1000; // how much raw output we keep in memory per check
const MAX_ROOTS = 8; // packages verified in one go (monorepos)
const FLAG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // forget flags of sessions that never finished
// Whole Stop hook must finish inside the 300s timeout set in settings.json.
const BUDGET_MS = Number(process.env.CLAUDE_VERIFY_BUDGET_MS) || 270 * 1000;

function readStdin() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function isInside(dir, file) {
  const rel = path.relative(dir, path.resolve(dir, file));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// Walks from `start` up to (and including) `top`; returns the first folder where test() is true.
function findUp(start, top, test) {
  let cur = path.resolve(start);
  const stop = path.resolve(top);
  for (;;) {
    if (test(cur)) return cur;
    if (cur === stop || !isInside(stop, cur)) return null;
    cur = path.dirname(cur);
  }
}

// ---------- dirty flag (one small file per session, in the OS temp folder) ----------

const FLAG_DIR = path.join(os.tmpdir(), 'claude-code-verify');

function flagFile(input, dir) {
  const id = input.session_id || crypto.createHash('sha1').update(dir).digest('hex');
  return path.join(FLAG_DIR, String(id).replace(/[^\w.-]/g, '_') + '.json');
}
function readFlag(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
function writeFlag(file, data) {
  fs.mkdirSync(FLAG_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}
function clearFlag(file) {
  try {
    fs.unlinkSync(file);
  } catch {}
}
function pruneOldFlags() {
  try {
    for (const name of fs.readdirSync(FLAG_DIR)) {
      const f = path.join(FLAG_DIR, name);
      if (Date.now() - fs.statSync(f).mtimeMs > FLAG_MAX_AGE_MS) fs.unlinkSync(f);
    }
  } catch {}
}

// ---------- what to run ----------

function detectPackageManager(root, projectDir) {
  const has = (dir, name) => fs.existsSync(path.join(dir, name));
  // the lockfile may live at the monorepo root, above the package
  const dir = findUp(root, projectDir, (d) =>
    ['pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock', 'package-lock.json'].some((n) => has(d, n))
  );
  if (!dir) return 'npm';
  if (has(dir, 'pnpm-lock.yaml')) return 'pnpm';
  if (has(dir, 'yarn.lock')) return 'yarn';
  if (has(dir, 'bun.lockb') || has(dir, 'bun.lock')) return 'bun';
  return 'npm';
}

// Path of a locally installed CLI (never downloads anything), or null.
// Looks in the package's node_modules, then in parent folders (hoisted installs).
function resolveBin(root, projectDir, pkgName, binName) {
  const pkgJsonOf = (dir) => path.join(dir, 'node_modules', pkgName, 'package.json');
  const dir = findUp(root, projectDir, (d) => fs.existsSync(pkgJsonOf(d)));
  if (!dir) return null;
  try {
    const bin = JSON.parse(fs.readFileSync(pkgJsonOf(dir), 'utf8')).bin;
    const rel = typeof bin === 'string' ? bin : bin && bin[binName];
    const full = rel && path.join(dir, 'node_modules', pkgName, rel);
    return full && fs.existsSync(full) ? full : null;
  } catch {
    return null;
  }
}

// Checks for one package folder (`root`, a folder that holds a package.json).
function buildChecks(root, projectDir) {
  let scripts;
  try {
    scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts || {};
  } catch {
    return []; // no (valid) package.json -> nothing to verify
  }
  const pm = detectPackageManager(root, projectDir);
  const rel = path.relative(projectDir, root).split(path.sep).join('/');
  const where = rel ? ` (in ${rel})` : '';

  // 1. Package-specific override wins.
  if (scripts['claude:verify']) {
    return [{ label: `${pm} run claude:verify${where}`, cwd: root, shell: `${pm} run claude:verify` }];
  }

  // 2. Defaults: typecheck (if TypeScript is installed) + the "test" script.
  const checks = [];
  const tsc = fs.existsSync(path.join(root, 'tsconfig.json')) && resolveBin(root, projectDir, 'typescript', 'tsc');
  if (tsc) {
    checks.push({ label: `tsc --noEmit${where}`, cwd: root, file: process.execPath, args: [tsc, '--noEmit', '--pretty', 'false'] });
  }
  if (scripts.test && !scripts.test.includes('no test specified')) {
    checks.push({ label: `${pm} run test${where}`, cwd: root, shell: `${pm} run test` });
  }
  return checks;
}

// Kill the command AND everything it started (npm -> jest -> workers).
// Killing only the shell would leave the test runner alive in the background.
function killTree(child) {
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(-child.pid, 'SIGKILL'); // negative pid = the whole process group
    }
  } catch {}
}

// Runs one check. Resolves { ok, timedOut, out } — never rejects.
function run(check, timeoutMs) {
  return new Promise((resolve) => {
    const env = { ...process.env, CI: 'true', NO_COLOR: '1' }; // CI=true: no watch mode
    delete env.FORCE_COLOR;
    const opts = {
      cwd: check.cwd,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32', // own process group so killTree can reach children
    };

    let child;
    try {
      child = check.shell ? spawn(check.shell, { ...opts, shell: true }) : spawn(check.file, check.args, opts);
    } catch (err) {
      return resolve({ ok: false, timedOut: false, out: String(err) });
    }

    let out = '';
    const collect = (chunk) => {
      out += chunk;
      if (out.length > 2 * KEEP_OUTPUT) out = out.slice(-KEEP_OUTPUT); // keep only the tail
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    let timedOut = false;
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
      // Even if the kill did not work, let go of the child so THIS hook can exit.
      try {
        child.kill('SIGKILL');
      } catch {}
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      finish({ ok: false, timedOut: true, out });
    }, timeoutMs);

    child.on('error', (err) => finish({ ok: false, timedOut: false, out: String(err) }));
    child.on('close', (code) => finish({ ok: code === 0 && !timedOut, timedOut, out }));
  });
}

// ---------- events ----------

function onEdit(input, dir) {
  const file = input.tool_input && input.tool_input.file_path;
  if (!file || !CODE_EXT.test(file) || !isInside(dir, file)) return;
  const abs = path.resolve(dir, file);
  const relFile = path.relative(dir, abs);
  // .claude/ (hooks, investigator's scratch repros) is tooling, not product code
  if (relFile.split(path.sep)[0] === '.claude' || /(^|[\\/])node_modules[\\/]/.test(relFile)) return;

  // The package this file belongs to: nearest folder with a package.json ('' = project root).
  const pkgDir = findUp(path.dirname(abs), dir, (d) => fs.existsSync(path.join(d, 'package.json'))) || dir;
  const root = path.relative(dir, pkgDir);

  const flag = flagFile(input, dir);
  const state = readFlag(flag) || {};
  const roots = Array.isArray(state.roots) ? state.roots : [];
  if (!roots.includes(root) && roots.length < MAX_ROOTS) roots.push(root);
  writeFlag(flag, { blocks: state.blocks || 0, edited: true, roots }); // keeps the attempt counter
}

const warnUser = (msg) => console.log(JSON.stringify({ systemMessage: msg }));

// Runs every check of every touched package; returns the first failure, or null if all pass.
async function firstFailure(state, dir) {
  const deadline = Date.now() + BUDGET_MS;
  const roots = Array.isArray(state.roots) && state.roots.length ? state.roots : [''];
  const checks = roots.flatMap((root) => buildChecks(path.resolve(dir, root), dir));
  for (const check of checks) {
    const result = await run(check, Math.max(deadline - Date.now(), 1000));
    if (!result.ok) return { check, result };
  }
  return null;
}

function tailOf(out) {
  const clean = out.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim(); // strip colour codes
  return clean.length > MAX_OUTPUT ? '...\n' + clean.slice(-MAX_OUTPUT) : clean;
}

// `git commit`, also with global options in between: git -c user.name=x commit ...
const GIT_COMMIT = /\bgit(?:\s+(?:-[cC]\s+\S+|--[\w-]+(?:=\S+)?))*\s+commit\b/;

// PreToolUse (Bash|PowerShell): commit gate. Unverified code must not be committed —
// Claude often writes code and commits in the same turn, before the Stop check runs.
// `git commit --no-verify` skips this gate, like it skips git's own hooks.
async function onCommit(input, dir) {
  const cmd = String((input.tool_input && input.tool_input.command) || '');
  if (!GIT_COMMIT.test(cmd) || /--no-verify\b/.test(cmd)) return 0;

  const flag = flagFile(input, dir);
  const state = readFlag(flag);
  if (!state) return 0; // nothing unverified

  const failure = await firstFailure(state, dir);
  if (!failure) {
    clearFlag(flag); // verified: the Stop check will not repeat it
    return 0;
  }
  if (failure.result.timedOut) {
    warnUser(`verify hook: \`${failure.check.label}\` took too long, so this commit was NOT verified.`);
    return 0;
  }
  process.stderr.write(
    `Commit blocked: \`${failure.check.label}\` does not pass.\n` +
      `You changed code that is not verified yet. Fix it, then commit again.\n` +
      `If it cannot be fixed without a decision from the user, do not commit — explain the problem to them.\n\n` +
      `${tailOf(failure.result.out)}\n`
  );
  return 2;
}

// Returns the process exit code: 0 = let Claude stop, 2 = block.
async function onStop(input, dir) {
  pruneOldFlags();
  const flag = flagFile(input, dir);
  const state = readFlag(flag);
  if (!state) return 0; // Claude changed no code since the last successful verification

  const roots = Array.isArray(state.roots) ? state.roots : [];
  const failure = await firstFailure(state, dir);

  if (failure) {
    const { check, result } = failure;

    if (result.timedOut) {
      clearFlag(flag);
      warnUser(
        `verify hook: \`${check.label}\` took too long and was stopped. ` +
          `Add a faster "claude:verify" script to package.json (e.g. jest --onlyChanged).`
      );
      return 0;
    }

    // Claude was already told and changed no code since: it is not going to
    // fix this by itself (e.g. it needs your decision) -> don't block again.
    if (state.blocks > 0 && !state.edited) {
      clearFlag(flag);
      warnUser(`verify hook: \`${check.label}\` is still failing and Claude stopped without changing code. Please check it yourself.`);
      return 0;
    }

    const blocks = (state.blocks || 0) + 1;
    if (blocks > MAX_BLOCKS) {
      clearFlag(flag);
      warnUser(`verify hook: \`${check.label}\` is STILL failing after ${MAX_BLOCKS} fix attempts. Claude was allowed to stop — please check it yourself.`);
      return 0;
    }

    writeFlag(flag, { blocks, edited: false, roots });
    process.stderr.write(
      `Verification failed: \`${check.label}\` (attempt ${blocks}/${MAX_BLOCKS})\n` +
        `You changed code but this check does not pass. Fix it before finishing.\n` +
        `If it cannot be fixed without a decision from the user, explain that to them instead.\n\n` +
        `${tailOf(result.out)}\n`
    );
    return 2;
  }

  clearFlag(flag); // everything passed (or nothing to run)
  return 0;
}

async function main() {
  const input = readStdin();
  const dir = path.resolve(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());

  if (input.hook_event_name === 'PostToolUse') {
    onEdit(input, dir);
    return 0;
  }
  if (input.hook_event_name === 'PreToolUse') return onCommit(input, dir);
  return onStop(input, dir);
}

main()
  .then((code) => {
    process.exitCode = code; // let stdout/stderr flush, then exit with this code
  })
  .catch(() => {
    process.exitCode = 0; // a bug in this hook must never trap Claude
  });
