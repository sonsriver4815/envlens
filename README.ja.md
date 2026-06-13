# configenvy

[![CI](https://github.com/sonsriver4815/configenvy/actions/workflows/ci.yml/badge.svg)](https://github.com/sonsriver4815/configenvy/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/configenvy.svg)](https://www.npmjs.com/package/configenvy)
[![GitHub Release](https://img.shields.io/github/v/release/sonsriver4815/configenvy)](https://github.com/sonsriver4815/configenvy/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

壊れたセットアップ手順を、そのまま出さない。

ユーザーが `Error: DATABASE_URL is required` にぶつかる前に、環境変数の不足、古い記述、ドキュメント漏れ、危険なサンプル値を見つけます。

[English](README.md) · 日本語

クイックデモ • 出力例 • チェック内容 • GitHub Action • インストール

`configenvy` は、環境変数の情報が散らばりやすい場所をまとめて確認するCLIです。`.env.example`、ソースコード、README/docs、Docker Compose、GitHub Actions、デプロイ設定を照合し、「このプロジェクトを動かすには何を設定すればよいか」を明確にします。

![configenvy の仕組み](docs/assets/configenvy-flow-ja.svg)

## クイックデモ

```powershell
npx configenvy@latest doctor
```

セットアップ失敗の多くは、地味なズレから起きます。コードに変数があるのに `.env.example` にない。README の表が古い。CI の secret がどこにも説明されていない。

新しく設定を作る場合は、プロジェクトの構成を自動判定できます。

```powershell
npx configenvy@latest init --preset auto --dry-run
```

## 出力例

たとえば、コードにこう書かれていて:

```ts
console.log(process.env.DATABASE_URL);
console.log(process.env.STRIPE_WEBHOOK_SECRET);
```

`.env.example` がこうなっているとします。

```text
APP_URL=http://localhost:3000
```

configenvy はこう報告します。

```text
FAIL missing-example DATABASE_URL
  DATABASE_URL is used by code but missing from .env.example.

FAIL missing-example STRIPE_WEBHOOK_SECRET
  STRIPE_WEBHOOK_SECRET is used by code but missing from .env.example.

WARN undocumented STRIPE_WEBHOOK_SECRET
  STRIPE_WEBHOOK_SECRET is not mentioned in README or docs.
```

## Features

- `process.env.NAME`、`process.env["NAME"]`、`import.meta.env.NAME`、`Deno.env.get("NAME")` で参照されている環境変数を検出します。
- コード内の利用状況と `.env.example`、`.env.sample`、`.env.template` を比較します。
- 重要な環境変数が README や docs に書かれているか確認します。
- 実在しそうなトークン、秘密値、本番URLなど、サンプルとして危険な値を検出します。
- `.env.example` のコメントを、生成テーブルの説明文として使えます。
- Next.js、Vite、Astro、Nuxt、SvelteKit、Vercel、Docker などの framework preset を検出できます。
- README に貼り付けやすい Markdown 表を生成します。
- 人が読むための通常出力と、CI やスクリプト向けの JSON 出力に対応します。

## 比較

| 機能 | configenvy | dotenv-linter | grep/scripts |
| --- | --- | --- | --- |
| コード内の利用を確認 | 対応 | 非対応 | 一部 |
| README/docs のズレを確認 | 対応 | 非対応 | 非対応 |
| GitHub Actions secrets を確認 | 対応 | 非対応 | 一部 |
| README 用の env 表を生成 | 対応 | 非対応 | 非対応 |
| framework preset | 対応 | 非対応 | 非対応 |
| GitHub Action | 対応 | 手動 | 手動 |
| SARIF 出力 | 対応 | 非対応 | 非対応 |

configenvy は linter や secrets scanner の代わりではありません。コード、サンプル、ドキュメント、CI の小さなズレを見つけて、clone直後のセットアップ失敗を減らすためのツールです。

## Install

先にインストールしなくても使えます。プロジェクトのフォルダに移動して、これを実行します。

```powershell
cd "C:\path\to\your-project"
npx configenvy@latest doctor .
```

問題がなければ、こう表示されます。

```text
PASS configenvy found no environment variable issues.
```

プロジェクトにインストールして使うこともできます。

```powershell
npm install -D configenvy
npx configenvy doctor .
```

## Quick Start

今いるフォルダを確認:

```powershell
npx configenvy@latest doctor .
```

設定ファイルのひな形を作成:

```powershell
npx configenvy@latest init .
```

README に貼る表を表示:

```powershell
npx configenvy@latest table .
```

表をファイルに保存:

```powershell
npx configenvy@latest table . --out README.env.md
```

README 内の marker ブロックを更新:

```md
<!-- configenvy:start -->
<!-- configenvy:end -->
```

```powershell
npx configenvy@latest table . --update README.md
```

1つの環境変数について説明:

```powershell
npx configenvy@latest explain DATABASE_URL .
```

PowerShell の注意:

- `.` は「今いるフォルダ」です。
- スペース入りのパスは `"..."` で囲みます。
- パスを `[]` で囲む必要はありません。

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

`init` は `configenvy.config.json` を作ります。既存ファイルは上書きしません。よくある構成を自動判定する場合は `--preset auto`、明示的に選ぶ場合は `--preset <name>`、`.env.example` の下書きも作りたい場合は `--env-example`、書き込み内容を事前確認したい場合は `--dry-run`、生成ファイルを上書きしたい場合は `--force` を使います。preset は Astro、Docker、Next.js、Nuxt、SvelteKit、Vercel、Vite に対応しています。詳細は [Framework Presets](docs/presets.md) を見てください。

## What configenvy checks

- envサンプル: `.env.example`、`.env.sample`、`.env.template`
- ソースコード: `src/**/*.{js,jsx,ts,tsx,mjs,cjs}`
- ドキュメント: `README.md` と設定された docs パス
- CI と実行時設定: `.github/workflows/*.yml`、Docker Compose ファイル、`vercel.json`
- 生成物、キャッシュ、テスト、fixture ディレクトリ（`node_modules`、`dist`、`build`、`coverage`、`.next`、`.turbo`、`.vercel`、`.cache`、`out`、`test`、`tests`、`__tests__`、`__mocks__`、`fixtures` など）はデフォルトでスキップします。

## Supported patterns

| Source | Supported patterns |
| --- | --- |
| Node.js | `process.env.NAME`、`process.env["NAME"]` |
| Vite / frontend | `import.meta.env.NAME` |
| Deno | `Deno.env.get("NAME")` |
| GitHub Actions | `${{ secrets.NAME }}`、`${{ vars.NAME }}`、`${{ env.NAME }}` |
| shell形式の設定 | `${NAME}` |
| docs | `DATABASE_URL` のような大文字の変数名 |

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | 問題なし |
| 1 | warning あり |
| 2 | error あり、または `check --ci` が失敗 |
| 3 | 実行時エラーまたは設定エラー |

`configenvy check --ci` は、通常のテキスト出力では warning と error を GitHub Actions annotation としても出力します。GitHub code scanning など SARIF 対応ツールへ渡す場合は `--format sarif` を使います。

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

入力項目や SARIF の例は [CI](docs/ci.md) を見てください。

## Config

`configenvy` は設定ファイルなしでも使えます。必須変数、任意変数、無視したい変数、説明を探すドキュメントの場所を明示したい場合は、プロジェクトルートに `configenvy.config.json` を置きます。

```json
{
  "required": ["DATABASE_URL"],
  "optional": ["LOG_LEVEL"],
  "ignore": ["NODE_ENV"],
  "docs": ["README.md", "docs"]
}
```

- `required`: env example やプロジェクト設定に必ず載せたい環境変数
- `optional`: 使ってよいが、未設定でもチェックを失敗させない環境変数
- `ignore`: `NODE_ENV` など、診断から外したい環境変数
- `docs`: 説明を探す README や docs のパス

セットアップ失敗の多くは、そこまで謎ではありません。コードに変数を追加したのに `.env.example` に書き忘れた。README の表が古くなった。サンプルにトークンっぽい値が入った。`configenvy` は、その小さな契約を見える状態に保ちます。

## Limitations

`configenvy` は軽量な静的解析を使っています。よく使われる JavaScript / TypeScript の env 参照、framework preset、docs check、SARIF 出力に対応していますが、すべての言語や実行環境を完全に理解するわけではありません。`process.env[prefix + "_TOKEN"]` のような動的な名前は見逃すことがあります。

目的は、よくあるセットアップ破綻を早めに見つけることです。完全な secrets scanner、policy engine、型対応の compiler plugin を置き換えるものではありません。

## Roadmap

- GitHub Actions 向けの PR summary 出力
- preset 自動検出の精度改善と framework 別ガイド
- false positive や見逃しを減らすための、より深い AST 解析
- env docs を編集しながら確認できる VS Code 拡張

## Privacy and safety

`configenvy` は、デフォルトで `.env` と example ではない `.env.*` ファイルを読みません。ローカルで実行され、ファイルをアップロードしたり外部 API を呼び出したりしません。env documentation のずれを報告するために、example ファイル、ソースコード、ドキュメント、一部の設定ファイルだけを読みます。
