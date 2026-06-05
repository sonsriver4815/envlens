# envlens

[![CI](https://github.com/sonsriver4815/envlens/actions/workflows/ci.yml/badge.svg)](https://github.com/sonsriver4815/envlens/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Catch missing, stale, undocumented, and risky environment variables before they break someone else's setup.

`envlens` checks the places env vars tend to drift: `.env.example`, source code, README/docs, Docker Compose, GitHub Actions, and deployment config. It gives contributors a clear answer to a simple question: "What do I need to set before this project runs?"

![envlens workflow](docs/assets/envlens-flow.svg)

```bash
npx envlens doctor
```

Without envlens, setup failures often show up late:

```text
Error: DATABASE_URL is required
```

With envlens, the missing contract is visible up front:

```text
FAIL missing-example DATABASE_URL
  DATABASE_URL is used by code or required by config but is missing from .env.example files.
WARN undocumented STRIPE_WEBHOOK_SECRET
  STRIPE_WEBHOOK_SECRET is not mentioned in README or docs.
```

## Features

- Finds env vars used through `process.env.NAME`, `process.env["NAME"]`, `import.meta.env.NAME`, and `Deno.env.get("NAME")`.
- Compares code usage with `.env.example`, `.env.sample`, and `.env.template`.
- Checks whether important variables are actually mentioned in README or docs.
- Flags example values that look like real tokens, private values, or production URLs.
- Generates Markdown tables you can paste into a README.
- Prints readable output for humans and JSON for scripts or CI.

## Install

Until the package is published to npm, run it from a local checkout:

```bash
git clone https://github.com/sonsriver4815/envlens.git
cd envlens
npm install
npm run build
node packages/cli/dist/index.js doctor .
```

After the first npm release:

```bash
npm install -D envlens
npx envlens doctor
```

## Quick Start

```bash
npm install
npm run build
node packages/cli/dist/index.js doctor examples/broken
node packages/cli/dist/index.js table examples/nextjs
node packages/cli/dist/index.js explain DATABASE_URL examples/nextjs
```

## CLI

```bash
envlens doctor [path]
envlens doctor --format json [path]
envlens doctor --strict [path]
envlens check --ci [path]
envlens table [path] --out README.env.md
envlens explain DATABASE_URL [path]
```

## What envlens checks

- Env example files: `.env.example`, `.env.sample`, `.env.template`
- Source code: `src/**/*.{js,jsx,ts,tsx,mjs,cjs}`
- Documentation: `README.md` and configured docs paths
- CI and runtime config: `.github/workflows/*.yml`, Docker Compose files, `vercel.json`

## Supported patterns

| Source | Supported patterns |
| --- | --- |
| Node.js | `process.env.NAME`, `process.env["NAME"]` |
| Vite / frontend | `import.meta.env.NAME` |
| Deno | `Deno.env.get("NAME")` |
| GitHub Actions | `${{ secrets.NAME }}`, `${{ vars.NAME }}`, `${{ env.NAME }}` |
| Shell-style config | `${NAME}` |
| Docs | Uppercase names such as `DATABASE_URL` |

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | No issues found |
| 1 | Warnings found |
| 2 | Errors found, or `check --ci` failed |
| 3 | Runtime or configuration error |

## Configuration

Add `envlens.config.json` to your project root when you want to tune the defaults:

```json
{
  "required": ["DATABASE_URL"],
  "optional": ["LOG_LEVEL"],
  "ignore": ["NODE_ENV"],
  "docs": ["README.md", "docs"]
}
```

## Why

Most setup failures are not mysterious. A variable was added in code but not in `.env.example`. A README table went stale. A token-like value slipped into a sample file. `envlens` keeps that small contract honest.

## Limitations

`envlens` uses lightweight static extraction in v0.1. It does not fully parse every language or framework, and it may miss dynamic names such as `process.env[prefix + "_TOKEN"]`. It is meant to catch the common setup-breaking drift first, not replace a full secrets scanner or type-aware compiler plugin.

## Roadmap

- GitHub Action for PR comments
- SARIF output for code scanning tools
- Framework presets for Next.js, Vite, Remix, and Docker-heavy projects
- Deeper AST parsing for fewer false positives and missed references
- VS Code extension for local feedback while editing env docs

## Privacy and safety

`envlens` skips `.env` and non-example `.env.*` files by default. It runs locally, does not upload files, and does not call external APIs.

## License

MIT
