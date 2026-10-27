# Releasing

This package publishes to npm from GitHub Actions with an **npm provenance
statement**. From **May 1, 2026**, n8n requires community nodes submitted for
verification to be published this way. The workflow is already wired up in
[`.github/workflows/publish.yml`](.github/workflows/publish.yml); this file is
the one-time setup you (the maintainer) need to do once, plus the per-release
steps.

## One-time setup

### 1. Choose how GitHub authenticates to npm

**Option A — OIDC Trusted Publishing (recommended, no long-lived secret).**
GitHub mints a short-lived token per run; nothing is stored in the repo.

1. The package must already exist on npm (see the first-publish note below).
2. On npmjs.com → your package → **Settings → Publishing access → Trusted
   Publishers → Add a publisher**.
3. Select **GitHub Actions** and fill in:
   - Repository owner: `michaelwittmann`
   - Repository name: `n8n-nodes-xberg-pdf-vlm-extractor`
   - Workflow name: `publish.yml`
   - Environment: *(leave blank)*
4. Leave `NPM_TOKEN` **unset** in the repo. The workflow's
   `permissions: id-token: write` lets npm verify the run over OIDC.

**Option B — Automation token (fallback / first publish).**

1. On npmjs.com → **Access Tokens → Generate New Token → Granular Access
   Token**, scoped to this package with **Read and write** publish permission.
2. In GitHub → repo **Settings → Secrets and variables → Actions → New
   repository secret**, name it `NPM_TOKEN`, paste the token.
3. The workflow writes it to `.npmrc` only when it's present.

> **First-publish catch-22.** Trusted Publishing (Option A) can only be attached
> to a package that already exists on npm. For the very first release of this
> package, either publish once with an `NPM_TOKEN` (Option B) — then switch to
> OIDC and delete the token — or do a single manual `npm publish` locally.
> Provenance is produced in both cases because it's signed by GitHub's OIDC
> infrastructure regardless of how npm auth is handled.

> **Public access is required for provenance.** npm defaults a brand-new package
> to `restricted` access, and provenance publishing refuses that
> (`Can't generate provenance for new or private package, you must set access to
> public`). `package.json` sets `publishConfig.access: "public"` (and
> `provenance: true`) so `npm publish` picks this up automatically — no CLI flag
> needed. Don't remove it.

### 2. (Optional) Protect `main`

Require the **CI** workflow to pass on PRs before merge: repo **Settings →
Branches → Add branch ruleset → Require status checks** → select the CI jobs.

## Cutting a release

Releases are driven by `@n8n/node-cli`'s `release` command, which bumps the
version, updates the changelog, commits, tags, and pushes. The pushed tag
(`X.Y.Z`) triggers `publish.yml`.

```bash
npm run release
```

This runs interactively and will:

1. Lint and build.
2. Prompt for the new version (patch / minor / major).
3. Update the changelog and `package.json` version.
4. Commit, create a git tag `X.Y.Z`, and push both.

Then, automatically in GitHub Actions (`publish.yml`):

5. `npm ci` → **`npm test`** (release gate) → `npm run release` publishes to npm
   with `--provenance`.

> **Tag convention.** The workflow triggers on tags matching `*.*.*` (e.g.
> `0.2.0`). If you prefer a `v` prefix, change the trigger in `publish.yml` to
> `tags: ['v*.*.*']`.

## Verifying a release

- npm package page shows a **"Published with provenance"** badge and links the
  exact workflow run + commit.
- `npm view n8n-nodes-xberg-pdf-vlm-extractor dist-tags` shows the new version.
- Install it in a clean self-hosted n8n and confirm both nodes load.

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
