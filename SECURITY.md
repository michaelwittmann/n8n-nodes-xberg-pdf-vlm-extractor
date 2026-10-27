# Security

## Reporting a vulnerability

If you find a security issue in this package's own code (`nodes/`, the published
`dist/`), please open a GitHub issue or contact the maintainer. For issues in the
underlying extraction library, report upstream to
[`@xberg-io/xberg`](https://www.npmjs.com/package/@xberg-io/xberg).

## About `npm audit` / Dependabot findings

`npm audit` and GitHub Dependabot report advisories in this repo's
**devDependencies** — the build and release tooling (`@n8n/node-cli`,
`release-it` and their transitive deps such as `zod`, `undici`, `stream-json`,
`basic-ftp`, `uuid`). As of the last review these were **dev-only** and did not
affect anyone installing the package. This is expected for an n8n community node
and is **not** a vulnerability in the published package.

Why these findings don't reach consumers:

- **The published tarball ships only `dist/`** (`package.json` → `"files": ["dist"]`).
  The dev tooling is never included. Verify with `npm pack --dry-run`.
- **The only runtime dependencies are `@xberg-io/xberg` and `pdf-lib`**
  (`n8n-workflow` is a peer dependency provided by the n8n host, not bundled).
  None of the flagged packages are among them. Verify with
  `npm ls --omit=dev --depth=0`.
- The flagged packages run only during local build/lint/release and in CI, not
  at node runtime and not against untrusted input.

### Why they aren't patched on sight

The vulnerable versions are **pinned transitively by n8n's own packages**, so
`npm audit fix` resolves none of them without `--force`, which would downgrade or
replace `@n8n/node-cli` internals and break the lint/build/release tooling. The
upstream fixes land when n8n publishes updated dependencies.

### How they're tracked

[`.github/dependabot.yml`](.github/dependabot.yml) runs a weekly grouped
`development-dependencies` update. When n8n ships sub-dependencies that unpin the
fixed versions, Dependabot opens a PR automatically. Major-version bumps are
intentionally ignored (see the config) and reviewed manually.

Dev-only advisories with no consumer impact may be dismissed in the repo's
**Security → Dependabot alerts** tab with the reason **"Vulnerable code is not
actually used"**, referencing this document.
