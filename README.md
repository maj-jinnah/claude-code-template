# Claude Code Template (Node / TypeScript)

যেকোনো Node.js / TypeScript প্রজেক্টে (NestJS, Express, Next.js, React) Claude Code-কে নিরাপদ আর নির্ভরযোগ্য করার টেমপ্লেট।
আইডিয়াগুলো নেওয়া হয়েছে `agyis-harness` থেকে, তবে Claude Code-এর জন্য Node দিয়ে নতুন করে লেখা। বাড়তি কোনো dependency লাগে না, শুধু Node।

## কী কী আছে

| ফাইল | কখন চলে | কী করে |
|---|---|---|
| `.claude/hooks/guard.cjs` | Claude কোনো কমান্ড চালানোর **আগে** (Bash আর PowerShell দুটোতেই) | বিপজ্জনক কমান্ড আটকায় (নিচে তালিকা) |
| `.claude/hooks/format.cjs` | Claude কোনো ফাইল এডিট করার **পরে** | সেই ফাইলে Prettier চালায় |
| `.claude/hooks/verify.cjs` | এডিটের **পরে** আর কাজ **শেষ করার আগে** | Claude কোড বদলালে typecheck আর টেস্ট পাস না হওয়া পর্যন্ত থামতে দেয় না |
| `.claude/settings.json` | — | উপরের hook-গুলো চালু করে, আর আসল `.env` ফাইল পড়া বন্ধ রাখে |
| `.claude/agents/*.md` | আপনি বা Claude ডাকলে | ৮টা বিশেষজ্ঞ subagent (নিচে বিস্তারিত) |
| `.claude/scratch/` | — | investigator-এর reproduction script রাখার জায়গা, git-এ যায় না |
| `CLAUDE.md` | প্রতিটা সেশনের শুরুতে | প্রজেক্টের কমান্ড আর নিয়ম। **`<...>` জায়গাগুলো নিজে পূরণ করবেন** |

## কোনো প্রজেক্টে বসানো

```bash
node "d:/learning project/claude-code-template/install.cjs" "d:/learning project/nest-learning"
```

- আপনার কোনো ফাইল মুছে ফেলে না বা overwrite করে না।
- আগে থেকে `.claude/settings.json` থাকলে **merge** করে। আপনার নিজের hook আর permission থেকে যায়, আর আসল ফাইলটা `settings.json.bak` নামে রাখা হয়।
- আগে থেকে `CLAUDE.md` থাকলে সেটা ছোঁয় না।
- দ্বিতীয়বার চালালে কিছুই বদলায় না।

তারপর:
1. প্রজেক্টের `CLAUDE.md` খুলে `<...>` জায়গাগুলো পূরণ করুন। **এটা বাদ দেবেন না।** পূরণ না করা পর্যন্ত ফাইলের উপরের নোটটা Claude-কে বলে `package.json` দেখে চলতে।
2. সেই প্রজেক্টে **নতুন** Claude Code session খুলুন। hook আর agent শুধু session শুরুর সময় লোড হয়।
3. লোড হয়েছে কিনা দেখতে: টার্মিনালের `claude`-এ `/agents` লিখুন। VS Code extension-এ hook দেখা যায় Customize অংশের **Hooks**-এ।
4. টিমের সাথে শেয়ার করতে চাইলে `.claude/` আর `CLAUDE.md` git-এ commit করুন। `*.bak` ফাইল commit করার দরকার নেই।

**টেমপ্লেট আপডেট করলে:** এই ফোল্ডারের ফাইল বদলানোর পর কোনো প্রজেক্টে নতুন ভার্সন নিতে শেষে `--force` দিন। এতে টেমপ্লেটের hook আর agent ফাইল, আর settings-এ এই টেমপ্লেটের এন্ট্রিগুলো বদলায়। প্রজেক্টের কোনো ফাইল টেমপ্লেট থেকে আলাদা হলে (যেমন আপনি নিজে বদলেছেন) আগেরটা `<নাম>.bak` হিসেবে রেখে দেয়। আপনার নিজের hook আর `CLAUDE.md` যেমন আছে তেমনই থাকে।

```bash
node "d:/learning project/claude-code-template/install.cjs" "<project>" --force
```

## ৮টা Subagent

agyis-harness-এর ৮টা agent থেকে Claude Code-এর জন্য নতুন করে লেখা। Antigravity আর PSL-নির্দিষ্ট অংশ বাদ দেওয়া হয়েছে, আর Node/TS stack-এর সাথে মিলিয়ে নেওয়া হয়েছে। প্রতিটা agent-এর **tool-এর তালিকাই** ঠিক করে দেয় সে কী পারে। তাই "read-only" agent সত্যিই ফাইল এডিট করতে পারে না।

| Agent | কাজ | ফাইল এডিট? | কমান্ড চালাতে পারে? |
|---|---|---|---|
| `planner` | কোড পড়ে ফাইল-ধরে-ধরে plan বানায় | ❌ | ❌ |
| `builder` | plan-এর একটা ধাপ কোড আর টেস্টসহ বানায় | ✅ | ✅ |
| `reviewer` | শুধু diff দেখে bug, নিরাপত্তা আর টেস্টের ঘাটতি ধরে | ❌ | শুধু git পড়া |
| `auditor` | typecheck, lint, test, build চালিয়ে প্রমাণসহ রিপোর্ট দেয় | ❌ | ✅ |
| `custodian` | duplicate কোড আর আর্কিটেকচার চেক করে, শুধু দরকারি ফাইল commit করে | ❌ | ✅ (git) |
| `investigator` | bug-এর root cause খোঁজে, `.claude/scratch/`-এ repro বানিয়ে প্রমাণ দেয় | শুধু scratch-এ | ✅ |
| `architect` | বড় কাজ: ডিজাইন করে, নিজে লেখে, বাকিদের কাজ ভাগ করে দেয় | ✅ | ✅ |
| `coordinator` | নিজে কোড লেখে না, পুরো টিম চালায় | ❌ | ❌ |

### ব্যবহার

**সাধারণ session থেকে**, যেকোনো agent-কে নাম ধরে ডাকুন:
```
reviewer subagent দিয়ে আমার uncommitted changes review করো
investigator দিয়ে বের করো login কেন fail করছে
custodian দিয়ে এই কাজটা commit করো
```
বিবরণ দেখে Claude নিজেও দরকারমতো এদের ডাকে।

**বড় কাজে coordinator বা architect-কে মূল session হিসেবে চালান:**
```bash
claude --agent coordinator    # নিজে কোড লেখে না, planner → builder → reviewer → custodian → auditor চালায়
claude --agent architect      # নিজেও কোড লেখে, দরকারে বাকিদের কাজ দেয়
```
এই দুটোকে সাধারণ subagent হিসেবে ডাকবেন না। Claude Code-এ subagent আরেকটা subagent চালু করতে *পারে*, কিন্তু সেগুলো পেছনে (background-এ) চলে, আর টেস্টে দেখা গেছে coordinator তাদের ফলাফল আসার আগেই নিজের রিপোর্ট দিয়ে শেষ হয়ে যায়। ফলে reviewer আর auditor চলেই না। মূল session হিসেবে চালালে পুরো ladder শেষ হয়।

`--agent` দিয়ে চালালে ওই agent-এর instruction Claude Code-এর সাধারণ system prompt-এর জায়গা নেয়, আর session শুধু ওই agent-এর tool পায়।

**VS Code extension-এ** `--agent` flag দেওয়ার জায়গা নেই। বিকল্প হলো প্রজেক্টের `.claude/settings.local.json`-এ `{"agent": "coordinator"}` লেখা। টার্মিনালের `claude`-এ এটা কাজ করে (টেস্ট করা), তবে extension-এ কাজ করে কিনা যাচাই করা হয়নি, আর ডকেও লেখা নেই। মনে রাখবেন, এটা থাকলে ওই প্রজেক্টের **প্রতিটা** session coordinator হয়ে যাবে, তাই কাজ শেষে মুছে ফেলবেন। সবচেয়ে নিশ্চিত উপায় VS Code-এর টার্মিনালে `claude --agent coordinator` চালানো।

**খরচ মনে রাখবেন:** প্রতিটা subagent আলাদা model call। ছোট কাজে (একটা ফাংশন ঠিক করা) সরাসরি Claude-কে বলাই সস্তা আর দ্রুত। ladder ব্যবহার করবেন বড় feature বা ঝুঁকিপূর্ণ পরিবর্তনে। কোনো agent-কে সস্তা model-এ চালাতে চাইলে তার ফাইলের `model: inherit` বদলে `model: sonnet` বা `model: haiku` দিন (যেমন reviewer বা auditor-এর জন্য)।

## প্রতিটা hook কীভাবে কাজ করে

### guard.cjs: যা আটকায়
- **ORM:** `prisma migrate reset`, `prisma db push --force-reset` / `--accept-data-loss`, `typeorm schema:drop`, `sequelize db:drop`
- **SQL / Mongo / Redis:** `DROP DATABASE/TABLE/SCHEMA`, `TRUNCATE`, WHERE ছাড়া `DELETE FROM`, `dropDatabase()`, `collection.drop()`, `deleteMany({})`, `FLUSHALL` / `FLUSHDB`
- **Docker:** `docker compose down -v`, `docker volume rm` / `prune`
- **Git:** `git push --force` / `-f` / `+branch`, `git reset --hard`, `git clean -f`, `git checkout .`, `git restore .`
- **ফাইল:** `rm -rf` দিয়ে `/`, `~`, `.`, `..`, `*` মোছা, আর PowerShell-এর `Remove-Item -Recurse` দিয়ে একই কাজ
- **Secret:** `cat .env` জাতীয় কমান্ড (`.env.example` পড়া যায়)
- **Publish:** `npm` / `pnpm` / `yarn` / `bun publish`

যা আটকায় না: `prisma migrate dev`, `git push --force-with-lease`, `rm -rf dist`, `docker compose down`, WHERE সহ `DELETE`। SQL-এর শব্দগুলো শুধু তখনই ধরা হয় যখন কমান্ডটা সত্যিই ডাটাবেস client বা `node` চালায়। তাই `git commit -m "drop table ..."` বা `grep "DROP TABLE"` আটকায় না।

### verify.cjs: completion fence
1. Claude প্রজেক্টের ভেতরে কোনো `.ts/.tsx/.js/.jsx` ফাইল এডিট করলে hook মনে রাখে "কোড বদলেছে"।
2. Claude থামতে গেলে hook চেক চালায়: TypeScript ইনস্টল থাকলে `tsc --noEmit`, আর `package.json`-এ `test` script থাকলে সেটা।
3. পাস করলে Claude থামে। Fail করলে error-এর শেষ অংশ Claude-কে দেখানো হয়, আর সে ঠিক করতে বাধ্য হয়।
4. Claude যদি কোড না বদলে আবার থামে (যেমন আপনার সিদ্ধান্ত দরকার), বা ৩ বার চেষ্টার পরও fail করে, তখন hook তাকে ছেড়ে দেয় আর **আপনাকে একটা warning দেখায়** ("Stop says: verify hook: ...")। তাই কখনো অনন্ত লুপ হয় না।

**এটা কী নিশ্চিত করে আর কী করে না:** fence নিশ্চিত করে যে Claude error-টা দেখবে আর আপনি warning পাবেন। কোড ঠিক হয়ে যাবে, এই গ্যারান্টি দেয় না। warning দেখলে নিজে চেক করবেন।

Claude কোড না বদলালে (শুধু প্রশ্নের উত্তর, ডক পড়া) কিছুই চলে না, এমনকি আপনার git-এ আগে থেকে uncommitted কাজ থাকলেও। git ছাড়া প্রজেক্টেও কাজ করে। subagent (যেমন builder) কোড বদলালেও ধরা পড়ে, আর মূল session থামার সময় চেক হয়।

### format.cjs
শুধু প্রজেক্টের ভেতরের ফাইলে, আর শুধু প্রজেক্টে Prettier ইনস্টল থাকলে চলে। কিছু ডাউনলোড করে না, আর কখনো Claude-কে আটকায় না।

## প্রজেক্ট অনুযায়ী বদলানো

**verify-তে কী চলবে সেটা ঠিক করতে:** প্রজেক্টের `package.json`-এ একটা `claude:verify` script যোগ করুন। এটা থাকলে verify hook ডিফল্ট চেকের বদলে শুধু এই script চালাবে:

```json
"scripts": {
  "claude:verify": "tsc --noEmit && eslint src && jest --onlyChanged"
}
```

| প্রজেক্ট | কখন দরকার | `claude:verify` |
|---|---|---|
| NestJS | টেস্ট স্যুট ধীর হলে | `tsc --noEmit && jest --onlyChanged` |
| Next.js | লিন্টও চালাতে চাইলে | `tsc --noEmit && next lint` |
| React (Vite) | সবসময় দিন, কারণ Vite-এর `tsconfig.json`-এ শুধু references থাকে আর ডিফল্ট `tsc --noEmit` কিছু চেক করে না | `tsc -b && vitest run` |
| Express (JS) | দরকার নেই | ডিফল্টে শুধু `test` script চলে |

- পুরো চেক ২৭০ সেকেন্ডের বেশি লাগলে hook চেকটা বন্ধ করে দেয় (টেস্টের সব process সহ) আর আপনাকে warning দেয়। তখন উপরের মতো দ্রুত একটা script দিন।
- ডিফল্টে শুধু `test` script চলে, `test:e2e` না। তাই ডাটাবেস চালু না থাকলেও সমস্যা হয় না।
- **কোনো কমান্ড guard-এ আটকে গেলে**, যেটা আসলে দরকার: কমান্ডটা নিজের টার্মিনালে চালান। অথবা প্রজেক্টের `.claude/hooks/guard.cjs` থেকে সেই লাইনটা মুছে দিন।
- **Claude-কে `.env` পড়তে দিতে চাইলে:** `settings.json`-এর `permissions.deny` থেকে লাইনগুলো সরান, আর `guard.cjs`-এর "Secrets" লাইনটা মুছুন।

## সীমাবদ্ধতা
- `guard.cjs` একটা নিরাপত্তা জাল, পুরোপুরি নিশ্চিত সুরক্ষা না। কমান্ড কোনো script ফাইলের ভেতরে লুকানো থাকলে (যেমন `npm run reset-db` বা `node scripts/wipe.js`) এটা ধরতে পারবে না। আসল সুরক্ষা হলো production ডাটাবেসের credential লোকাল `.env`-এ না রাখা।
- verify শুধু Claude-এর Edit/Write টুলের এডিট ধরে। Claude যদি shell কমান্ড দিয়ে (যেমন `sed`) কোড বদলায়, সেটা ধরা পড়ে না।
- `.env`-এর deny rule নির্দিষ্ট নাম ধরে লেখা (`.env`, `.env.local`, `.env.development`, `.env.production`, `.env.staging`, `.env.test`, `.env.*.local`)। অন্য নামের secret ফাইল থাকলে `settings.json`-এ যোগ করুন।

- agent-দের read-only হওয়া tool-এর তালিকা দিয়ে নিশ্চিত করা। কিন্তু reviewer, auditor আর custodian-এর Bash আছে, আর "শুধু পড়ার কমান্ড চালাও" নিয়মটা prompt-এ লেখা, কোড দিয়ে চাপানো না। guard hook subagent-এর কমান্ডেও চলে, তাই বিপজ্জনক কমান্ড তখনও আটকায়।

- agent-রা ভুল করতে পারে। টেস্টে (haiku মডেলে) coordinator একবার একই কাজ দুবার builder-কে দিয়েছে, আরেকবার builder শেষ হওয়ার আগেই reviewer চালু করেছে। দুবারই শেষ ফলাফল ঠিক ছিল, কারণ fence আর review ভুলটা ধরেছে। বড় model-এ এটা কতটা কম হয় তা টেস্ট করা হয়নি।
- coordinator-এর tool তালিকায় todo আর প্রশ্ন করার tool-এর নাম আছে। interactive session-এ এগুলোর কোনটা সত্যিই পাওয়া যায় তা যাচাই করা যায়নি (headless মোডে এগুলো থাকেই না)। না পেলে coordinator উত্তরের ভেতরেই checklist রাখে।

## যাচাই
Windows-এ Claude Code 2.1.300 আর Node 24 দিয়ে আসল সেশনে টেস্ট করা হয়েছে (সব টেস্ট haiku মডেলে, headless `claude -p` মোডে):
- **Hook:** guard কমান্ড আটকেছে, format ফাইল ঠিক করেছে, verify টাইপ error ধরে Claude-কে দিয়ে ঠিক করিয়েছে। `.env` পড়া আটকেছে, কিন্তু `.env.example` পড়া গেছে।
- **subagent-এর উপর hook:** subagent-এর কমান্ডেও guard চলে (`git clean -fd` আটকেছে)। subagent-এর এডিটও fence ধরে, কারণ session id একই থাকে।
- **tool restriction:** reviewer-এর কাছে শুধু `Read, Grep, Glob, Bash` থাকে। `--agent coordinator` session শুধু agent চালু করা আর পড়ার tool পায়।
- **reviewer:** ইচ্ছে করে ঢোকানো ৩টা bug-ই ধরেছে (`await` বাদ, password hash ফাঁস, অসীম cache), ফাইলে হাত দেয়নি।
- **coordinator** (`--agent`): নিজে কোড না লিখে builder → reviewer → auditor চালিয়েছে, দুটো আলাদা কাজে। দুবারই টেস্ট পাস।
- **coordinator subagent হিসেবে:** ladder শেষ করতে পারেনি (উপরে ব্যাখ্যা আছে)। তাই এভাবে ব্যবহার করতে মানা।
- **custodian:** শুধু দুটো দরকারি ফাইল commit করেছে, `debug.log` আর scratch বাদ দিয়েছে, conventional commit message দিয়েছে।
- **investigator:** ms বনাম seconds bug-এর আসল কারণ বের করেছে। scratch-এ repro বানিয়েছে, product কোডে হাত দেয়নি।
- **planner:** ঠিক format-এ plan আর open question দিয়েছে, কোনো ফাইল বদলায়নি।
- **architect:** subagent হিসেবে planner-কে চালু করতে পেরেছে, কিন্তু উত্তর আসার আগেই রিপোর্ট দিয়েছে। মূল session হিসেবে (`--agent architect`) টেস্ট করা হয়নি।

যা টেস্ট করা হয়নি: VS Code extension-এর ভেতরে (সব টেস্ট টার্মিনালের `claude` দিয়ে), আসল NestJS প্রজেক্টে jest-এর বড় টেস্ট স্যুট, macOS/Linux, আর haiku ছাড়া অন্য model।
