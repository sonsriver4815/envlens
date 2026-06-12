import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { buildMarkdownTable, explainVariable, scanProject, toSarif } from "../src/index";

async function fixture(files: Record<string, string>): Promise<string> {
  const root = join(tmpdir(), `configenvy-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  for (const [name, content] of Object.entries(files)) {
    const fullPath = join(root, name);
    await mkdir(join(fullPath, ".."), { recursive: true });
    await writeFile(fullPath, content, "utf8");
  }
  return root;
}

describe("configenvy core", () => {
  it("finds missing examples and docs", async () => {
    const root = await fixture({
      "src/index.ts": "console.log(process.env.DATABASE_URL)",
      ".env.example": "APP_URL=http://localhost:3000\n",
      "README.md": "Set APP_URL before running."
    });

    const result = await scanProject({ rootDir: root });

    expect(result.diagnostics.map((item) => item.code)).toContain("missing-example");
    expect(result.diagnostics.map((item) => item.code)).toContain("undocumented");
  });

  it("detects dangerous defaults", async () => {
    const root = await fixture({
      ".env.example": "OPENAI_API_KEY=sk-realisticlookingsecretvalue123456\n",
      "README.md": "OPENAI_API_KEY is required."
    });

    const result = await scanProject({ rootDir: root });

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "dangerous-default",
      variable: "OPENAI_API_KEY"
    }));
  });

  it("builds markdown tables and explanations", async () => {
    const root = await fixture({
      "src/index.ts": "console.log(import.meta.env.VITE_PUBLIC_URL)",
      ".env.example": "VITE_PUBLIC_URL=http://localhost:5173\n",
      "README.md": "VITE_PUBLIC_URL controls the public origin."
    });

    const result = await scanProject({ rootDir: root });
    const table = buildMarkdownTable(result);
    const explanation = explainVariable(result, "VITE_PUBLIC_URL");

    expect(table).toContain("| VITE_PUBLIC_URL | yes | yes | yes | no | - | - |");
    expect(explanation).toContain("src/index.ts:1");
  });

  it("extracts env references from JS and TS AST patterns", async () => {
    const root = await fixture({
      "src/index.ts": [
        "const { DATABASE_URL, STRIPE_SECRET_KEY: stripeKey } = process.env;",
        "console.log(process.env.API_BASE_URL);",
        "console.log(process.env['CACHE_URL']);",
        "console.log(import.meta.env.VITE_PUBLIC_URL);",
        "console.log(Deno.env.get('DENO_TOKEN'));"
      ].join("\n"),
      ".env.example": [
        "DATABASE_URL=postgres://user:pass@localhost:5432/app",
        "STRIPE_SECRET_KEY=replace-me",
        "API_BASE_URL=http://localhost:3000",
        "CACHE_URL=redis://localhost:6379",
        "VITE_PUBLIC_URL=http://localhost:5173",
        "DENO_TOKEN=replace-me"
      ].join("\n"),
      "README.md": "DATABASE_URL STRIPE_SECRET_KEY API_BASE_URL CACHE_URL VITE_PUBLIC_URL DENO_TOKEN"
    });

    const result = await scanProject({ rootDir: root });
    const codeVariables = result.references.filter((reference) => reference.kind === "code").map((reference) => reference.name);

    expect(codeVariables).toEqual([
      "DATABASE_URL",
      "STRIPE_SECRET_KEY",
      "API_BASE_URL",
      "CACHE_URL",
      "VITE_PUBLIC_URL",
      "DENO_TOKEN"
    ]);
  });

  it("reports dynamic env access without adding a fake variable", async () => {
    const root = await fixture({
      "src/index.ts": [
        "console.log(process.env[prefix + '_TOKEN']);",
        "console.log(Deno.env.get(runtimeName));"
      ].join("\n"),
      ".env.example": "",
      "README.md": ""
    });

    const result = await scanProject({ rootDir: root });

    expect(result.variables).not.toContain("<dynamic-env>");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "dynamic-env",
      severity: "warning",
      variable: "dynamic env access",
      files: ["src/index.ts"]
    }));
  });

  it("builds SARIF output for diagnostics", async () => {
    const root = await fixture({
      "src/index.ts": "console.log(process.env.DATABASE_URL)",
      ".env.example": "APP_URL=http://localhost:3000\n",
      "README.md": "Set APP_URL before running."
    });

    const result = await scanProject({ rootDir: root });
    const sarif = JSON.parse(toSarif(result)) as {
      version: string;
      runs: Array<{
        tool: { driver: { name: string; rules: Array<{ id: string }> } };
        results: Array<{
          ruleId: string;
          level: string;
          message: { text: string };
          locations?: Array<{ physicalLocation: { artifactLocation: { uri: string } } }>;
        }>;
      }>;
    };

    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0]?.tool.driver.name).toBe("configenvy");
    expect(sarif.runs[0]?.tool.driver.rules.map((rule) => rule.id)).toContain("missing-example");
    expect(sarif.runs[0]?.results).toContainEqual(expect.objectContaining({
      ruleId: "missing-example",
      level: "error",
      message: {
        text: "DATABASE_URL: DATABASE_URL is used by code or required by config but is missing from .env.example files."
      },
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: "src/index.ts"
            }
          }
        }
      ]
    }));
  });

  it("uses .env.example comments as variable descriptions", async () => {
    const root = await fixture({
      ".env.example": [
        "# Postgres connection string used by the app server",
        "DATABASE_URL=postgres://localhost:5432/app",
        "",
        "# Not attached after the blank line",
        "",
        "LOG_LEVEL= # Used for foo | bar",
        "CALLBACK_URL=https://example.test/path#anchor",
        "QUOTED_HASH=\"value # not a comment\""
      ].join("\n"),
      "README.md": "DATABASE_URL, LOG_LEVEL, CALLBACK_URL, and QUOTED_HASH are documented."
    });

    const result = await scanProject({ rootDir: root });
    const table = buildMarkdownTable(result);

    expect(result.references).toContainEqual(expect.objectContaining({
      name: "DATABASE_URL",
      description: "Postgres connection string used by the app server"
    }));
    expect(result.references).toContainEqual(expect.objectContaining({
      name: "LOG_LEVEL",
      description: "Used for foo | bar"
    }));
    expect(result.references.find((reference) => reference.name === "CALLBACK_URL")?.value).toBe(
      "https://example.test/path#anchor"
    );
    expect(result.references.find((reference) => reference.name === "QUOTED_HASH")?.value).toBe("value # not a comment");
    expect(result.references.find((reference) => reference.name === "LOG_LEVEL")?.description).toBe("Used for foo | bar");
    expect(result.references.find((reference) => reference.name === "CALLBACK_URL")?.description).toBeUndefined();
    expect(table).toContain(
      "| DATABASE_URL | yes | no | yes | no | Postgres connection string used by the app server | unused-example |"
    );
    expect(table).toContain("| LOG_LEVEL | yes | no | yes | no | Used for foo \\| bar | unused-example |");
  });

  it("skips generated js when a ts sibling exists", async () => {
    const root = await fixture({
      "src/index.ts": "console.log(process.env.DATABASE_URL)",
      "src/index.js": "console.log(process.env.DATABASE_URL)",
      ".env.example": "DATABASE_URL=postgres://user:pass@localhost:5432/app\n",
      "README.md": "DATABASE_URL is required."
    });

    const result = await scanProject({ rootDir: root });
    const codeReferences = result.references.filter((reference) => reference.kind === "code");

    expect(codeReferences).toHaveLength(1);
    expect(codeReferences[0]?.file).toBe("src/index.ts");
  });

  it("skips generated and cache directories", async () => {
    const root = await fixture({
      "src/index.ts": "console.log(process.env.DATABASE_URL)",
      "build/index.js": "console.log(process.env.BUILD_ONLY_SECRET)",
      "coverage/report.js": "console.log(process.env.COVERAGE_ONLY_SECRET)",
      ".next/server/app.js": "console.log(process.env.NEXT_ONLY_SECRET)",
      ".turbo/cache.js": "console.log(process.env.TURBO_ONLY_SECRET)",
      ".vercel/output/config.js": "console.log(process.env.VERCEL_ONLY_SECRET)",
      ".cache/output.js": "console.log(process.env.CACHE_ONLY_SECRET)",
      "out/index.js": "console.log(process.env.OUT_ONLY_SECRET)",
      ".env.example": "DATABASE_URL=postgres://user:pass@localhost:5432/app\n",
      "README.md": "DATABASE_URL is required."
    });

    const result = await scanProject({ rootDir: root });

    expect(result.variables).toContain("DATABASE_URL");
    expect(result.variables).not.toContain("BUILD_ONLY_SECRET");
    expect(result.variables).not.toContain("COVERAGE_ONLY_SECRET");
    expect(result.variables).not.toContain("NEXT_ONLY_SECRET");
    expect(result.variables).not.toContain("TURBO_ONLY_SECRET");
    expect(result.variables).not.toContain("VERCEL_ONLY_SECRET");
    expect(result.variables).not.toContain("CACHE_ONLY_SECRET");
    expect(result.variables).not.toContain("OUT_ONLY_SECRET");
  });

  it("skips files larger than the scanner size limit", async () => {
    const root = await fixture({
      "src/index.ts": "console.log(process.env.DATABASE_URL)",
      "src/large.ts": `${"x".repeat(1024 * 1024 + 1)}\nconsole.log(process.env.LARGE_ONLY_SECRET)`,
      ".env.example": "DATABASE_URL=postgres://user:pass@localhost:5432/app\n",
      "README.md": "DATABASE_URL is required."
    });

    const result = await scanProject({ rootDir: root });

    expect(result.variables).toContain("DATABASE_URL");
    expect(result.variables).not.toContain("LARGE_ONLY_SECRET");
  });

  it("skips test and fixture directories", async () => {
    const root = await fixture({
      "src/index.ts": "console.log(process.env.DATABASE_URL)",
      "tests/core.test.ts": "expect(process.env.TEST_ONLY_SECRET).toBeDefined()",
      "test/helper.ts": "console.log(process.env.TEST_HELPER_SECRET)",
      "__tests__/app.test.ts": "console.log(process.env.JEST_ONLY_SECRET)",
      "__mocks__/env.ts": "console.log(process.env.MOCK_ONLY_SECRET)",
      "fixtures/app.ts": "console.log(process.env.FIXTURE_ONLY_SECRET)",
      ".env.example": "DATABASE_URL=postgres://user:pass@localhost:5432/app\n",
      "README.md": "DATABASE_URL is required."
    });

    const result = await scanProject({ rootDir: root });

    expect(result.variables).toContain("DATABASE_URL");
    expect(result.variables).not.toContain("TEST_ONLY_SECRET");
    expect(result.variables).not.toContain("TEST_HELPER_SECRET");
    expect(result.variables).not.toContain("JEST_ONLY_SECRET");
    expect(result.variables).not.toContain("MOCK_ONLY_SECRET");
    expect(result.variables).not.toContain("FIXTURE_ONLY_SECRET");
  });

  it("does not treat common documentation acronyms as variables", async () => {
    const root = await fixture({
      ".env.example": "APP_URL=http://localhost:3000\n",
      "README.md": "APP_URL is the public URL for the HTTP API."
    });

    const result = await scanProject({ rootDir: root });

    expect(result.variables).toContain("APP_URL");
    expect(result.variables).not.toContain("URL");
    expect(result.variables).not.toContain("HTTP");
    expect(result.variables).not.toContain("API");
  });

  it("does not treat NODE_AUTH_TOKEN as a contributor-provided secret", async () => {
    const root = await fixture({
      ".env.example": "NPM_TOKEN=replace-me\n",
      "README.md": "NPM_TOKEN is required for publishing.",
      ".github/workflows/release.yml": "env:\n  NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}\n"
    });

    const result = await scanProject({ rootDir: root });

    expect(result.variables).toContain("NPM_TOKEN");
    expect(result.variables).not.toContain("NODE_AUTH_TOKEN");
    expect(result.diagnostics).toHaveLength(0);
  });

  it("fails loudly for invalid config", async () => {
    const root = await fixture({
      "configenvy.config.json": "{ invalid",
      ".env.example": "APP_URL=http://localhost:3000\n"
    });

    await expect(scanProject({ rootDir: root })).rejects.toThrow("Failed to read configenvy.config.json");
  });

  it("does not mark configured optional variables as unused", async () => {
    const root = await fixture({
      "configenvy.config.json": JSON.stringify({ optional: ["LOG_LEVEL"] }),
      ".env.example": "LOG_LEVEL=info\n",
      "README.md": "LOG_LEVEL controls logging verbosity."
    });

    const result = await scanProject({ rootDir: root });

    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({
      code: "unused-example",
      variable: "LOG_LEVEL"
    }));
  });

  it("detects non-http remote database URLs as dangerous defaults", async () => {
    const root = await fixture({
      ".env.example": "DATABASE_URL=postgres://user:pass@db.production.internal:5432/app\n",
      "README.md": "DATABASE_URL is required."
    });

    const result = await scanProject({ rootDir: root });

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "dangerous-default",
      variable: "DATABASE_URL"
    }));
  });
});
