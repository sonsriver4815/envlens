# configenvy

[![CI](https://github.com/sonsriver4815/configenvy/actions/workflows/ci.yml/badge.svg)](https://github.com/sonsriver4815/configenvy/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/configenvy.svg)](https://www.npmjs.com/package/configenvy)
[![GitHub Release](https://img.shields.io/github/v/release/sonsriver4815/configenvy)](https://github.com/sonsriver4815/configenvy/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Stop shipping broken setup docs.

Find missing, stale, undocumented, and risky environment variables before your users hit `Error: DATABASE_URL is required`.

English · [日本語](README.ja.md)

What It Looks Like • What It Catches • GitHub Action • Framework Presets • Installation

`configenvy` checks the places env vars drift: `.env.example`, source code, README/docs, Docker Compose, GitHub Actions, and deployment config. It gives contributors a clear answer to one setup question: "What do I need to set before this project runs?"

![configenvy workflow](docs/assets/configenvy-flow.svg)

## Quick Demo

```powershell
npx configenvy@latest doctor
```

Most projects break for boring reasons: a variable exists in code, but not in `.env.example`; a README table is stale; CI uses a secret nobody documented.

Starting a new config? Let configenvy detect your stack:

```powershell
npx configenvy@latest init --preset auto --dry-run
```

## What It Looks Like

Given this code:

```ts
console.log(process.env.DATABASE_URL);
console.log(process.env.STRIPE_WEBHOOK_SECRET);
```

and this `.env.example`:

```text
APP_URL=http://localhost:3000
```

configenvy reports:

```text
FAIL missing-example DATABASE_URL
  DATABASE_URL is used by code but missing from .env.example.

FAIL missing-example STRIPE_WEBHOOK_SECRET
  STRIPE_WEBHOOK_SECRET is used by code but missing from .env.example.

WARN undocumented STRIPE_WEBHOOK_SECRET
  STRIPE_WEBHOOK_SECRET is not mentioned in README or docs.
```

## Features

- Finds env vars used through `process.env.NAME`, `process.env["NAME"]`, `import.meta.env.NAME`, and `Deno.env.get("NAME")`.
- Compares code usage with `.env.example`, `.env.sample`, and `.env.template`.
- Checks whether important variables are mentioned in README or docs.
- Flags sample values that look like real tokens, private values, or production URLs.
- Reuses `.env.example` comments as variable descriptions in generated tables.
- Detects common framework presets for Next.js, Vite, Astro, Nuxt, SvelteKit, Vercel, and Docker.
- Generates Markdown tables you can paste into a README.
- Prints readable output for humans and JSON for scripts or CI.

## How It Compares

| Feature | configenvy | dotenv-linter | grep/scripts |
| --- | --- | --- | --- |
| Checks code usage | yes | no | partial |
| Checks README/docs drift | yes | no | no |
| Checks GitHub Actions secrets | yes | no | partial |
| Generates README env tables | yes | no | no |
| Framework presets | yes | no | no |
| GitHub Action | yes | manual | manual |
| SARIF output | yes | no | no |

configenvy does not replace your linter or secrets scanner. It catches setup contract drift: the small mismatch between code, examples, docs, and CI that makes a fresh clone fail.

## Install

You do not need to install anything first. Move to your project folder and run:

```powershell
cd "C:\path\to\your-project"
npx configenvy@latest doctor .
```

If everything is OK, you will see:

```text
PASS configenvy found no environment variable issues.
```

You can also install it in a project:

```powershell
npm install -D configenvy
npx configenvy doctor .
```

## Quick Start

Check the current folder:

```powershell
npx configenvy@latest doctor .
```

Create a starter config file:

```powershell
npx configenvy@latest init .
```

Generate a Markdown table:

```powershell
npx configenvy@latest table .
```

Save that table to a file:

```powershell
npx configenvy@latest table . --out README.env.md
```

Update a marked table block in README:

```md
<!-- configenvy:start -->
<!-- configenvy:end -->
```

```powershell
npx configenvy@latest table . --update README.md
```

Explain one variable:

```powershell
npx configenvy@latest explain DATABASE_URL .
```

PowerShell tips:

- `.` means the current folder.
- Wrap paths with spaces in quotes.
- Do not wrap paths in `[]`.

```powershell
npx configenvy@latest table "C:\path\to\your-project"
```

## CLI

```text
configenvy doctor [path]
configenvy doctor --format json [path]
configenvy doctor --format sarif [path]
configenvy doctor --strict [path]
configenvy check --ci [path]
configenvy check --ci --format sarif [path]
configenvy init [path]
configenvy init [path] --preset auto
configenvy init [path] --preset nextjs
configenvy init [path] --env-example
configenvy init [path] --dry-run
configenvy table [path] --out README.env.md
configenvy table [path] --update README.md
configenvy table [path] --update README.md --dry-run
configenvy explain DATABASE_URL [path]
```

`init` creates `configenvy.config.json` without overwriting existing files. Add `--preset auto` to detect common stacks, `--preset <name>` to choose one directly, `--env-example` to draft missing variables into `.env.example`, `--dry-run` to preview writes, or `--force` to overwrite generated files. Presets include Astro, Docker, Next.js, Nuxt, SvelteKit, Vercel, and Vite. See [Framework Presets](docs/presets.md).

## What configenvy checks

- Env example files: `.env.example`, `.env.sample`, `.env.template`
- Source code: `src/**/*.{js,jsx,ts,tsx,mjs,cjs}`
- Documentation: `README.md` and configured docs paths
- CI and runtime config: `.github/workflows/*.yml`, Docker Compose files, `vercel.json`
- Generated, cache, test, and fixture directories such as `node_modules`, `dist`, `build`, `coverage`, `.next`, `.turbo`, `.vercel`, `.cache`, `out`, `test`, `tests`, `__tests__`, `__mocks__`, and `fixtures` are skipped by default.

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
| 3 | Runtime or config error |

`configenvy check --ci` also emits GitHub Actions annotations for warnings and errors when using the default text output. Use `--format sarif` when you want to upload results to GitHub code scanning or another SARIF-compatible tool.

## GitHub Action

```yaml
name: configenvy
on: [pull_request]
jobs:
  configenvy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: sonsriver4815/configenvy/.github/actions/configenvy@v0.2.0
        with:
          path: .
```

See [CI](docs/ci.md) for inputs and SARIF examples.

## Config

`configenvy` works without a config file. Add `configenvy.config.json` when you want to make a few rules explicit: which variables are required, which ones are optional, which ones should be ignored, and where documentation should be checked.

```json
{
  "required": ["DATABASE_URL"],
  "optional": ["LOG_LEVEL"],
  "ignore": ["NODE_ENV"],
  "docs": ["README.md", "docs"]
}
```

- `required`: variables that must appear in your env examples or project config
- `optional`: variables that are allowed but should not fail checks when absent
- `ignore`: variables to leave out of diagnostics, such as runtime defaults
- `docs`: README or docs paths where descriptions should be checked

Most setup failures are not mysterious. A variable was added in code but not in `.env.example`. A README table went stale. A token-like value slipped into a sample file. `configenvy` keeps that small contract visible.

## Limitations

`configenvy` uses lightweight static analysis. It supports common JavaScript and TypeScript env patterns, framework presets, docs checks, and SARIF output, but it does not fully understand every language or runtime. Dynamic names such as `process.env[prefix + "_TOKEN"]` may still be missed.

Use it as an early setup check, not as a replacement for a full secrets scanner, policy engine, or type-aware compiler plugin.

## Roadmap

- PR summary output for GitHub Actions
- Better preset detection and framework-specific guidance
- Deeper AST parsing for fewer false positives and missed references
- VS Code extension for local feedback while editing env docs

## Privacy and safety

`configenvy` skips `.env` and non-example `.env.*` files by default. It runs locally, does not upload files, and does not call external APIs. It reads example files, source files, docs, and selected config files only to report env documentation drift.
