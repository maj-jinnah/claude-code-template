# Claude Code Template (Node.js / TypeScript)

[English](README.md) | **বাংলা**

যেকোনো Node.js / TypeScript প্রজেক্টে (NestJS, Express, Next.js, React) Claude Code-কে নিরাপদ আর নির্ভরযোগ্য করার টেমপ্লেট। একটা কমান্ডে যেকোনো প্রজেক্টে বসানো যায়।

এতে তিন ধরনের জিনিস আছে:

- **Hook:** ছোট Node script, যেগুলো Claude-এর কাজের আগে-পরে নিজে থেকে চলে। এগুলো নিয়ম মানতে বাধ্য করে, শুধু অনুরোধ করে না।
- **Subagent:** ৮টা বিশেষজ্ঞ agent, যেমন planner, reviewer, investigator।
- **`CLAUDE.md`:** প্রজেক্টের কমান্ড আর নিয়মের টেমপ্লেট।

বাড়তি কোনো dependency লাগে না, শুধু Node।

## কী কী আছে

| ফাইল | কখন চলে | কী করে |
|---|---|---|
| `.claude/hooks/guard.cjs` | Claude কোনো কমান্ড চালানোর **আগে** (Bash আর PowerShell) | বিপজ্জনক কমান্ড আটকায় |
| `.claude/hooks/format.cjs` | Claude কোনো ফাইল এডিট করার **পরে** | সেই ফাইলে Prettier চালায় |
| `.claude/hooks/verify.cjs` | এডিটের পরে, `git commit`-এর আগে, আর কাজ শেষ করার আগে | Claude কোড বদলালে typecheck আর টেস্ট চালায়। fail করলে commit আটকায়, আর Claude-কে ঠিক করতে ফেরত পাঠায় |
| `.claude/settings.json` | — | উপরের hook-গুলো চালু করে, আর আসল `.env` ফাইল পড়া বন্ধ রাখে |
| `.claude/agents/*.md` | আপনি বা Claude ডাকলে | ৮টা বিশেষজ্ঞ subagent |
| `.claude/scratch/` | — | investigator-এর reproduction script রাখার জায়গা, git-এ যায় না |
| `CLAUDE.md` | প্রতিটা session-এর শুরুতে | প্রজেক্টের কমান্ড আর নিয়ম। **`<...>` জায়গাগুলো নিজে পূরণ করতে হবে** |

## যা লাগবে

- Node.js 18 বা নতুন (Node 24-এ টেস্ট করা)
- Claude Code 2.1 বা নতুন (2.1.300-এ টেস্ট করা)
- Git
- Windows-এ **Git for Windows** (Git Bash)। hook-এর কমান্ড Git Bash দিয়ে চলে। Git Bash না থাকলে Claude Code কমান্ডগুলো PowerShell-এ চালায়, আর সেখানে এই টেমপ্লেটের কমান্ড কাজ করার কথা না (এটা টেস্ট করা হয়নি)।

## কোনো প্রজেক্টে বসানো

```bash
node "d:/learning project/claude-code-template/install.cjs" "d:/learning project/nest-learning"
```

প্রজেক্টের ফোল্ডারের ভেতর থেকে চালালে শেষে শুধু `.` দিলেই হয়।

- আপনার কোনো ফাইল মুছে ফেলে না বা overwrite করে না।
- আগে থেকে `.claude/settings.json` থাকলে **merge** করে। আপনার নিজের hook আর permission থেকে যায়, আর আসল ফাইলটা `settings.json.bak` নামে রাখা হয়।
- আগে থেকে `CLAUDE.md` থাকলে সেটা ছোঁয় না।
- দ্বিতীয়বার চালালে কিছুই বদলায় না।

তারপর:

1. প্রজেক্টের `CLAUDE.md` খুলে `<...>` জায়গাগুলো পূরণ করুন। **এটা বাদ দেবেন না।** সহজ উপায় হলো Claude-কেই বলা: "CLAUDE.md-এর `<...>` জায়গাগুলো package.json আর কোড দেখে পূরণ করো"। পূরণ না হওয়া পর্যন্ত ফাইলের উপরের নোটটা Claude-কে `package.json` দেখে চলতে বলে।
2. সেই প্রজেক্টে **নতুন** Claude Code session খুলুন। hook আর agent শুধু session শুরুর সময় লোড হয়।
3. লোড হয়েছে কিনা দেখুন। টার্মিনালের `claude`-এ `/agents` লিখলে agent-দের তালিকা আসে। VS Code extension-এ hook দেখা যায় Customize অংশের **Hooks**-এ। সহজ পরীক্ষা: Claude-কে `git reset --hard` চালাতে বলুন। guard আটকালে বুঝবেন hook চলছে।
4. টিমের সাথে শেয়ার করতে চাইলে `.claude/` আর `CLAUDE.md` git-এ commit করুন। `*.bak` ফাইল commit করার দরকার নেই।

### টেমপ্লেট আপডেট করলে

এই ফোল্ডারের ফাইল বদলানোর পর কোনো প্রজেক্টে নতুন ভার্সন নিতে শেষে `--force` দিন:

```bash
node "d:/learning project/claude-code-template/install.cjs" "<project>" --force
```

এতে টেমপ্লেটের hook আর agent ফাইল, আর settings-এ এই টেমপ্লেটের এন্ট্রিগুলো বদলায়। প্রজেক্টের কোনো ফাইল টেমপ্লেট থেকে আলাদা হলে (যেমন আপনি নিজে বদলেছেন) আগেরটা `<নাম>.bak` হিসেবে থেকে যায়। আপনার নিজের hook আর `CLAUDE.md` যেমন আছে তেমনই থাকে।

## Hook-গুলো কীভাবে কাজ করে

### guard.cjs: বিপজ্জনক কমান্ড আটকায়

যা আটকায়:

- **ORM:** `prisma migrate reset`, `prisma db push --force-reset` / `--accept-data-loss`, `typeorm schema:drop`, `sequelize db:drop`
- **SQL / Mongo / Redis:** `DROP DATABASE/TABLE/SCHEMA`, `TRUNCATE`, WHERE ছাড়া `DELETE FROM`, `dropDatabase()`, `collection.drop()`, `deleteMany({})`, `FLUSHALL` / `FLUSHDB`
- **Docker:** `docker compose down -v`, `docker volume rm` / `prune`
- **Git:** `git push --force` / `-f` / `+branch`, `git reset --hard`, `git clean -f`, `git checkout .`, `git restore .`
- **ফাইল:** `rm -rf` দিয়ে `/`, `~`, `$HOME`, `.`, `..`, `*` মোছা, আর PowerShell-এর `Remove-Item -Recurse` দিয়ে একই কাজ
- **নাম ধরে process বন্ধ করা:** `taskkill /IM node.exe`, `killall node`, `pkill node`, `Stop-Process -Name node`, `kill $(pgrep node)` ইত্যাদি। এগুলো মেশিনের **সব** মিলে যাওয়া process বন্ধ করে, অন্য প্রজেক্টের dev server-সহ। আটকানোর বার্তায় Claude-কে বলা হয় কীভাবে শুধু port-এর process বন্ধ করতে হয়।
- **Secret:** আসল `.env` ফাইল ছাপানো বা পড়া: `cat .env`, `grep KEY .env`, `sed -n p .env` ইত্যাদি। `.env.example` পড়া যায়।
- **Publish:** `npm` / `pnpm` / `yarn` / `bun publish`

যা আটকায় না:

- নিরাপদ কমান্ড: `prisma migrate dev`, `git push --force-with-lease`, `rm -rf dist`, `docker compose down`, WHERE সহ `DELETE`।
- একটা নির্দিষ্ট process বন্ধ করা: `taskkill /PID 1234 /F`, `kill 1234`, `Stop-Process -Id 1234`, `npx kill-port 3000`, `lsof -ti :3000 | xargs kill`, আর `pkill -f "node dist/main.js"` (নির্দিষ্ট কমান্ড)।
- commit message, tag আর PR/issue-র লেখা। message-এ `.env` বা `git reset --hard` শব্দ থাকলে commit আটকায় না।
- যে কমান্ড বিপজ্জনক কমান্ডের শুধু নাম উল্লেখ করে: `grep -rn "git reset --hard" docs`, `echo "never run killall node"`, `which pkill`, `man killall`। খোঁজা আর ছাপার কমান্ডের quote-এর ভেতরের লেখা উপেক্ষা করা হয়। তবে `echo`/`printf`-এর output অন্য program-এ pipe করলে উপেক্ষা হয় না, তাই `echo "DROP TABLE x" | psql` আটকায়। process-এর নিয়ম শুধু তখনই খাটে যখন program-টা কমান্ড হিসেবে চলছে।
- `grep -rn "process.env" src` বা `grep "DROP TABLE" migrations`-এর মতো খোঁজাখুঁজি। SQL-এর শব্দ শুধু তখনই ধরা হয় যখন কমান্ডটা সত্যিই ডাটাবেস client বা `node` চালায়।

আটকে যাওয়া কোনো কমান্ড আসলেই দরকার হলে সেটা নিজের টার্মিনালে চালান। অথবা প্রজেক্টের `.claude/hooks/guard.cjs` থেকে সেই লাইনটা মুছে দিন।

### verify.cjs: completion fence আর commit gate

1. Claude প্রজেক্টের ভেতরে কোনো `.ts/.tsx/.js/.jsx` ফাইল এডিট করলে hook মনে রাখে "কোড বদলেছে", আর ফাইলটা কোন package-এর (সবচেয়ে কাছের `package.json`)।
2. **Commit gate:** কোড বদলানো থাকা অবস্থায় Claude `git commit` করতে গেলে আগে চেক চলে। fail করলে commit আটকে যায়। ইচ্ছে করে চেক বাদ দিতে চাইলে `git commit --no-verify` ব্যবহার করুন, git-এর নিজের hook-এর মতোই।
3. **Completion fence:** Claude কাজ শেষ করতে গেলে একই চেক চলে। পাস করলে Claude থামে। fail করলে error-এর শেষ অংশ Claude-কে দেখানো হয়, আর তাকে কাজে ফেরত পাঠানো হয়।
4. Claude যদি কোড না বদলে আবার থামে (যেমন আপনার সিদ্ধান্ত দরকার), বা ৩ বার চেষ্টার পরও fail করে, তখন hook তাকে ছেড়ে দেয় আর **আপনাকে একটা warning দেখায়** ("Stop says: verify hook: ...")। তাই কখনো অনন্ত লুপ হয় না।

**কী চেক চলে:**

- package-এ `tsconfig.json` থাকলে আর TypeScript ইনস্টল থাকলে `tsc --noEmit`
- `package.json`-এ `test` script থাকলে সেটা (npm, pnpm, yarn বা bun, lock ফাইল দেখে ঠিক হয়)
- `package.json`-এ `claude:verify` script থাকলে উপরের দুটোর বদলে **শুধু সেটা**

**এটা কী নিশ্চিত করে আর কী করে না:** fence নিশ্চিত করে যে Claude error-টা দেখবে, ভাঙা কোড commit হবে না, আর আপনি warning পাবেন। কোড ঠিক হয়ে যাবেই, এই গ্যারান্টি দেয় না। warning দেখলে নিজে চেক করবেন।

আরও কিছু আচরণ:

- Claude কোড না বদলালে (শুধু প্রশ্নের উত্তর, ডক পড়া) কিছুই চলে না, এমনকি আপনার git-এ আগে থেকে uncommitted কাজ থাকলেও।
- git ছাড়া প্রজেক্টেও কাজ করে।
- subagent (যেমন builder) কোড বদলালেও ধরা পড়ে।
- **Monorepo:** `package.json` সাবফোল্ডারে থাকলে (যেমন `services/api/package.json`) চেক সেই ফোল্ডারেই চলে। একাধিক package বদলালে প্রতিটায় চলে (সর্বোচ্চ ৮টা)। TypeScript root-এ ইনস্টল থাকলেও খুঁজে পায়।
- পুরো চেক ২৭০ সেকেন্ডের বেশি লাগলে hook সেটা বন্ধ করে দেয় (টেস্টের সব process সহ) আর আপনাকে warning দেয়।
- ডিফল্টে শুধু `test` script চলে, `test:e2e` না। তাই ডাটাবেস চালু না থাকলেও সমস্যা হয় না।

### format.cjs: Prettier

শুধু প্রজেক্টের ভেতরের ফাইলে চলে, আর শুধু যদি Prettier ইনস্টল থাকে (ফাইলের package-এ বা উপরের কোনো ফোল্ডারে)। কিছু ডাউনলোড করে না, আর কখনো Claude-কে আটকায় না।

NestJS নিজেই Prettier সেটআপ করে দেয়। Next.js বা Vite প্রজেক্টে নিজে ইনস্টল করতে হবে: `npm i -D prettier`।

## ৮টা Subagent

প্রতিটা agent-এর tool-এর তালিকাই ঠিক করে দেয় সে কী পারে। যার তালিকায় Edit আর Write নেই, সে সত্যিই ফাইল এডিট করতে পারে না।

| Agent | কাজ | ফাইল এডিট? | কমান্ড চালাতে পারে? |
|---|---|---|---|
| `planner` | কোড পড়ে ফাইল-ধরে-ধরে plan বানায় | ❌ | ❌ |
| `builder` | plan-এর একটা ধাপ কোড আর টেস্টসহ বানায় | ✅ | ✅ |
| `reviewer` | শুধু diff দেখে bug, নিরাপত্তা আর টেস্টের ঘাটতি ধরে | ❌ | ✅ (নিয়ম: শুধু git পড়া) |
| `auditor` | typecheck, lint, test, build চালিয়ে প্রমাণসহ রিপোর্ট দেয় | ❌ | ✅ |
| `custodian` | duplicate কোড আর আর্কিটেকচার চেক করে, শুধু দরকারি ফাইল commit করে | ❌ | ✅ (git) |
| `investigator` | bug-এর root cause খোঁজে, repro বানিয়ে প্রমাণ দেয় | নিয়ম: শুধু `.claude/scratch/`-এ | ✅ |
| `architect` | বড় কাজ: ডিজাইন করে, নিজে লেখে, বাকিদের কাজ ভাগ করে দেয় | ✅ | ✅ |
| `coordinator` | নিজে কোড লেখে না, পুরো টিম চালায় | ❌ | ❌ |

"নিয়ম" লেখা জায়গাগুলো agent-এর instruction-এ লেখা, কোড দিয়ে চাপানো না। তবে guard hook subagent-এর কমান্ডেও চলে, তাই বিপজ্জনক কমান্ড তখনও আটকায়।

### ব্যবহার

**সাধারণ session থেকে** যেকোনো agent-কে নাম ধরে ডাকুন:

```text
reviewer subagent দিয়ে আমার uncommitted changes review করো
investigator দিয়ে বের করো login কেন fail করছে
planner দিয়ে payment module-এর plan বানাও
custodian দিয়ে এই কাজটা commit করো
```

বিবরণ দেখে Claude নিজেও দরকারমতো এদের ডাকে।

**বড় কাজে coordinator বা architect-কে মূল session হিসেবে চালান:**

```bash
claude --agent coordinator    # নিজে কোড লেখে না, planner → builder → reviewer → custodian → auditor চালায়
claude --agent architect      # নিজেও কোড লেখে, দরকারে বাকিদের কাজ দেয়
```

এই দুটোকে সাধারণ subagent হিসেবে ডাকবেন না। Claude Code-এ subagent আরেকটা subagent চালু করতে পারে, কিন্তু সেগুলো পেছনে চলে, আর টেস্টে দেখা গেছে coordinator তাদের ফলাফল আসার আগেই নিজের রিপোর্ট দিয়ে শেষ হয়ে যায়। মূল session হিসেবে চালালে পুরো ladder শেষ হয়।

`--agent` দিয়ে চালালে ওই agent-এর instruction Claude Code-এর সাধারণ system prompt-এর জায়গা নেয়, আর session শুধু ওই agent-এর tool পায়।

**VS Code extension-এ** `--agent` flag দেওয়ার জায়গা নেই। সবচেয়ে নিশ্চিত উপায় VS Code-এর টার্মিনালে `claude --agent coordinator` চালানো। বিকল্প হলো প্রজেক্টের `.claude/settings.local.json`-এ `{"agent": "coordinator"}` লেখা। এটা টার্মিনালের `claude`-এ কাজ করে, তবে extension-এ কাজ করে কিনা যাচাই করা হয়নি। আর এটা থাকলে ওই প্রজেক্টের **প্রতিটা** session coordinator হয়ে যাবে, তাই কাজ শেষে মুছে ফেলবেন।

**খরচ:** প্রতিটা subagent আলাদা model call। ছোট কাজে (একটা ফাংশন ঠিক করা) সরাসরি Claude-কে বলাই সস্তা আর দ্রুত। ladder ব্যবহার করবেন বড় feature বা ঝুঁকিপূর্ণ পরিবর্তনে। কোনো agent-কে সস্তা model-এ চালাতে চাইলে তার ফাইলে `model: inherit` বদলে `model: sonnet` বা `model: haiku` দিন।

## প্রজেক্ট অনুযায়ী বদলানো

**verify-তে কী চলবে সেটা ঠিক করতে** `package.json`-এ একটা `claude:verify` script যোগ করুন:

```json
"scripts": {
  "claude:verify": "tsc --noEmit && eslint src && jest --onlyChanged"
}
```

| প্রজেক্ট | কখন দরকার | `claude:verify` |
|---|---|---|
| NestJS | টেস্ট স্যুট ধীর হলে | `tsc --noEmit && jest --onlyChanged` |
| Next.js | লিন্টও চালাতে চাইলে | `tsc --noEmit && next lint` |
| React (Vite) | সবসময় দিন। Vite-এর `tsconfig.json`-এ শুধু references থাকে, তাই ডিফল্ট `tsc --noEmit` কিছু চেক করে না | `tsc -b && vitest run` |
| Express (JS) | দরকার নেই | ডিফল্টে শুধু `test` script চলে |

**Claude-কে `.env` পড়তে দিতে চাইলে** `settings.json`-এর `permissions.deny` থেকে লাইনগুলো সরান, আর `guard.cjs`-এর "Secrets" অংশের দুটো লাইন মুছুন।

## সচল রাখা

Node বা Claude Code আপডেট করার পরে, বা টেমপ্লেটের কোনো ফাইল বদলালে, টেমপ্লেট ফোল্ডার থেকে self-test চালান:

```bash
node test/selftest.cjs
```

এটা একটা temp ফোল্ডারে hook, installer আর agent ফাইলের ২৭১টা চেক চালায়। কোনো network বা model call লাগে না। শেষে `OK` দেখায়, অথবা কোনগুলো fail করেছে তার তালিকা।

self-test hook script-গুলো সরাসরি চালায়, তাই Claude Code নিজে বদলালে সেটা ধরতে পারে না। সেটা যাচাই করতে টেমপ্লেট বসানো কোনো প্রজেক্টে নতুন session খুলে Claude-কে `git reset --hard` চালাতে বলুন। guard আটকালে বুঝবেন hook ঠিকমতো যুক্ত আছে।

maintain না করলে কী বন্ধ হয়ে যেতে পারে, আর তখন কী হবে:

| Claude Code-এ এটা বদলালে | ফল | কীভাবে বুঝবেন |
|---|---|---|
| hook-এর input format বা exit code 2-এর নিয়ম | hook আর আটকায় না, Claude এমনভাবে চলে যেন টেমপ্লেট নেই | উপরের `git reset --hard` পরীক্ষা আর আটকায় না |
| tool-এর নাম (`Bash`, `PowerShell`, `Edit`, `Write`, `MultiEdit`) | সংশ্লিষ্ট hook চলা বন্ধ হয় | একই পরীক্ষা, বা এডিটের পর Prettier format হয় না |
| subagent ফাইলের format বা `tools:`-এর tool-এর নাম | কোনো agent `/agents`-এ দেখা যায় না, বা কোনো tool হারায় | `/agents` তালিকা, বা agent বলে কোনো কাজ করতে পারছে না |

প্রতিটা hook এমনভাবে লেখা যে সমস্যা হলে কাজ আটকায় না: input পড়তে না পারলে বা crash করলে Claude-কে চলতে দেয়। তাই Claude Code-এ বড় কোনো পরিবর্তন এলে সুরক্ষা চুপচাপ চলে যেতে পারে, কিন্তু আপনার কাজ কখনো আটকে যাবে না।

## সীমাবদ্ধতা

- **guard একটা নিরাপত্তা জাল, পুরোপুরি নিশ্চিত সুরক্ষা না।** কমান্ড কোনো script ফাইলের ভেতরে লুকানো থাকলে (যেমন `npm run reset-db` বা `node scripts/wipe.js`) এটা ধরতে পারে না। `grep -r KEY .` দিয়ে পুরো ফোল্ডার খুঁজলে `.env`-এর লাইনও বেরিয়ে আসতে পারে। আসল সুরক্ষা হলো production-এর credential লোকাল `.env`-এ না রাখা।
- **verify শুধু Claude-এর Edit আর Write টুলের এডিট ধরে।** Claude shell কমান্ড দিয়ে (যেমন `sed -i`) কোড বদলালে সেটা ধরা পড়ে না, তখন কোনো চেক চলে না।
- **fence ঠিক করার গ্যারান্টি দেয় না।** উপরে ব্যাখ্যা আছে।
- **`.env`-এর deny rule নির্দিষ্ট নাম ধরে লেখা:** `.env`, `.env.local`, `.env.development`, `.env.production`, `.env.staging`, `.env.test`, `.env.*.local`। অন্য নামের secret ফাইল থাকলে `settings.json`-এ যোগ করুন।
- **agent-রা ভুল করতে পারে।** টেস্টে (haiku মডেলে) coordinator একবার একই কাজ দুবার builder-কে দিয়েছে, আরেকবার builder শেষ হওয়ার আগেই reviewer চালু করেছে। দুবারই শেষ ফলাফল ঠিক ছিল, কারণ fence আর review ভুলটা ধরেছে।
- **coordinator-এর todo tool:** এর tool তালিকায় todo আর প্রশ্ন করার tool-এর নাম আছে, কিন্তু interactive session-এ কোনটা সত্যিই পাওয়া যায় তা যাচাই করা যায়নি। না পেলে coordinator উত্তরের ভেতরেই checklist রাখে।

## যাচাই

Windows 11-এ Claude Code 2.1.300, Node 24, TypeScript 7 আর Prettier 3 দিয়ে টেস্ট করা হয়েছে।

**Script দিয়ে টেস্ট** (`node test/selftest.cjs`, ২৭১টা চেক, সব পাস):

- guard: ২৩৫টা কমান্ড (১১৯টা আটকানোর, ১১৬টা চলতে দেওয়ার)
- verify: এক package আর monorepo, commit gate, ৩ বার চেষ্টার সীমা, timeout আর ভুল input
- installer: নতুন ইনস্টল, পুনরায় চালানো, আপনার নিজের settings-এর সাথে merge, আর `.bak` backup সহ `--force`
- agent ফাইল: frontmatter ঠিক আছে কিনা

ডেভেলপমেন্টের সময় আলাদাভাবে টেস্ট করা: আসল Prettier দিয়ে format (নেস্টেড ফোল্ডার, স্পেসওয়ালা ফাইলের নাম, প্রজেক্টের বাইরের ফাইল আর `node_modules`), আর বড় টেস্ট output-এ verify।

**আসল Claude Code session-এ টেস্ট** (haiku মডেলে, headless `claude -p` মোডে):

- guard কমান্ড আটকেছে, মূল session আর subagent দুটোতেই। `killall node`-ও আটকেছে, কিন্তু একই শব্দ `grep` দিয়ে খোঁজা ঠিকমতো চলেছে।
- verify টাইপ error ধরে Claude-কে দিয়ে ঠিক করিয়েছে। monorepo-তে ঠিক package-এ চলেছে।
- commit gate ভাঙা কোডের commit আটকেছে। Claude থেমে সিদ্ধান্ত চেয়েছে।
- message-এ `.env` শব্দ থাকা commit আটকায়নি।
- `.env` পড়া আটকেছে, `.env.example` পড়া গেছে।
- reviewer ইচ্ছে করে ঢোকানো ৩টা bug-ই ধরেছে, আর ওর কাছে শুধু `Read, Grep, Glob, Bash` ছিল।
- coordinator (`--agent`) দুটো আলাদা কাজে নিজে কোড না লিখে builder → reviewer → auditor চালিয়েছে।
- custodian শুধু দরকারি ফাইল commit করেছে। investigator আসল কারণ বের করেছে, product কোডে হাত না দিয়ে। planner ঠিক format-এ plan দিয়েছে।

**যা টেস্ট করা হয়নি:**

- আসল session-এ Claude PID দিয়ে একটা process বন্ধ করছে (নাম ধরে আটকানোটা live টেস্ট করা হয়েছে)
- VS Code extension-এর ভেতরে (সব টেস্ট টার্মিনালের `claude` দিয়ে)
- macOS আর Linux
- আসল NestJS প্রজেক্টে jest-এর বড় টেস্ট স্যুট
- haiku ছাড়া অন্য model
- architect-কে মূল session হিসেবে (`--agent architect`)

## কৃতজ্ঞতা

আইডিয়াগুলো (command safety, completion fence, output ছোট রাখা, ৮টা agent-এর ভূমিকা, নাম ধরে process বন্ধ না করা, আর বারবার fail আর পুরনো cache নিয়ে `CLAUDE.md`-এর নিয়ম) এসেছে [agyis-harness](https://github.com/kuasha420/agyis-harness) থেকে। সেটা Google Antigravity-র জন্য বানানো, Apache-2.0 লাইসেন্সে, লেখক Arafat Zahan / Purrfect Software Limited। এই টেমপ্লেটের কোড আর agent-এর instruction Claude Code-এর জন্য নতুন করে লেখা।
