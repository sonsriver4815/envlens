#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import {
  buildMarkdownTable,
  explainVariable,
  scanProject,
  toJson,
  toSarif,
  type Diagnostic,
  type ScanResult
} from "@configenvy/core";

type DoctorOptions = {
  format?: "text" | "json" | "sarif";
  strict?: boolean;
  ci?: boolean;
};

type InitOptions = {
  dryRun?: boolean;
  envExample?: boolean;
  force?: boolean;
  preset?: string;
};

export type CliDependencies = {
  buildMarkdownTable: typeof buildMarkdownTable;
  error: (...values: unknown[]) => void;
  exit: (code: number) => never | void;
  explainVariable: typeof explainVariable;
  log: (...values: unknown[]) => void;
  readFile: typeof readFile;
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
  readFile,
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
    .version(cliVersion);

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
    .option("--strict", "treat documentation warnings as errors")
    .action(async (projectPath: string, options: DoctorOptions) => {
      await runDoctor(projectPath, { ...options, strict: Boolean(options.strict || options.ci), ci: Boolean(options.ci) }, dependencies);
    });

  program
    .command("table")
    .argument("[path]", "project directory", ".")
    .option("--out <file>", "write markdown table to a file")
    .option("--update <file>", "replace a marked configenvy table block in a markdown file")
    .option("--force", "append a configenvy table block when --update target has no marked block")
    .option("--dry-run", "print the updated markdown instead of writing it")
    .action(async (projectPath: string, options: { dryRun?: boolean; force?: boolean; out?: string; update?: string }) => {
      const rootDir = dependencies.resolvePath(projectPath);
      const result = await dependencies.scanProject({ rootDir });
      const table = dependencies.buildMarkdownTable(result);
      if (options.update) {
        await runTableUpdate(rootDir, table, { ...options, update: options.update }, dependencies);
      } else if (options.out) {
        await dependencies.writeFile(resolveOutputPath(rootDir, options.out, dependencies.resolvePath), `${table}\n`, "utf8");
      } else {
        dependencies.log(table);
      }
    });

  program
    .command("init")
    .argument("[path]", "project directory", ".")
    .description("create starter configenvy files")
    .option("--dry-run", "print planned files instead of writing them")
    .option("--env-example", "also create a .env.example draft from detected variables")
    .option("--force", "overwrite generated files if they already exist")
    .option("--preset <name>", `apply a preset: ${availablePresetList}`)
    .action(async (projectPath: string, options: InitOptions) => {
      await runInit(projectPath, options, dependencies);
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

type StarterConfig = {
  docs: string[];
  ignore: string[];
  optional: string[];
  required: string[];
};

const starterConfig: StarterConfig = {
  required: [],
  optional: [],
  ignore: ["NODE_ENV"],
  docs: ["README.md", "docs"]
};

type PresetName = keyof typeof presetConfigs;

const presetConfigs = {
  astro: {
    optional: ["PUBLIC_SITE_URL"],
    ignore: ["BASE_URL", "DEV", "MODE", "PROD", "SSR"]
  },
  docker: {
    optional: ["COMPOSE_PROJECT_NAME"],
    ignore: ["HOSTNAME"]
  },
  nextjs: {
    optional: ["NEXT_PUBLIC_APP_URL"],
    ignore: ["NEXT_RUNTIME"]
  },
  nuxt: {
    optional: ["NUXT_PUBLIC_API_BASE"]
  },
  sveltekit: {
    optional: ["PUBLIC_BASE_URL"]
  },
  vercel: {
    ignore: ["VERCEL", "VERCEL_ENV", "VERCEL_URL", "VERCEL_BRANCH_URL", "VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_REGION"]
  },
  vite: {
    optional: ["VITE_PUBLIC_URL"],
    ignore: ["BASE_URL", "DEV", "MODE", "PROD", "SSR"]
  }
} satisfies Record<string, Partial<StarterConfig>>;

const availablePresetNames = Object.keys(presetConfigs).sort();
const availablePresetList = ["auto", ...availablePresetNames].join(", ");

type InitFile = {
  content: string;
  path: string;
};

type PresetResolution = {
  config?: Partial<StarterConfig>;
  message?: string;
};

const require = createRequire(import.meta.url);
const cliPackage = require("../package.json") as { version: string };
export const cliVersion = cliPackage.version;

export const tableBlockStart = "<!-- configenvy:start -->";
export const tableBlockEnd = "<!-- configenvy:end -->";

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
  options: InitOptions = {},
  dependencies: CliDependencies = defaultDependencies
): Promise<void> {
  const rootDir = dependencies.resolvePath(projectPath);
  const result = await dependencies.scanProject({ rootDir });
  const preset = await resolvePreset(rootDir, options.preset, dependencies);
  if (options.preset && !preset.config && options.preset !== "auto") return;
  if (preset.message) dependencies.log(preset.message);
  const existingEnvExample = options.envExample && options.force
    ? await readOptionalText(dependencies.resolvePath(rootDir, ".env.example"), dependencies)
    : undefined;
  const files = buildInitFiles(rootDir, result, Boolean(options.envExample), dependencies.resolvePath, existingEnvExample, preset.config);

  if (options.dryRun) {
    for (const file of files) {
      dependencies.log(`Would write ${file.path}`);
      dependencies.log(file.content.trimEnd());
    }
    return;
  }

  if (!options.force && !(await ensureInitTargetsDoNotExist(files, dependencies))) {
    return;
  }

  const flag = options.force ? "w" : "wx";
  for (const file of files) {
    try {
      await dependencies.writeFile(file.path, file.content, { encoding: "utf8", flag });
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") {
        dependencies.error(`${file.path} already exists. Re-run with --force to overwrite.`);
        dependencies.exit(1);
        return;
      }
      throw error;
    }

    dependencies.log(`Created ${file.path}`);
  }
}

export function buildInitFiles(
  rootDir: string,
  result: ScanResult,
  includeEnvExample: boolean,
  resolvePath: typeof resolve = resolve,
  existingEnvExample?: string,
  preset?: Partial<StarterConfig>
): InitFile[] {
  const required = detectedRuntimeVariables(result);
  const config = {
    ...starterConfig,
    docs: mergeUnique(starterConfig.docs, preset?.docs ?? []),
    ignore: mergeUnique(starterConfig.ignore, preset?.ignore ?? []),
    optional: mergeUnique(starterConfig.optional, preset?.optional ?? []),
    required
  };
  const files: InitFile[] = [
    {
      path: resolvePath(rootDir, "configenvy.config.json"),
      content: `${JSON.stringify(config, null, 2)}\n`
    }
  ];

  if (includeEnvExample) {
    files.push({
      path: resolvePath(rootDir, ".env.example"),
      content: buildEnvExampleDraft(result, existingEnvExample)
    });
  }

  return files;
}

async function resolvePreset(rootDir: string, name: string | undefined, dependencies: CliDependencies): Promise<PresetResolution> {
  if (!name) return {};
  if (name === "auto") {
    return detectPreset(rootDir, dependencies);
  }
  if (name in presetConfigs) {
    return { config: presetConfigs[name as PresetName] };
  }
  dependencies.error(`Unknown preset "${name}". Available presets: ${availablePresetList}.`);
  dependencies.exit(1);
  return {};
}

async function detectPreset(rootDir: string, dependencies: CliDependencies): Promise<PresetResolution> {
  const packageJson = await readPackageJson(rootDir, dependencies);
  const packages = new Set(Object.keys({
    ...packageJson?.dependencies,
    ...packageJson?.devDependencies
  }));

  const packageDetections: Array<[PresetName, string, string]> = [
    ["nextjs", "next", "dependency \"next\""],
    ["vite", "vite", "dependency \"vite\""],
    ["astro", "astro", "dependency \"astro\""],
    ["nuxt", "nuxt", "dependency \"nuxt\""],
    ["sveltekit", "@sveltejs/kit", "dependency \"@sveltejs/kit\""]
  ];
  for (const [presetName, packageName, reason] of packageDetections) {
    if (packages.has(packageName)) {
      return detectedPreset(presetName, reason);
    }
  }

  const configDetections: Array<[PresetName, string[]]> = [
    ["nextjs", ["next.config.js", "next.config.mjs", "next.config.ts"]],
    ["vite", ["vite.config.js", "vite.config.mjs", "vite.config.ts"]],
    ["astro", ["astro.config.js", "astro.config.mjs", "astro.config.ts"]],
    ["nuxt", ["nuxt.config.js", "nuxt.config.mjs", "nuxt.config.ts"]],
    ["sveltekit", ["svelte.config.js", "svelte.config.ts"]]
  ];
  for (const [presetName, files] of configDetections) {
    for (const file of files) {
      if (await readOptionalText(dependencies.resolvePath(rootDir, file), dependencies) !== undefined) {
        return detectedPreset(presetName, `found ${file}`);
      }
    }
  }

  return { message: "No framework preset detected. Using the base config." };
}

function detectedPreset(name: PresetName, reason: string): PresetResolution {
  return {
    config: presetConfigs[name],
    message: `Detected preset: ${name}\nReason: ${reason}`
  };
}

async function readPackageJson(rootDir: string, dependencies: CliDependencies): Promise<{
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} | undefined> {
  const content = await readOptionalText(dependencies.resolvePath(rootDir, "package.json"), dependencies);
  if (content === undefined) return undefined;
  try {
    return JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
  } catch {
    return undefined;
  }
}

function mergeUnique(base: string[], extra: readonly string[]): string[] {
  return [...new Set([...base, ...extra])].sort();
}

async function ensureInitTargetsDoNotExist(files: InitFile[], dependencies: CliDependencies): Promise<boolean> {
  for (const file of files) {
    const existing = await readOptionalText(file.path, dependencies);
    if (existing !== undefined) {
      dependencies.error(`${file.path} already exists. Re-run with --force to overwrite.`);
      dependencies.exit(1);
      return false;
    }
  }
  return true;
}

async function readOptionalText(path: string, dependencies: CliDependencies): Promise<string | undefined> {
  try {
    return String(await dependencies.readFile(path, "utf8"));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function detectedRuntimeVariables(result: ScanResult): string[] {
  const runtimeKinds = new Set(["code", "ci", "config"]);
  return [...new Set(result.references.filter((reference) => runtimeKinds.has(reference.kind)).map((reference) => reference.name))].sort();
}

function buildEnvExampleDraft(result: ScanResult, existingContent?: string): string {
  const runtimeVars = detectedRuntimeVariables(result);
  if (existingContent !== undefined) {
    const existingVars = extractEnvExampleNames(existingContent);
    const missingVars = runtimeVars.filter((variable) => !existingVars.has(variable));
    if (missingVars.length === 0) {
      return existingContent.endsWith("\n") ? existingContent : `${existingContent}\n`;
    }

    return [
      existingContent.trimEnd(),
      "# Added by configenvy init",
      ...missingVars.map((variable) => `${variable}=`)
    ].filter(Boolean).join("\n") + "\n";
  }

  const lines = ["# Generated by configenvy init"];

  for (const variable of runtimeVars) {
    lines.push(`${variable}=`);
  }

  return `${lines.join("\n")}\n`;
}

function extractEnvExampleNames(content: string): Set<string> {
  const names = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match?.[1]) {
      names.add(match[1]);
    }
  }
  return names;
}

export async function runTableUpdate(
  rootDir: string,
  table: string,
  options: { dryRun?: boolean; force?: boolean; update: string },
  dependencies: CliDependencies = defaultDependencies
): Promise<void> {
  const targetPath = resolveOutputPath(rootDir, options.update, dependencies.resolvePath);
  const current = await dependencies.readFile(targetPath, "utf8");
  const updated = updateMarkdownTableBlock(current, table, Boolean(options.force));

  if (options.dryRun) {
    dependencies.log(updated);
    return;
  }

  await dependencies.writeFile(targetPath, updated, "utf8");
}

export function updateMarkdownTableBlock(markdown: string, table: string, force: boolean): string {
  const block = `${tableBlockStart}\n${table}\n${tableBlockEnd}`;
  const blockPattern = new RegExp(`${escapeRegExp(tableBlockStart)}[\\s\\S]*?${escapeRegExp(tableBlockEnd)}`);

  if (blockPattern.test(markdown)) {
    return markdown.replace(blockPattern, block);
  }

  if (force) {
    const separator = markdown.endsWith("\n") ? "\n" : "\n\n";
    return `${markdown}${separator}${block}\n`;
  }

  throw new Error(`No configenvy table block found. Add ${tableBlockStart} and ${tableBlockEnd}, or rerun with --force.`);
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
