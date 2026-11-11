#!/usr/bin/env node
// "Completion fence" (idea from agyis-harness). One script, two events:
//
//   PostToolUse (Edit|Write|MultiEdit): Claude edited a code file in this
//       project -> remember "code is dirty" for this session.
//   Stop: Claude wants to finish. If code is dirty, run typecheck + tests.
//       - pass  -> clear the flag, let Claude stop.
//       - fail  -> exit 2: Claude sees the error and must keep working.
//       Claude is let go (and you get a warning) when it stops again WITHOUT
//       changing code, or after MAX_BLOCKS failed fix attempts — so it can
//       never loop forever.
//
// Customize per project: add a "claude:verify" script to package.json and
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

// ---------- dirty flag (one small file per session, in the OS temp folder) ----------

function flagFile(input, dir) {
  const id = input.session_id || crypto.createHash('sha1').update(dir).digest('hex');
  return path.join(os.tmpdir(), 'claude-code-verify', String(id).replace(/[^\w.-]/g, '_') + '.json');
}
function readFlag(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
function writeFlag(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}
function clearFlag(file) {
  try {
    fs.unlinkSync(file);
  } catch {}
}

// ---------- what to run ----------

function detectPackageManager(dir) {
  if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(dir, 'bun.lockb')) || fs.existsSync(path.join(dir, 'bun.lock'))) return 'bun';
  return 'npm';
}

// Path of a locally installed CLI (never downloads anything), or null.
function resolveBin(dir, pkgName, binName) {
  try {
    const pkgDir = path.join(dir, 'node_modules', pkgName);
    const bin = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).bin;
    const rel = typeof bin === 'string' ? bin : bin && bin[binName];
    const full = rel && path.join(pkgDir, rel);
    return full && fs.existsSync(full) ? full : null;
  } catch {
    return null;
  }
}

function buildChecks(dir) {
  let scripts;
  try {
    scripts = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).scripts || {};
  } catch {
    return []; // no (valid) package.json -> nothing to verify
  }
  const pm = detectPackageManager(dir);

  // 1. Project-specific override wins.
  if (scripts['claude:verify']) return [{ label: `${pm} run claude:verify`, shell: `${pm} run claude:verify` }];

  // 2. Defaults: typecheck (if TypeScript is installed here) + the "test" script.
  const checks = [];
  const tsc = fs.existsSync(path.join(dir, 'tsconfig.json')) && resolveBin(dir, 'typescript', 'tsc');
  if (tsc) checks.push({ label: 'tsc --noEmit', file: process.execPath, args: [tsc, '--noEmit', '--pretty', 'false'] });

  if (scripts.test && !scripts.test.includes('no test specified')) {
    checks.push({ label: `${pm} run test`, shell: `${pm} run test` });
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
function run(check, dir, timeoutMs) {
  return new Promise((resolve) => {
    const env = { ...process.env, CI: 'true', NO_COLOR: '1' }; // CI=true: no watch mode
    delete env.FORCE_COLOR;
    const opts = {
      cwd: dir,
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
  // .claude/ (hooks, investigator's scratch repros) is tooling, not product code
  if (path.relative(dir, path.resolve(dir, file)).split(path.sep)[0] === '.claude') return;
  const flag = flagFile(input, dir);
  const state = readFlag(flag) || { blocks: 0 };
  writeFlag(flag, { blocks: state.blocks || 0, edited: true }); // keeps the attempt counter
}

// Returns the process exit code: 0 = let Claude stop, 2 = block.
async function onStop(input, dir) {
  const flag = flagFile(input, dir);
  const state = readFlag(flag);
  if (!state) return 0; // Claude changed no code since the last successful verification

  const warnUser = (msg) => console.log(JSON.stringify({ systemMessage: msg }));
  const deadline = Date.now() + BUDGET_MS;

  for (const check of buildChecks(dir)) {
    const result = await run(check, dir, Math.max(deadline - Date.now(), 1000));
    if (result.ok) continue;

    clearFlag(flag);

    if (result.timedOut) {
      warnUser(
        `verify hook: \`${check.label}\` took too long and was stopped. ` +
          `Add a faster "claude:verify" script to package.json (e.g. jest --onlyChanged).`
      );
      return 0;
    }

    // Claude was already told and changed no code since: it is not going to
    // fix this by itself (e.g. it needs your decision) -> don't block again.
    if (state.blocks > 0 && !state.edited) {
      warnUser(`verify hook: \`${check.label}\` is still failing and Claude stopped without changing code. Please check it yourself.`);
      return 0;
    }

    const blocks = (state.blocks || 0) + 1;
    if (blocks > MAX_BLOCKS) {
      warnUser(`verify hook: \`${check.label}\` is STILL failing after ${MAX_BLOCKS} fix attempts. Claude was allowed to stop — please check it yourself.`);
      return 0;
    }

    writeFlag(flag, { blocks, edited: false });
    const out = result.out.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim(); // strip colour codes
    const tail = out.length > MAX_OUTPUT ? '...\n' + out.slice(-MAX_OUTPUT) : out;
    process.stderr.write(
      `Verification failed: \`${check.label}\` (attempt ${blocks}/${MAX_BLOCKS})\n` +
        `You changed code but this check does not pass. Fix it before finishing.\n` +
        `If it cannot be fixed without a decision from the user, explain that to them instead.\n\n${tail}\n`
    );
    return 2;
  }

  clearFlag(flag); // everything passed (or nothing to run)
  return 0;
}

async function main() {
  const input = readStdin();
  const dir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();

  if (input.hook_event_name === 'PostToolUse') {
    onEdit(input, dir);
    return 0;
  }
  return onStop(input, dir);
}

main()
  .then((code) => {
    process.exitCode = code; // let stdout/stderr flush, then exit with this code
  })
  .catch(() => {
    process.exitCode = 0; // a bug in this hook must never trap Claude
  });
