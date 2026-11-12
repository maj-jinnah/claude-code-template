#!/usr/bin/env node
// Copies the Claude Code template into a project.
//
//   node install.cjs <project-folder>            safe: never overwrites your files
//   node install.cjs <project-folder> --force    update this template's hooks, agents + settings entries
//
// - .claude/hooks/*.cjs, .claude/agents/*.md, .claude/scratch/.gitignore
//                         -> copied. If a file already exists and differs it is left alone,
//                            or with --force replaced and the old one kept as <name>.bak
//                            (a later --force keeps that and adds <name>.<date-time>.bak)
// - .claude/settings.json -> created, or MERGED into the existing one (every change backed up)
// - CLAUDE.md            -> created only if the project doesn't have one

const fs = require('fs');
const path = require('path');

const TEMPLATE = path.join(__dirname, 'template');
const args = process.argv.slice(2);
const force = args.includes('--force');
const targetArg = args.find((a) => !a.startsWith('--'));

if (!targetArg) {
  console.error('Usage: node install.cjs <project-folder> [--force]');
  process.exit(1);
}
const target = path.resolve(targetArg);
if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
  console.error(`Not a folder: ${target}`);
  process.exit(1);
}

const log = (tag, msg) => console.log(`  ${tag.padEnd(8)} ${msg}`);

// A backup name that never overwrites an older backup: x.bak, then x.<date-time>.bak
function backupPath(file) {
  if (!fs.existsSync(file + '.bak')) return file + '.bak';
  return `${file}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
}

// Read the existing settings.json FIRST, so a broken file stops the install before anything is copied.
const settingsDst = path.join(target, '.claude', 'settings.json');
let current = null;
if (fs.existsSync(settingsDst)) {
  try {
    current = JSON.parse(fs.readFileSync(settingsDst, 'utf8').replace(/^﻿/, '')); // tolerate a BOM
  } catch {
    console.error('\n  ERROR: existing .claude/settings.json is not valid JSON. Fix it and re-run. Nothing was changed.');
    process.exit(1);
  }
  const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const bad = [];
  if (!isObject(current)) bad.push('the file must contain a JSON object');
  else {
    if (current.hooks !== undefined && !isObject(current.hooks)) bad.push('"hooks" must be an object');
    for (const [event, list] of Object.entries(isObject(current.hooks) ? current.hooks : {})) {
      if (!Array.isArray(list)) bad.push(`"hooks.${event}" must be an array`);
    }
    if (current.permissions !== undefined && !isObject(current.permissions)) bad.push('"permissions" must be an object');
  }
  if (bad.length) {
    console.error(`\n  ERROR: .claude/settings.json: ${bad.join('; ')}. Fix it and re-run. Nothing was changed.`);
    process.exit(1);
  }
}

console.log(`\nInstalling Claude Code template into ${target}\n`);

// 1. Hook scripts, subagents, scratch folder
for (const sub of ['hooks', 'agents', 'scratch']) {
  const src = path.join(TEMPLATE, '.claude', sub);
  const dstDir = path.join(target, '.claude', sub);
  fs.mkdirSync(dstDir, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const dst = path.join(dstDir, name);
    const rel = path.relative(target, dst).split(path.sep).join('/');
    const srcFile = path.join(src, name);
    if (!fs.existsSync(dst)) {
      fs.copyFileSync(srcFile, dst);
      log('create', rel);
      continue;
    }
    // compare ignoring line endings (git on Windows may have turned LF into CRLF)
    const norm = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
    if (norm(dst) === norm(srcFile)) {
      log('skip', `${rel} (up to date)`);
    } else if (!force) {
      log('skip', `${rel} (differs from template, use --force to update)`);
    } else {
      // the project's version differs (older template, or your own edits): keep it
      const bak = backupPath(dst);
      fs.copyFileSync(dst, bak);
      fs.copyFileSync(srcFile, dst);
      log('update', `${rel} (previous version saved as ${path.basename(bak)})`);
    }
  }
}

// 2. settings.json (merge)
const settingsSrc = JSON.parse(fs.readFileSync(path.join(TEMPLATE, '.claude', 'settings.json'), 'utf8'));

if (!current) {
  fs.writeFileSync(settingsDst, JSON.stringify(settingsSrc, null, 2) + '\n');
  log('create', '.claude/settings.json');
} else {
  const before = JSON.stringify(current);

  // permissions.deny: union
  current.permissions = current.permissions || {};
  const oldDeny = current.permissions.deny;
  const deny = new Set(Array.isArray(oldDeny) ? oldDeny : typeof oldDeny === 'string' ? [oldDeny] : []);
  if (force) {
    // rules from the first version of this template: they also blocked .env.example
    deny.delete('Read(./.env.*)');
    deny.delete('Read(./**/.env.*)');
  }
  for (const rule of settingsSrc.permissions.deny) deny.add(rule);
  current.permissions.deny = [...deny];

  current.hooks = current.hooks || {};

  // --force: first remove this template's old entries (your own hooks are kept)
  if (force) {
    const OURS = /\.claude\/hooks\/(guard|format|verify)\.cjs/;
    for (const event of Object.keys(current.hooks)) {
      current.hooks[event] = (current.hooks[event] || [])
        .map((e) => (Array.isArray(e.hooks) ? { ...e, hooks: e.hooks.filter((h) => !OURS.test(h.command || '')) } : e))
        .filter((e) => !Array.isArray(e.hooks) || e.hooks.length > 0);
      if (current.hooks[event].length === 0) delete current.hooks[event];
    }
  }

  // hooks: add our entries unless the same command is already registered
  for (const [event, entries] of Object.entries(settingsSrc.hooks)) {
    current.hooks[event] = current.hooks[event] || [];
    for (const entry of entries) {
      // "already registered" = same command under the same matcher
      const existingCmds = new Set(
        current.hooks[event]
          .filter((e) => (e.matcher || '') === (entry.matcher || ''))
          .flatMap((e) => (e.hooks || []).map((h) => h.command))
      );
      const fresh = entry.hooks.filter((h) => !existingCmds.has(h.command));
      if (fresh.length) current.hooks[event].push({ ...entry, hooks: fresh });
    }
  }

  if (JSON.stringify(current) === before) {
    log('skip', '.claude/settings.json (already up to date)');
  } else {
    // every change gets its own backup; older backups are never overwritten
    const bak = backupPath(settingsDst);
    fs.copyFileSync(settingsDst, bak);
    fs.writeFileSync(settingsDst, JSON.stringify(current, null, 2) + '\n');
    log('merge', `.claude/settings.json (previous version saved as ${path.basename(bak)})`);
  }
}

// 3. CLAUDE.md
const claudeMdDst = path.join(target, 'CLAUDE.md');
if (fs.existsSync(claudeMdDst)) {
  log('skip', 'CLAUDE.md (exists — compare with template/CLAUDE.md yourself)');
} else {
  fs.copyFileSync(path.join(TEMPLATE, 'CLAUDE.md'), claudeMdDst);
  log('create', 'CLAUDE.md  <- fill in the <...> placeholders!');
}

console.log('\nDone. Start a NEW Claude Code session in that project to load the hooks and agents.\n');
