#!/usr/bin/env node
// PostToolUse hook (Edit|Write|MultiEdit) — run Prettier on the file Claude just edited.
// - Only files inside this project.
// - Only if the project has Prettier installed (never downloads it).
// - Never blocks Claude: formatting is best-effort.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|json|css|scss|md|html|ya?ml)$/;

function isInside(dir, file) {
  const rel = path.relative(dir, path.resolve(dir, file));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// Path of the locally installed Prettier CLI, or null.
function prettierBin(dir) {
  try {
    const pkgDir = path.join(dir, 'node_modules', 'prettier');
    const bin = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).bin;
    const rel = typeof bin === 'string' ? bin : bin && bin.prettier;
    const full = rel && path.join(pkgDir, rel);
    return full && fs.existsSync(full) ? full : null;
  } catch {
    return null;
  }
}

let input = {};
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
} catch {
  process.exit(0);
}

const file = input.tool_input && input.tool_input.file_path;
const dir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();

if (!file || !EXT.test(file) || !isInside(dir, file)) process.exit(0);
if (/[\\/]node_modules[\\/]/.test(file)) process.exit(0);

const bin = prettierBin(dir);
if (!bin) process.exit(0);

try {
  // execFileSync = no shell, so odd characters in a file name can't run anything.
  execFileSync(process.execPath, [bin, '--write', '--ignore-unknown', path.resolve(dir, file)], {
    cwd: dir,
    stdio: 'ignore',
    timeout: 20 * 1000,
    windowsHide: true,
  });
} catch {}
process.exit(0);
