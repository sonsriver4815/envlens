import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { buildMarkdownTable, explainVariable, scanProject } from "../src/index";

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

  it("uses .env.example comments as variable descriptions", async () => {
    const root = await fixture({
      ".env.example": [
        "# Postgres connection string used by the app server",
        "DATABASE_URL=postgres://localhost:5432/app",
        "",
        "# Not attached after the blank line",
        "",
        "LOG_LEVEL= # Logging verbosity",
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
      description: "Logging verbosity"
    }));
    expect(result.references.find((reference) => reference.name === "CALLBACK_URL")?.value).toBe(
      "https://example.test/path#anchor"
    );
    expect(result.references.find((reference) => reference.name === "QUOTED_HASH")?.value).toBe("value # not a comment");
    expect(result.references.find((reference) => reference.name === "LOG_LEVEL")?.description).toBe("Logging verbosity");
    expect(result.references.find((reference) => reference.name === "CALLBACK_URL")?.description).toBeUndefined();
    expect(table).toContain(
      "| DATABASE_URL | yes | no | yes | no | Postgres connection string used by the app server | unused-example |"
    );
    expect(table).toContain("| LOG_LEVEL | yes | no | yes | no | Logging verbosity | unused-example |");
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
