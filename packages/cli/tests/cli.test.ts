import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveOutputPath, runCli, updateMarkdownTableBlock, type CliDependencies } from "../src/index";

class ExitSignal extends Error {
  constructor(readonly code: number) {
    super(`Exited with code ${code}`);
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const cliPackagePath = join(here, "..", "package.json");
const corePackagePath = join(here, "..", "..", "core", "package.json");

function createDependencies(overrides: Partial<CliDependencies> = {}): CliDependencies {
  return {
    buildMarkdownTable: () => "| Variable | .env example | Code | Docs | CI/config | Issues |",
    error: () => {},
    exit: (code: number) => {
      throw new ExitSignal(code);
    },
    explainVariable: () => "DATABASE_URL\n- code: src/index.ts:1",
    log: () => {},
    readFile: async () => "",
    resolvePath: resolve,
    scanProject: async () => ({
      diagnostics: [],
      references: [],
      rootDir: resolve("."),
      variables: []
    }),
    toJson: () => "{\"ok\":true}",
    toSarif: () => "{\"version\":\"2.1.0\"}",
    writeFile: async () => {},
    ...overrides
  };
}

async function invokeCli(argv: string[], overrides: Partial<CliDependencies> = {}) {
  const logs: string[] = [];
  const errors: string[] = [];
  const reads: string[] = [];
  const writes: Array<{ path: string; content: string }> = [];
  const scanCalls: Array<{ rootDir: string; strict?: boolean }> = [];

  const dependencies = createDependencies({
    log: (...values: unknown[]) => {
      logs.push(values.join(" "));
    },
    error: (...values: unknown[]) => {
      errors.push(values.join(" "));
    },
    scanProject: async (options) => {
      scanCalls.push(options);
      return {
        diagnostics: [],
        references: [],
        rootDir: options.rootDir,
        variables: []
      };
    },
    readFile: async (path) => {
      reads.push(String(path));
      if (!String(path).endsWith("README.md")) {
        const error = new Error("not found") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      return [
        "# README",
        "",
        "<!-- configenvy:start -->",
        "old table",
        "<!-- configenvy:end -->",
        ""
      ].join("\n");
    },
    writeFile: async (path, content) => {
      writes.push({ path: String(path), content: String(content) });
    },
    ...overrides
  });

  let exitCode: number | null = null;
  try {
    await runCli(["node", "configenvy", ...argv], dependencies);
  } catch (error) {
    if (error instanceof ExitSignal) {
      exitCode = error.code;
    } else {
      throw error;
    }
  }

  return { errors, exitCode, logs, reads, scanCalls, writes };
}

describe("configenvy cli", () => {
  it("keeps publish metadata aligned with the scoped core package", async () => {
    const cliPackage = JSON.parse(await readFile(cliPackagePath, "utf8")) as {
      bin: Record<string, string>;
      dependencies: Record<string, string>;
      name: string;
      version: string;
    };
    const corePackage = JSON.parse(await readFile(corePackagePath, "utf8")) as {
      version: string;
    };

    expect(cliPackage.name).toBe("configenvy");
    expect(cliPackage.bin.configenvy).toBe("dist/index.js");
    expect(cliPackage.dependencies["@configenvy/core"]).toBe(corePackage.version);
    expect(cliPackage.version).toBe(corePackage.version);
  });

  it("renders a PASS report for doctor without exiting on clean results", async () => {
    const outcome = await invokeCli(["doctor", "examples/nextjs"]);

    expect(outcome.exitCode).toBeNull();
    expect(outcome.logs).toContain("PASS configenvy found no environment variable issues.");
    expect(outcome.scanCalls).toEqual([{ rootDir: resolve("examples/nextjs"), strict: false }]);
  });

  it("treats warnings as failures for check --ci", async () => {
    const scanCalls: Array<{ rootDir: string; strict?: boolean }> = [];
    const outcome = await invokeCli(["check", "--ci", "examples/broken"], {
      scanProject: async (options) => {
        scanCalls.push(options);
        return {
          diagnostics: [
            {
              code: "undocumented",
              files: ["README.md"],
              message: "DATABASE_URL is not mentioned in README or docs.",
              severity: "warning",
              variable: "DATABASE_URL"
            }
          ],
          references: [],
          rootDir: options.rootDir,
          variables: ["DATABASE_URL"]
        };
      }
    });

    expect(outcome.exitCode).toBe(2);
    expect(outcome.logs).toContain("WARN undocumented DATABASE_URL");
    expect(outcome.logs).toContain(
      "::warning file=README.md,title=undocumented DATABASE_URL::DATABASE_URL is not mentioned in README or docs."
    );
    expect(scanCalls).toEqual([{ rootDir: resolve("examples/broken"), strict: true }]);
  });

  it("escapes GitHub Actions annotations for check --ci", async () => {
    const outcome = await invokeCli(["check", "--ci", "examples/broken"], {
      scanProject: async (options) => ({
        diagnostics: [
          {
            code: "missing-example",
            files: ["src/app,server.ts"],
            message: "DATABASE_URL includes 100% of bad\nnews",
            severity: "error",
            variable: "DATABASE_URL"
          }
        ],
        references: [],
        rootDir: options.rootDir,
        variables: ["DATABASE_URL"]
      })
    });

    expect(outcome.exitCode).toBe(2);
    expect(outcome.logs).toContain(
      "::error file=src/app%2Cserver.ts,title=missing-example DATABASE_URL::DATABASE_URL includes 100%25 of bad%0Anews"
    );
  });

  it("keeps json output clean for check --ci --format json", async () => {
    const outcome = await invokeCli(["check", "--ci", "--format", "json", "examples/broken"], {
      scanProject: async (options) => ({
        diagnostics: [
          {
            code: "undocumented",
            files: ["README.md"],
            message: "DATABASE_URL is not mentioned in README or docs.",
            severity: "warning",
            variable: "DATABASE_URL"
          }
        ],
        references: [],
        rootDir: options.rootDir,
        variables: ["DATABASE_URL"]
      })
    });

    expect(outcome.exitCode).toBe(2);
    expect(outcome.logs).toEqual(["{\"ok\":true}"]);
  });

  it("keeps SARIF output clean for check --ci --format sarif", async () => {
    const outcome = await invokeCli(["check", "--ci", "--format", "sarif", "examples/broken"], {
      scanProject: async (options) => ({
        diagnostics: [
          {
            code: "missing-example",
            files: ["src/index.ts"],
            message: "DATABASE_URL is missing from .env.example files.",
            severity: "error",
            variable: "DATABASE_URL"
          }
        ],
        references: [],
        rootDir: options.rootDir,
        variables: ["DATABASE_URL"]
      }),
      toSarif: () => "{\"version\":\"2.1.0\",\"runs\":[]}"
    });

    expect(outcome.exitCode).toBe(2);
    expect(outcome.logs).toEqual(["{\"version\":\"2.1.0\",\"runs\":[]}"]);
  });

  it("writes markdown output for table --out", async () => {
    const outcome = await invokeCli(["table", "examples/nextjs", "--out", "README.env.md"], {
      buildMarkdownTable: () => "| Variable | .env example | Code | Docs | CI/config | Issues |\n| DATABASE_URL | yes | yes | yes | no | - |"
    });

    expect(outcome.exitCode).toBeNull();
    expect(outcome.scanCalls).toEqual([{ rootDir: resolve("examples/nextjs") }]);
    expect(outcome.writes).toEqual([
      {
        path: resolve("examples/nextjs", "README.env.md"),
        content: "| Variable | .env example | Code | Docs | CI/config | Issues |\n| DATABASE_URL | yes | yes | yes | no | - |\n"
      }
    ]);
  });

  it("updates a marked markdown table block", () => {
    const updated = updateMarkdownTableBlock(
      [
        "# README",
        "",
        "<!-- configenvy:start -->",
        "old table",
        "<!-- configenvy:end -->",
        "",
        "Keep me."
      ].join("\n"),
      "| Variable |",
      false
    );

    expect(updated).toBe([
      "# README",
      "",
      "<!-- configenvy:start -->",
      "| Variable |",
      "<!-- configenvy:end -->",
      "",
      "Keep me."
    ].join("\n"));
  });

  it("refuses to update markdown without markers unless forced", () => {
    expect(() => updateMarkdownTableBlock("# README\n", "| Variable |", false)).toThrow(
      "No configenvy table block found"
    );
  });

  it("prints updated markdown without writing for table --update --dry-run", async () => {
    const outcome = await invokeCli(["table", "examples/nextjs", "--update", "README.md", "--dry-run"], {
      buildMarkdownTable: () => "| Variable |\n| --- |\n| DATABASE_URL |"
    });

    expect(outcome.exitCode).toBeNull();
    expect(outcome.reads).toEqual([resolve("examples/nextjs", "README.md")]);
    expect(outcome.writes).toEqual([]);
    expect(outcome.logs).toEqual([
      [
        "# README",
        "",
        "<!-- configenvy:start -->",
        "| Variable |",
        "| --- |",
        "| DATABASE_URL |",
        "<!-- configenvy:end -->",
        ""
      ].join("\n")
    ]);
  });

  it("appends a marked markdown table block with table --update --force", async () => {
    const outcome = await invokeCli(["table", "examples/nextjs", "--update", "README.md", "--force"], {
      buildMarkdownTable: () => "| Variable |",
      readFile: async () => "# README\n"
    });

    expect(outcome.exitCode).toBeNull();
    expect(outcome.writes).toEqual([
      {
        path: resolve("examples/nextjs", "README.md"),
        content: [
          "# README",
          "",
          "<!-- configenvy:start -->",
          "| Variable |",
          "<!-- configenvy:end -->",
          ""
        ].join("\n")
      }
    ]);
  });

  it("creates a starter config file with init", async () => {
    const outcome = await invokeCli(["init", "examples/nextjs"], {
      scanProject: async (options) => ({
        diagnostics: [],
        references: [
          { file: "src/index.ts", kind: "code", line: 1, name: "DATABASE_URL" },
          { file: ".github/workflows/ci.yml", kind: "ci", line: 3, name: "VERCEL_TOKEN" },
          { file: "README.md", kind: "docs", line: 5, name: "DATABASE_URL" }
        ],
        rootDir: options.rootDir,
        variables: ["DATABASE_URL", "VERCEL_TOKEN"]
      })
    });

    expect(outcome.exitCode).toBeNull();
    expect(outcome.logs).toEqual([`Created ${resolve("examples/nextjs", "configenvy.config.json")}`]);
    expect(outcome.writes).toEqual([
      {
        path: resolve("examples/nextjs", "configenvy.config.json"),
        content: `${JSON.stringify({
          required: ["DATABASE_URL", "VERCEL_TOKEN"],
          optional: [],
          ignore: ["NODE_ENV"],
          docs: ["README.md", "docs"]
        }, null, 2)}\n`
      }
    ]);
  });

  it("can create a .env.example draft with init --env-example", async () => {
    const outcome = await invokeCli(["init", "examples/nextjs", "--env-example"], {
      scanProject: async (options) => ({
        diagnostics: [],
        references: [
          { file: ".env.example", kind: "example", line: 1, name: "DATABASE_URL" },
          { file: "src/index.ts", kind: "code", line: 1, name: "DATABASE_URL" },
          { file: "src/index.ts", kind: "code", line: 2, name: "STRIPE_SECRET_KEY" }
        ],
        rootDir: options.rootDir,
        variables: ["DATABASE_URL", "STRIPE_SECRET_KEY"]
      })
    });

    expect(outcome.exitCode).toBeNull();
    expect(outcome.writes).toEqual([
      {
        path: resolve("examples/nextjs", "configenvy.config.json"),
        content: `${JSON.stringify({
          required: ["DATABASE_URL", "STRIPE_SECRET_KEY"],
          optional: [],
          ignore: ["NODE_ENV"],
          docs: ["README.md", "docs"]
        }, null, 2)}\n`
      },
      {
        path: resolve("examples/nextjs", ".env.example"),
        content: "# Generated by configenvy init\nDATABASE_URL=\nSTRIPE_SECRET_KEY=\n"
      }
    ]);
  });

  it("checks all init targets before writing files", async () => {
    const outcome = await invokeCli(["init", "examples/nextjs", "--env-example"], {
      readFile: async (path) => {
        if (String(path).endsWith(".env.example")) {
          return "DATABASE_URL=\n";
        }
        const error = new Error("not found") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
    });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.writes).toEqual([]);
    expect(outcome.errors).toEqual([
      `${resolve("examples/nextjs", ".env.example")} already exists. Re-run with --force to overwrite.`
    ]);
  });

  it("preserves existing .env.example values with init --env-example --force", async () => {
    const outcome = await invokeCli(["init", "examples/nextjs", "--env-example", "--force"], {
      readFile: async (path) => {
        if (String(path).endsWith(".env.example")) {
          return "# Existing example\nDATABASE_URL=postgres://localhost/app\n";
        }
        const error = new Error("not found") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      },
      scanProject: async (options) => ({
        diagnostics: [],
        references: [
          { file: ".env.example", kind: "example", line: 2, name: "DATABASE_URL" },
          { file: "src/index.ts", kind: "code", line: 1, name: "DATABASE_URL" },
          { file: "src/index.ts", kind: "code", line: 2, name: "STRIPE_SECRET_KEY" }
        ],
        rootDir: options.rootDir,
        variables: ["DATABASE_URL", "STRIPE_SECRET_KEY"]
      })
    });

    expect(outcome.exitCode).toBeNull();
    expect(outcome.writes[1]).toEqual({
      path: resolve("examples/nextjs", ".env.example"),
      content: [
        "# Existing example",
        "DATABASE_URL=postgres://localhost/app",
        "# Added by configenvy init",
        "STRIPE_SECRET_KEY=",
        ""
      ].join("\n")
    });
  });

  it("prints planned init files without writing for init --dry-run", async () => {
    const outcome = await invokeCli(["init", "examples/nextjs", "--env-example", "--dry-run"]);

    expect(outcome.exitCode).toBeNull();
    expect(outcome.writes).toEqual([]);
    expect(outcome.logs[0]).toBe(`Would write ${resolve("examples/nextjs", "configenvy.config.json")}`);
    expect(outcome.logs[2]).toBe(`Would write ${resolve("examples/nextjs", ".env.example")}`);
  });

  it("does not overwrite an existing config file with init", async () => {
    const outcome = await invokeCli(["init", "examples/nextjs"], {
      writeFile: async () => {
        const error = new Error("file exists") as NodeJS.ErrnoException;
        error.code = "EEXIST";
        throw error;
      }
    });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.errors).toEqual([
      `${resolve("examples/nextjs", "configenvy.config.json")} already exists. Re-run with --force to overwrite.`
    ]);
  });

  it("preserves absolute paths for table --out", () => {
    const outputPath = resolve("C:\\tmp", "README.env.md");
    expect(resolveOutputPath(resolve("examples/nextjs"), outputPath)).toBe(outputPath);
  });

  it("prints explain output for a variable", async () => {
    const outcome = await invokeCli(["explain", "DATABASE_URL", "examples/nextjs"]);

    expect(outcome.exitCode).toBeNull();
    expect(outcome.logs).toEqual(["DATABASE_URL\n- code: src/index.ts:1"]);
  });
});
