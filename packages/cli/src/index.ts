#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import { buildMarkdownTable, explainVariable, scanProject, toJson, toSarif, type Diagnostic } from "@configenvy/core";

type DoctorOptions = {
  format?: "text" | "json" | "sarif";
  strict?: boolean;
  ci?: boolean;
};

export type CliDependencies = {
  buildMarkdownTable: typeof buildMarkdownTable;
  error: (...values: unknown[]) => void;
  exit: (code: number) => never | void;
  explainVariable: typeof explainVariable;
  log: (...values: unknown[]) => void;
  resolvePath: typeof resolve;
  scanProject: typeof scanProject;
  toJson: typeof toJson;
  toSarif: typeof toSarif;
  writeFile: typeof writeFile;
};

const defaultDependencies: CliDependencies = {
  buildMarkdownTable,
  error: console.error,
  exit: process.exit,
  explainVariable,
  log: console.log,
  resolvePath: resolve,
  scanProject,
  toJson,
  toSarif,
  writeFile
};

export function createProgram(dependencies: CliDependencies = defaultDependencies): Command {
  const program = new Command();

  program
    .name("configenvy")
    .description("Find missing, unused, undocumented, and risky environment variables.")
    .version("0.1.4");

  program
    .command("doctor")
    .argument("[path]", "project directory", ".")
    .option("--format <format>", "output format: text, json, or sarif", "text")
    .option("--strict", "treat documentation warnings as errors")
    .action(async (projectPath: string, options: DoctorOptions) => {
      await runDoctor(projectPath, options, dependencies);
    });

  program
    .command("check")
    .argument("[path]", "project directory", ".")
    .option("--ci", "fail on warnings and errors")
    .option("--format <format>", "output format: text, json, or sarif", "text")
    .action(async (projectPath: string, options: DoctorOptions) => {
      await runDoctor(projectPath, { ...options, strict: Boolean(options.ci), ci: Boolean(options.ci) }, dependencies);
    });

  program
    .command("table")
    .argument("[path]", "project directory", ".")
    .option("--out <file>", "write markdown table to a file")
    .action(async (projectPath: string, options: { out?: string }) => {
      const rootDir = dependencies.resolvePath(projectPath);
      const result = await dependencies.scanProject({ rootDir });
      const table = dependencies.buildMarkdownTable(result);
      if (options.out) {
        await dependencies.writeFile(resolveOutputPath(rootDir, options.out, dependencies.resolvePath), `${table}\n`, "utf8");
      } else {
        dependencies.log(table);
      }
    });

  program
    .command("init")
    .argument("[path]", "project directory", ".")
    .description("create a starter configenvy.config.json file")
    .action(async (projectPath: string) => {
      await runInit(projectPath, dependencies);
    });

  program
    .command("explain")
    .argument("<variable>", "environment variable name")
    .argument("[path]", "project directory", ".")
    .action(async (variable: string, projectPath: string) => {
      const result = await dependencies.scanProject({ rootDir: dependencies.resolvePath(projectPath) });
      dependencies.log(dependencies.explainVariable(result, variable));
    });

  return program;
}

const starterConfig = {
  required: [],
  optional: [],
  ignore: ["NODE_ENV"],
  docs: ["README.md", "docs"]
};

export async function runCli(argv: string[], dependencies: CliDependencies = defaultDependencies): Promise<void> {
  const program = createProgram(dependencies);
  await program.parseAsync(argv);
}

export async function runDoctor(
  projectPath: string,
  options: DoctorOptions,
  dependencies: CliDependencies = defaultDependencies
): Promise<void> {
  const result = await dependencies.scanProject({
    rootDir: dependencies.resolvePath(projectPath),
    strict: Boolean(options.strict)
  });

  if (options.format === "json") {
    dependencies.log(dependencies.toJson(result));
  } else if (options.format === "sarif") {
    dependencies.log(dependencies.toSarif(result));
  } else {
    printHumanReport(result.diagnostics, dependencies.log);
    if (options.ci) {
      printGitHubAnnotations(result.diagnostics, dependencies.log);
    }
  }

  const hasError = result.diagnostics.some((diagnostic) => diagnostic.severity === "error");
  const hasWarning = result.diagnostics.some((diagnostic) => diagnostic.severity === "warning");
  if (hasError || (options.ci && hasWarning)) dependencies.exit(2);
  if (hasWarning) dependencies.exit(1);
}

export async function runInit(
  projectPath: string,
  dependencies: CliDependencies = defaultDependencies
): Promise<void> {
  const rootDir = dependencies.resolvePath(projectPath);
  const configPath = dependencies.resolvePath(rootDir, "configenvy.config.json");
  const content = `${JSON.stringify(starterConfig, null, 2)}\n`;

  try {
    await dependencies.writeFile(configPath, content, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      dependencies.error("configenvy.config.json already exists.");
      dependencies.exit(1);
      return;
    }
    throw error;
  }

  dependencies.log(`Created ${configPath}`);
}

export function resolveOutputPath(
  projectPath: string,
  outputPath: string,
  resolvePath: typeof resolve = resolve
): string {
  if (isAbsolute(outputPath)) return outputPath;
  return resolvePath(projectPath, outputPath);
}

export function printHumanReport(
  diagnostics: Diagnostic[],
  log: (...values: unknown[]) => void = defaultDependencies.log
): void {
  if (diagnostics.length === 0) {
    log("PASS configenvy found no environment variable issues.");
    return;
  }

  for (const diagnostic of diagnostics) {
    const label = diagnostic.severity === "error" ? "FAIL" : "WARN";
    log(`${label} ${diagnostic.code} ${diagnostic.variable}`);
    log(`  ${diagnostic.message}`);
    if (diagnostic.files.length > 0) {
      log(`  files: ${diagnostic.files.join(", ")}`);
    }
  }

  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warnings = diagnostics.length - errors;
  log(`Summary: ${errors} error(s), ${warnings} warning(s).`);
}

export function printGitHubAnnotations(
  diagnostics: Diagnostic[],
  log: (...values: unknown[]) => void = defaultDependencies.log
): void {
  for (const diagnostic of diagnostics) {
    const command = diagnostic.severity === "error" ? "error" : "warning";
    const properties = [
      diagnostic.files[0] ? `file=${escapeAnnotationProperty(diagnostic.files[0])}` : undefined,
      `title=${escapeAnnotationProperty(`${diagnostic.code} ${diagnostic.variable}`)}`
    ].filter(Boolean);

    log(`::${command} ${properties.join(",")}::${escapeAnnotationMessage(diagnostic.message)}`);
  }
}

function escapeAnnotationProperty(value: string): string {
  return escapeAnnotationMessage(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

function escapeAnnotationMessage(value: string): string {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  runCli(process.argv).catch((error: unknown) => {
    defaultDependencies.error(error instanceof Error ? error.message : String(error));
    defaultDependencies.exit(3);
  });
}
