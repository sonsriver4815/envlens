#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import { buildMarkdownTable, explainVariable, scanProject, toJson, type Diagnostic } from "@configenvy/core";

type DoctorOptions = {
  format?: "text" | "json";
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
  writeFile
};

export function createProgram(dependencies: CliDependencies = defaultDependencies): Command {
  const program = new Command();

  program
    .name("configenvy")
    .description("Find missing, unused, undocumented, and risky environment variables.")
    .version("0.1.2");

  program
    .command("doctor")
    .argument("[path]", "project directory", ".")
    .option("--format <format>", "output format: text or json", "text")
    .option("--strict", "treat documentation warnings as errors")
    .action(async (projectPath: string, options: DoctorOptions) => {
      await runDoctor(projectPath, options, dependencies);
    });

  program
    .command("check")
    .argument("[path]", "project directory", ".")
    .option("--ci", "fail on warnings and errors")
    .option("--format <format>", "output format: text or json", "text")
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
    .command("explain")
    .argument("<variable>", "environment variable name")
    .argument("[path]", "project directory", ".")
    .action(async (variable: string, projectPath: string) => {
      const result = await dependencies.scanProject({ rootDir: dependencies.resolvePath(projectPath) });
      dependencies.log(dependencies.explainVariable(result, variable));
    });

  return program;
}

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
  } else {
    printHumanReport(result.diagnostics, dependencies.log);
  }

  const hasError = result.diagnostics.some((diagnostic) => diagnostic.severity === "error");
  const hasWarning = result.diagnostics.some((diagnostic) => diagnostic.severity === "warning");
  if (hasError || (options.ci && hasWarning)) dependencies.exit(2);
  if (hasWarning) dependencies.exit(1);
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

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  runCli(process.argv).catch((error: unknown) => {
    defaultDependencies.error(error instanceof Error ? error.message : String(error));
    defaultDependencies.exit(3);
  });
}
