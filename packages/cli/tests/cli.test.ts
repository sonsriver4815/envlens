import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveOutputPath, runCli, type CliDependencies } from "../src/index";

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
    resolvePath: resolve,
    scanProject: async () => ({
      diagnostics: [],
      references: [],
      rootDir: resolve("."),
      variables: []
    }),
    toJson: () => "{\"ok\":true}",
    writeFile: async () => {},
    ...overrides
  };
}

async function invokeCli(argv: string[], overrides: Partial<CliDependencies> = {}) {
  const logs: string[] = [];
  const errors: string[] = [];
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

  return { errors, exitCode, logs, scanCalls, writes };
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
    expect(scanCalls).toEqual([{ rootDir: resolve("examples/broken"), strict: true }]);
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

  it("creates a starter config file with init", async () => {
    const outcome = await invokeCli(["init", "examples/nextjs"]);

    expect(outcome.exitCode).toBeNull();
    expect(outcome.logs).toEqual([`Created ${resolve("examples/nextjs", "configenvy.config.json")}`]);
    expect(outcome.writes).toEqual([
      {
        path: resolve("examples/nextjs", "configenvy.config.json"),
        content: `${JSON.stringify({
          required: [],
          optional: [],
          ignore: ["NODE_ENV"],
          docs: ["README.md", "docs"]
        }, null, 2)}\n`
      }
    ]);
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
    expect(outcome.errors).toEqual(["configenvy.config.json already exists."]);
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
