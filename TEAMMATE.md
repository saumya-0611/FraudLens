# TEAMMATE.md: how we work (read this first)

**Project:** FraudLens, Real-Time Financial Fraud Detection Platform (Capstone II, Team 34)
**Presentation:** Friday **27 Nov 2026**. Today is the start of a 12-day sprint, so keep things simple and finish the flow end to end.

You will build your part with an AI helper (Claude, ChatGPT, Copilot, etc.) on **your own branch**. The team lead reviews and merges.
The only reason this works is that all of us follow the same rules and the same contract file.

---

## 1. Who owns what

| Person | Role | Task file |
|---|---|---|
| Team Lead | AI/ML + DevOps + Big Data (streaming, DB, simulator) | `tasks/LEAD_AIML_DEVOPS_STREAMING.md` |
| Riya | Backend (non-security routes, Kafka, WebSocket) + Data Science | `tasks/RIYA_BACKEND_DS.md` |
| Amrita | Frontend (React) | `tasks/AMRITA_FRONTEND.md` |
| Shivansh | Cyber Security (auth, RBAC, audit, attack tests, K8s security manifests) | `tasks/SHIVANSH_CYBER.md` |

**Everything about APIs, database tables, Kafka messages, features and ports is in `docs/CONTRACTS.md`.** That file is the law.

---

## 2. Final folder structure

```
fraudLens/
├── README.md
├── TEAMMATE.md                      <- this file
├── .gitignore
├── .env.example                     (copy to .env locally; never commit .env)
├── docker-compose.yml               [Lead]
│
├── docs/
│   ├── CONTRACTS.md                 [Lead edits only]
│   ├── demo-script.md               [Lead]
│   └── test-reports/                (latency, security, model evaluation)
├── tasks/                           (the four task files)
│
├── frontend/                        [Amrita]  React + Vite + Tailwind
│   └── src/ pages/ (admin/) components/ context/ hooks/ services/ mocks/ routes/
│
├── backend/                         [Riya + Shivansh]  Node + Express
│   ├── scripts/                     seed.js, verify_audit_chain.js = Shivansh; seed_sample_data.js = Riya
│   └── src/
│       ├── server.js                [Riya]
│       ├── config/                  [Riya]
│       ├── routes/                  transactions, alerts, dashboard, models = Riya
│       │                            auth, users, audit = Shivansh
│       ├── controllers/             [Riya]
│       ├── kafka/                   [Riya]  producer.js, alertConsumer.js
│       ├── websocket/               [Riya]
│       ├── middleware/              [Shivansh]  authenticate, authorize, validate, serviceAuth
│       ├── validation/              [Shivansh]  schemas.js
│       ├── audit/                   [Shivansh]
│       ├── utils/                   mask.js, jwt.js = Shivansh
│       └── tests/
│
├── ml-service/                      [Lead]  FastAPI
│   └── app/ (main.py, predictor.py, registry/, retrain/, drift/, security.py)  training/  model_store/ (git-ignored)
│
├── streaming/                       [Lead]  Spark job + pipeline
│   └── jobs/ (main_stream.py, pipeline.py, classify.py, writer.py)
│
├── shared/                          used by BOTH ml-service and streaming
│   ├── fraud_features.py            [Riya]
│   ├── category_map.json            [Riya]
│   ├── thresholds.json              [Riya]
│   ├── feature_spec.md              [Riya]
│   └── tests/                       [Riya]  parity test
│
├── data-science/                    [Riya]
│   ├── datasets/                    (git-ignored CSVs)
│   ├── notebooks/                   01_eda, 02_features, 03_thresholds, 04_evaluation
│   └── drift/psi.py
│
├── database/                        [Lead]  init.sql
├── simulator/                       [Lead]  replay.py, load_test.py
├── security/                        [Shivansh]  threat-model.md, attack_tests/, security notes
├── deploy/k8s/                      [Shivansh]  K8s Deployments, Services, Secrets & NetworkPolicy (Minikube)
└── .github/workflows/               [Lead + Shivansh]  ci.yml + security-scan.yml
```

To create all folders and the stub files at once, the lead runs `bash scaffold.sh` in the repo root. It never overwrites existing files.

**Rule: only edit files in YOUR folders.** Need a change elsewhere? Tell the owner (or the lead) in the group chat.

---

## 3. Branches

| Branch | Purpose | Who pushes |
|---|---|---|
| `main` | always working, demo-ready | **lead only** |
| `dev` | integration of everyone's finished work | lead merges PRs here |
| `riya/<topic>`, `amrita/<topic>`, `shivansh/<topic>`, `lead/<topic>` | your daily work | you |

Example names: `riya/backend-skeleton`, `riya/features`, `amrita/dashboard`, `shivansh/auth`, `lead/ml-service`.
One branch per task, small and short-lived (1-2 days). Small branches merge easily.

---

## 4. One-time setup (each teammate)

```bash
git clone https://github.com/<ORG-OR-USER>/fraudLens.git
cd fraudLens
git checkout dev
cp .env.example .env          # Windows PowerShell: copy .env.example .env
```

Install: Docker Desktop, Git, Node 20+, Python 3.11+. Ask the lead to add you as a **collaborator** on the repo so you can push your branches.

---

## 5. Daily workflow (copy-paste these)

**Morning: get the latest work from the team**

```bash
git checkout dev
git pull origin dev
git checkout riya/backend-skeleton        # your branch
git merge dev                              # bring the latest dev into your branch
```

If this is a new task, create a new branch instead of the last line:

```bash
git checkout dev
git pull origin dev
git checkout -b riya/backend-routes
```

**While working: save often**

```bash
git status                                 # what changed?
git add .                                  # stage everything (check .env is NOT listed!)
git commit -m "backend: add GET /api/transactions with filters"
```

**Evening (or after each finished task): push your branch**

```bash
git push -u origin riya/backend-routes     # first time on this branch
git push                                   # later pushes
```

Then on GitHub click **Compare & pull request**: base = `dev`, compare = your branch. Fill the checklist (section 7). Tell the lead in the group chat.

**Commit message style:** `area: what you did` (for example `frontend: add alerts table`, `cyber: lockout after 5 failed logins`, `ds: add parity test for features`).

### If git says there is a conflict

```bash
git merge dev            # conflict appears in some files
# open the file, search for <<<<<<< ======= >>>>>>>, keep the correct lines, delete the markers
git add <the-file>
git commit -m "merge dev into my branch"
```
Conflicts in files you don't own mean someone broke the ownership rule. Keep THEIR version of files you do not own: `git checkout --theirs <file>` is risky, so ask the lead instead.

### Useful rescue commands

```bash
git restore <file>             # throw away your uncommitted changes in a file
git stash                      # park your changes temporarily
git stash pop                  # bring them back
git log --oneline -10          # last 10 commits
git branch                     # which branch am I on?
git diff                       # see exactly what changed
```

### Never do

- Never `git push --force`.
- Never commit `.env`, `node_modules/`, `datasets/*.csv`, `model_store/`, passwords or tokens. (They are in `.gitignore`; if `git status` shows them, stop and ask.)
- Never push directly to `main` or `dev`.
- Never edit `docs/CONTRACTS.md`.

---

## 6. How to use your AI helper properly

1. Open your **task file** and copy the "Starter prompt" at the top into your AI helper. Attach (or paste) `docs/CONTRACTS.md` and your task file.
2. Work **one task at a time**, in the order of the task file. Ask the AI for the code, the test, and the run command for that task.
3. Run it yourself. Do not push code you have not run.
4. Ask the AI to explain every file in simple words. You must be able to explain your code in the viva.
5. If the AI suggests changing an API field, a table, a port or a topic: **stop**. That is a contract change. Message the lead.
6. If the AI wants to edit a folder you don't own: **say no**. Ask the owner.
7. Keep the code simple. Working and explainable beats clever.

### Contract change requests
Post in the group chat: what you need, why, and which file it affects. The lead updates `docs/CONTRACTS.md` on `dev` and tells everyone to run `git merge dev`.

---

## 7. Pull request checklist (paste into the PR description)

```
- [ ] I only changed files in my own folders
- [ ] It follows docs/CONTRACTS.md (field names, endpoints, ports)
- [ ] I ran it and it works (command: ...........)
- [ ] I added/updated at least a basic test or a manual test note
- [ ] No secrets, .env, datasets or model files are included
- [ ] I can explain every file I added
```

The lead checks: contract followed, runs with `docker compose up`, nothing outside the owner's folders, then merges into `dev`.
The lead merges `dev` into `main` only at milestones.

---

## 8. Schedule (12 days)

| Date | Milestone |
|---|---|
| Sun 15 - Mon 16 Nov | **M0:** repo skeleton + CONTRACTS on `main`; everyone clones and creates branches; Riya's backend skeleton and lead's docker-compose + ML stub pushed |
| Wed 18 Nov | **M1 Walking skeleton:** simulator -> backend -> Kafka -> pipeline -> DB -> alert -> WebSocket -> dashboard toast, using stubs. Riya's `fraud_features.py` merged (critical). |
| Thu 19 Nov (noon) | Spark go/no-go decision (lead) |
| Sat 21 Nov | **M2:** real model + real auth + real screens integrated on `dev` |
| Mon 23 Nov | **M3 FEATURE FREEZE:** all FR features done (hybrid detection, drift, retrain/activate, audit). After this: bug fixes only. |
| Tue 24 - Wed 25 Nov | Load tests, security tests, bug fixes, report, slides |
| Thu 26 Nov | Demo rehearsal x2, record a **backup demo video**, tag `demo-ready`, code freeze at noon |
| **Fri 27 Nov** | **Presentation** |

Daily rhythm: short check-in in the morning ("today I will do X, blocked by Y"), push your branch by evening, lead merges PRs at about 9 pm.

---

## 9. Definition of Done (for each task)

It runs, it follows CONTRACTS, it has at least one test or a written manual test, it is pushed on your branch, a PR is open, and you can explain it.

---

## 10. LEAD-ONLY: first-day commands

```bash
cd fraudLens
# 1) copy this pack into the repo root (TEAMMATE.md, scaffold.sh, docs/, tasks/), then:
bash scaffold.sh                      # Windows: run in Git Bash
git add .
git commit -m "chore: project skeleton, contracts, task files"
git push origin main
git checkout -b dev
git push -u origin dev
```

Then on GitHub: **Settings -> Collaborators** (add the three teammates), **Settings -> Branches** -> protect `main` (require a pull request).
Merging a teammate's PR: review on GitHub -> **Merge pull request** into `dev`. At each milestone: open a PR `dev -> main` and merge it.
Final: `git checkout main && git pull && git tag demo-ready && git push --tags`.
