#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Command } from "commander";
import { buildMarkdownTable, explainVariable, scanProject, toJson, type Diagnostic } from "@configenvy/core";

type DoctorOptions = {
  format?: "text" | "json";
  strict?: boolean;
  ci?: boolean;
};

const program = new Command();

program
  .name("configenvy")
  .description("Find missing, unused, undocumented, and risky environment variables.")
  .version("0.1.1");

program
  .command("doctor")
  .argument("[path]", "project directory", ".")
  .option("--format <format>", "output format: text or json", "text")
  .option("--strict", "treat documentation warnings as errors")
  .action(async (projectPath: string, options: DoctorOptions) => {
    await runDoctor(projectPath, options);
  });

program
  .command("check")
  .argument("[path]", "project directory", ".")
  .option("--ci", "fail on warnings and errors")
  .option("--format <format>", "output format: text or json", "text")
  .action(async (projectPath: string, options: DoctorOptions) => {
    await runDoctor(projectPath, { ...options, strict: Boolean(options.ci), ci: Boolean(options.ci) });
  });

program
  .command("table")
  .argument("[path]", "project directory", ".")
  .option("--out <file>", "write markdown table to a file")
  .action(async (projectPath: string, options: { out?: string }) => {
    const result = await scanProject({ rootDir: resolve(projectPath) });
    const table = buildMarkdownTable(result);
    if (options.out) {
      await writeFile(resolve(options.out), `${table}\n`, "utf8");
    } else {
      console.log(table);
    }
  });

program
  .command("explain")
  .argument("<variable>", "environment variable name")
  .argument("[path]", "project directory", ".")
  .action(async (variable: string, projectPath: string) => {
    const result = await scanProject({ rootDir: resolve(projectPath) });
    console.log(explainVariable(result, variable));
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(3);
});

async function runDoctor(projectPath: string, options: DoctorOptions): Promise<void> {
  const result = await scanProject({ rootDir: resolve(projectPath), strict: Boolean(options.strict) });

  if (options.format === "json") {
    console.log(toJson(result));
  } else {
    printHumanReport(result.diagnostics);
  }

  const hasError = result.diagnostics.some((diagnostic) => diagnostic.severity === "error");
  const hasWarning = result.diagnostics.some((diagnostic) => diagnostic.severity === "warning");
  if (hasError || (options.ci && hasWarning)) process.exit(2);
  if (hasWarning) process.exit(1);
}

function printHumanReport(diagnostics: Diagnostic[]): void {
  if (diagnostics.length === 0) {
    console.log("PASS configenvy found no environment variable issues.");
    return;
  }

  for (const diagnostic of diagnostics) {
    const label = diagnostic.severity === "error" ? "FAIL" : "WARN";
    console.log(`${label} ${diagnostic.code} ${diagnostic.variable}`);
    console.log(`  ${diagnostic.message}`);
    if (diagnostic.files.length > 0) {
      console.log(`  files: ${diagnostic.files.join(", ")}`);
    }
  }

  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warnings = diagnostics.length - errors;
  console.log(`Summary: ${errors} error(s), ${warnings} warning(s).`);
}
