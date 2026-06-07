# configenvy

[![CI](https://github.com/sonsriver4815/configenvy/actions/workflows/ci.yml/badge.svg)](https://github.com/sonsriver4815/configenvy/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/configenvy.svg)](https://www.npmjs.com/package/configenvy)
[![GitHub Release](https://img.shields.io/github/v/release/sonsriver4815/configenvy)](https://github.com/sonsriver4815/configenvy/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

環境変数の不足、古い記述、ドキュメント漏れ、危険なサンプル値を、セットアップでつまずく前に見つけます。

`configenvy` は、環境変数の情報が散らばりやすい場所をまとめて確認するCLIです。`.env.example`、ソースコード、README/docs、Docker Compose、GitHub Actions、デプロイ設定を照合し、「このプロジェクトを動かすには何を設定すればよいか」を明確にします。

![configenvy の仕組み](docs/assets/configenvy-flow-ja.svg)

```powershell
npx configenvy@latest doctor
```

環境変数の不足は、実行して初めて気づくことがよくあります。

```text
Error: DATABASE_URL is required
```

`configenvy` を使うと、必要な設定の抜け漏れを事前に確認できます。

```text
FAIL missing-example DATABASE_URL
  DATABASE_URL is used by code or required by config but is missing from .env.example files.
WARN undocumented STRIPE_WEBHOOK_SECRET
  STRIPE_WEBHOOK_SECRET is not mentioned in README or docs.
```

## Features

- `process.env.NAME`、`process.env["NAME"]`、`import.meta.env.NAME`、`Deno.env.get("NAME")` で参照されている環境変数を検出します。
- コード内の利用状況と `.env.example`、`.env.sample`、`.env.template` を比較します。
- 重要な環境変数が README や docs に書かれているか確認します。
- 実在しそうなトークン、秘密値、本番URLなど、サンプルとして危険な値を検出します。
- `.env.example` のコメントを、生成テーブルの説明文として使えます。
- README に貼り付けやすい Markdown 表を生成します。
- 人が読むための通常出力と、CI やスクリプト向けの JSON 出力に対応します。

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
configenvy doctor --strict [path]
configenvy check --ci [path]
configenvy init [path]
configenvy table [path] --out README.env.md
configenvy explain DATABASE_URL [path]
```

## What configenvy checks

- envサンプル: `.env.example`、`.env.sample`、`.env.template`
- ソースコード: `src/**/*.{js,jsx,ts,tsx,mjs,cjs}`
- ドキュメント: `README.md` と設定された docs パス
- CI と実行設定: `.github/workflows/*.yml`、Docker Compose、`vercel.json`
- `node_modules`、`dist`、`build`、`coverage`、`.next`、`.turbo`、`.vercel`、`.cache`、`out` などの生成物・キャッシュ用ディレクトリはデフォルトでスキップします。

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

## Config

設定ファイルなしでも使えます。必須変数を明示したい場合や、ノイズになる変数を無視したい場合は、プロジェクトルートに `configenvy.config.json` を置きます。

```json
{
  "required": ["DATABASE_URL"],
  "optional": ["LOG_LEVEL"],
  "ignore": ["NODE_ENV"],
  "docs": ["README.md", "docs"]
}
```

- `required`: 必ず存在してほしい環境変数
- `optional`: 使ってよいが必須ではない環境変数
- `ignore`: チェック対象から外す環境変数
- `docs`: 説明を探す README や docs のパス

セットアップ失敗の多くは、そこまで謎ではありません。コードに変数を追加したのに `.env.example` に書き忘れた。README の表が古くなった。サンプルにトークンっぽい値が入った。`configenvy` は、その小さな契約を崩れにくくします。

## Limitations

v0.1 の `configenvy` は軽量な静的抽出を使っています。すべての言語やフレームワークを完全に解析するわけではなく、`process.env[prefix + "_TOKEN"]` のような動的な名前は見逃すことがあります。目的は、よくあるセットアップ破綻を早めに見つけることです。完全な secrets scanner や型対応の compiler plugin を置き換えるものではありません。

## Roadmap

- PRコメント用の GitHub Action
- code scanning ツール向けの SARIF 出力
- Next.js、Vite、Remix、Docker中心のプロジェクト向けプリセット
- false positive や見逃しを減らす、より深い AST 解析
- env docs を編集しながら確認できる VS Code 拡張

## Privacy and safety

`configenvy` は、デフォルトで `.env` と example ではない `.env.*` ファイルを読みません。ローカルで実行され、ファイルをアップロードしたり外部APIを呼び出したりしません。
