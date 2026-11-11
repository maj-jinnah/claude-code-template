#!/usr/bin/env node
// Copies the Claude Code template into a project.
//
//   node install.cjs <project-folder>            safe: never overwrites your files
//   node install.cjs <project-folder> --force    update this template's hooks, agents + settings entries
//
// - .claude/hooks/*.cjs, .claude/agents/*.md, .claude/scratch/.gitignore
//                         -> copied. If a file already exists and differs it is left alone,
//                            or with --force replaced and the old one kept as <name>.bak
// - .claude/settings.json -> created, or MERGED into the existing one (backup kept)
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
      fs.copyFileSync(dst, dst + '.bak');
      fs.copyFileSync(srcFile, dst);
      log('update', `${rel} (previous version saved as ${name}.bak)`);
    }
  }
}

// 2. settings.json (merge)
const settingsSrc = JSON.parse(fs.readFileSync(path.join(TEMPLATE, '.claude', 'settings.json'), 'utf8'));
const settingsDst = path.join(target, '.claude', 'settings.json');

if (!fs.existsSync(settingsDst)) {
  fs.writeFileSync(settingsDst, JSON.stringify(settingsSrc, null, 2) + '\n');
  log('create', '.claude/settings.json');
} else {
  let current;
  try {
    current = JSON.parse(fs.readFileSync(settingsDst, 'utf8'));
  } catch {
    console.error('\n  ERROR: existing .claude/settings.json is not valid JSON. Fix it and re-run.');
    process.exit(1);
  }
  const before = JSON.stringify(current);

  // permissions.deny: union
  current.permissions = current.permissions || {};
  const deny = new Set(current.permissions.deny || []);
  if (force) {
    // rules from the first version of this template: they also blocked .env.example
    deny.delete('Read(./.env.*)');
    deny.delete('Read(./**/.env.*)');
  }
  for (const rule of settingsSrc.permissions.deny) deny.add(rule); // add our rules
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
    // keep the FIRST backup: it is your original file from before this template
    const bak = settingsDst + '.bak';
    if (!fs.existsSync(bak)) fs.copyFileSync(settingsDst, bak);
    fs.writeFileSync(settingsDst, JSON.stringify(current, null, 2) + '\n');
    log('merge', '.claude/settings.json (original kept as settings.json.bak)');
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
