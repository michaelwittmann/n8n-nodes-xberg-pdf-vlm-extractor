# Releasing

This package publishes to npm from GitHub Actions with an **npm provenance
statement**, behind a **manual approval gate**. From **May 1, 2026**, n8n
requires community nodes submitted for verification to be published this way.
The workflow is wired up in
[`.github/workflows/publish.yml`](.github/workflows/publish.yml).

## Release flow at a glance

```
local:  npm run release   → bump + changelog + commit + tag vX.Y.Z + push
           │  (tag push triggers publish.yml)
           ▼
CI:     stage job   → npm ci + test + build + npm pack → upload tarball artifact
           │  (pauses on the protected `npm-release` environment)
           ▼
you:    GitHub → Actions → the run → "Review deployments" → Approve
           ▼
CI:     publish job → npm run release (CI mode) → OIDC publish with provenance
```

The version is decided **locally** (reviewed, with tests seen); shipping to npm
is a deliberate **human approval on GitHub**. No long-lived npm token is used.

## One-time setup

### 1. Create the protected `npm-release` environment

This is what makes the publish job pause for your approval.

1. Repo → **Settings → Environments → New environment** → name it
   **`npm-release`** (must match `environment:` in `publish.yml`).
2. Add a protection rule: **Required reviewers** → add yourself.
3. (Optional) Restrict the environment to the tag/branch patterns you release from.

### 2. Set up npm OIDC Trusted Publishing

GitHub mints a short-lived token per run; nothing is stored in the repo.

1. On npmjs.com → the package → **Settings → Trusted Publishers → Add a
   publisher**.
2. Select **GitHub Actions** and fill in:
   - Repository owner: `michaelwittmann`
   - Repository name: `n8n-nodes-xberg-pdf-vlm-extractor`
   - Workflow name: `publish.yml`
   - **Environment: `npm-release`** ← must match the environment above
3. **Delete the `NPM_TOKEN` repo secret** (Settings → Secrets and variables →
   Actions). It is no longer used — the publish job authenticates over OIDC via
   `permissions: id-token: write`.

### 3. (Optional) Protect `main`

Require the **CI** workflow to pass on PRs before merge: repo **Settings →
Branches → Add branch ruleset → Require status checks** → select the CI jobs.

## Cutting a release

There are two ways to cut a release. Both end at the same gated OIDC publish;
pick whichever fits where you are.

### Option A — locally (`npm run release`)

Run the release locally. `@n8n/node-cli release` is context-aware: **run locally
it only bumps/tags/pushes — it does not publish**; the publish happens later in
CI.

```bash
npm run release
```

This runs interactively and will:

1. Lint and build.
2. Prompt for the new version (patch / minor / major).
3. Update the changelog and `package.json` version.
4. Commit, create a git tag `vX.Y.Z`, push both, and create a GitHub release.

The pushed tag triggers `publish.yml`:

5. **stage** job: `npm ci` → `npm test` → `npm run build` → `npm pack`, uploading
   the tarball as an artifact you can inspect.
6. The **publish** job then waits: open the run under the **Actions** tab and
   click **Review deployments → Approve** on the `npm-release` environment.
7. On approval, the publish job runs `npm run release` (CI mode), which publishes
   to npm with provenance over OIDC.

### Option B — from the GitHub UI, no laptop (`prepare-release.yml`)

For when you don't have your dev machine. Everything — including the version
bump — happens in CI.

1. Repo → **Actions → "Prepare release" → Run workflow**.
2. Pick the **Semver bump** (patch / minor / major) and run.
3. The **bump** job runs `npm version <type>`, regenerates the changelog,
   commits, tags `vX.Y.Z`, and pushes.
4. The **stage** job builds/tests/packs the bumped code (same as Option A).
5. The **publish** job waits on the `npm-release` environment — **Review
   deployments → Approve** — then publishes over OIDC with provenance.

> **Extra one-time setup for Option B.** npm Trusted Publishers match on the
> **exact workflow filename**, so `prepare-release.yml` needs its *own* Trusted
> Publisher entry in addition to the one for `publish.yml` (npm allows up to 10
> per package). Add a second publisher: same owner/repo, workflow filename
> `prepare-release.yml`, Environment `npm-release`. Without it the publish job
> fails with `OIDC permission denied`.

> **Tag convention.** `publish.yml` triggers on tags matching `v*.*.*` (e.g.
> `v0.2.0`) — the format `@n8n/node-cli release` produces, and the format
> `prepare-release.yml`'s `npm version` bump produces too.

> **Public access is required for provenance.** `package.json` sets
> `publishConfig.access: "public"` (and `provenance: true`) so `npm publish`
> picks this up automatically. Don't remove it — without it, a first publish of a
> new package fails with `Can't generate provenance for new or private package`.

## Verifying a release

- npm package page shows a **"Published with provenance"** badge and links the
  exact workflow run + commit.
- `npm view n8n-nodes-xberg-pdf-vlm-extractor dist-tags` shows the new version.
- Install it in a clean self-hosted n8n and confirm both nodes load.

## History: the first publish (v0.1.0)

`0.1.0` was published with a one-off npm **Granular Access Token** (`NPM_TOKEN`
repo secret), because OIDC Trusted Publishing can only be attached to a package
that already exists on npm. Once `0.1.0` was live, the project switched to OIDC +
the approval gate described above, and the token was removed. This is the
expected bootstrap path for the first release of any new package.

## Submitting for n8n verification

Once published with provenance, submit via the n8n Creator Portal. Checklist
(from n8n's [verification guidelines](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/verification-guidelines)):

- [x] Scaffolded with the `n8n-node` CLI
- [x] MIT license
- [x] `repository.url` in `package.json` matches the public GitHub repo
- [x] README with usage examples
- [x] Published from a GitHub Action **with provenance**
- [ ] **No runtime dependencies** — ⚠️ this package depends on
      `@xberg-io/xberg` (native binaries), so it is **not eligible for n8n
      Cloud verification**. It is self-hosted-only by design. Submit only if
      targeting the self-hosted/unverified track.
