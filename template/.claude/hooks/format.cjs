#!/usr/bin/env node
// PostToolUse hook (Edit|Write|MultiEdit) — run Prettier on the file Claude just edited.
// - Only files inside this project.
// - Only if Prettier is installed in the file's package or a parent folder (never downloads it).
// - Never blocks Claude: formatting is best-effort.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|json|css|scss|md|html|ya?ml)$/;

function isInside(dir, file) {
  const rel = path.relative(dir, path.resolve(dir, file));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// Nearest folder (from the file up to the project root) that has Prettier installed:
// returns { cwd, bin } or null. Covers monorepos and hoisted installs.
function findPrettier(fileDir, projectDir) {
  let cur = fileDir;
  for (;;) {
    try {
      const pkgDir = path.join(cur, 'node_modules', 'prettier');
      const bin = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).bin;
      const rel = typeof bin === 'string' ? bin : bin && bin.prettier;
      const full = rel && path.join(pkgDir, rel);
      if (full && fs.existsSync(full)) return { cwd: cur, bin: full };
    } catch {}
    if (cur === projectDir || !isInside(projectDir, cur)) return null;
    cur = path.dirname(cur);
  }
}

let input = {};
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
} catch {
  process.exit(0);
}

const file = input.tool_input && input.tool_input.file_path;
const dir = path.resolve(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());

if (!file || !EXT.test(file) || !isInside(dir, file)) process.exit(0);
const abs = path.resolve(dir, file);
if (/(^|[\\/])node_modules[\\/]/.test(path.relative(dir, abs))) process.exit(0);

const prettier = findPrettier(path.dirname(abs), dir);
if (!prettier) process.exit(0);

try {
  // execFileSync = no shell, so odd characters in a file name can't run anything.
  execFileSync(process.execPath, [prettier.bin, '--write', '--ignore-unknown', abs], {
    cwd: prettier.cwd,
    stdio: 'ignore',
    timeout: 20 * 1000,
    windowsHide: true,
  });
} catch {}
process.exit(0);
