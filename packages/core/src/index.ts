export type EnvSourceKind = "example" | "code" | "docs" | "ci" | "config";

export type EnvReference = {
  name: string;
  file: string;
  line: number;
  kind: EnvSourceKind;
  value?: string;
};

export type DiagnosticCode =
  | "missing-example"
  | "unused-example"
  | "undocumented"
  | "dangerous-default"
  | "ci-missing";

export type DiagnosticSeverity = "warning" | "error";

export type Diagnostic = {
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  variable: string;
  message: string;
  files: string[];
};

export type EnvlensConfig = {
  required: string[];
  optional: string[];
  ignore: string[];
  docs: string[];
};

export type ScanOptions = {
  rootDir: string;
  strict?: boolean;
};

export type ScanResult = {
  rootDir: string;
  references: EnvReference[];
  diagnostics: Diagnostic[];
  variables: string[];
};

export const defaultConfig: EnvlensConfig = {
  required: [],
  optional: [],
  ignore: [],
  docs: ["README.md", "docs"]
};

const exampleFileNames = new Set([".env.example", ".env.sample", ".env.template"]);
const codeExtensions = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);
const workflowExtensions = new Set([".yml", ".yaml"]);

export async function scanProject(options: ScanOptions): Promise<ScanResult> {
  const path = await import("node:path");
  const rootDir = path.resolve(options.rootDir);
  const files = await listFiles(rootDir);
  const relativeFiles = new Set(files.map((file) => normalizePath(path.relative(rootDir, file))));
  const config = await readConfig(rootDir);
  const references: EnvReference[] = [];

  for (const file of files) {
    const relativePath = normalizePath(path.relative(rootDir, file));
    if (shouldSkip(relativePath)) continue;
    if (hasTypeScriptSibling(relativePath, relativeFiles)) continue;

    if (exampleFileNames.has(path.basename(file))) {
      references.push(...await parseDotenvFile(file, relativePath));
      continue;
    }

    if (isCodeFile(file)) {
      references.push(...await parseCodeFile(file, relativePath));
      continue;
    }

    if (isDocsFile(relativePath, config)) {
      references.push(...await parseDocsFile(file, relativePath));
      continue;
    }

    if (isCiFile(relativePath) || isComposeFile(relativePath) || relativePath === "vercel.json") {
      references.push(...await parseConfigFile(file, relativePath));
    }
  }

  const filteredReferences = references.filter((reference) => !config.ignore.includes(reference.name));
  const diagnostics = buildDiagnostics(filteredReferences, config, Boolean(options.strict));
  const variables = [...new Set(filteredReferences.map((reference) => reference.name))].sort();

  return {
    rootDir,
    references: filteredReferences,
    diagnostics,
    variables
  };
}

export function buildMarkdownTable(result: ScanResult): string {
  const rows = result.variables.map((variable) => {
    const refs = result.references.filter((reference) => reference.name === variable);
    const inExample = refs.some((reference) => reference.kind === "example") ? "yes" : "no";
    const inCode = refs.some((reference) => reference.kind === "code") ? "yes" : "no";
    const inDocs = refs.some((reference) => reference.kind === "docs") ? "yes" : "no";
    const inCi = refs.some((reference) => reference.kind === "ci" || reference.kind === "config") ? "yes" : "no";
    const issues = result.diagnostics
      .filter((diagnostic) => diagnostic.variable === variable)
      .map((diagnostic) => diagnostic.code)
      .join(", ");

    return `| ${variable} | ${inExample} | ${inCode} | ${inDocs} | ${inCi} | ${issues || "-"} |`;
  });

  return [
    "| Variable | .env example | Code | Docs | CI/config | Issues |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows
  ].join("\n");
}

export function explainVariable(result: ScanResult, variable: string): string {
  const refs = result.references.filter((reference) => reference.name === variable);
  if (refs.length === 0) {
    return `No references found for ${variable}.`;
  }

  const diagnostics = result.diagnostics.filter((diagnostic) => diagnostic.variable === variable);
  const lines = [`${variable}`];
  for (const ref of refs) {
    lines.push(`- ${ref.kind}: ${ref.file}:${ref.line}`);
  }
  if (diagnostics.length > 0) {
    lines.push("Issues:");
    for (const diagnostic of diagnostics) {
      lines.push(`- ${diagnostic.severity.toUpperCase()} ${diagnostic.code}: ${diagnostic.message}`);
    }
  }

  return lines.join("\n");
}

export function toJson(result: ScanResult): string {
  return JSON.stringify(result, null, 2);
}

function buildDiagnostics(references: EnvReference[], config: EnvlensConfig, strict: boolean): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const exampleVars = byKind(references, "example");
  const codeVars = byKind(references, "code");
  const docsVars = byKind(references, "docs");
  const ciVars = new Set([...byKind(references, "ci"), ...byKind(references, "config")]);
  const requiredVars = new Set(config.required);
  const optionalVars = new Set(config.optional);

  for (const variable of new Set([...codeVars, ...requiredVars])) {
    if (!exampleVars.has(variable)) {
      diagnostics.push({
        code: "missing-example",
        severity: "error",
        variable,
        message: `${variable} is used by code or required by config but is missing from .env.example files.`,
        files: filesFor(references, variable)
      });
    }
  }

  for (const variable of exampleVars) {
    if (!codeVars.has(variable) && !requiredVars.has(variable) && !optionalVars.has(variable) && !ciVars.has(variable)) {
      diagnostics.push({
        code: "unused-example",
        severity: "warning",
        variable,
        message: `${variable} is documented in an env example but was not found in code or CI config.`,
        files: filesFor(references, variable)
      });
    }
  }

  for (const variable of new Set([...codeVars, ...requiredVars, ...exampleVars])) {
    if (!docsVars.has(variable)) {
      diagnostics.push({
        code: "undocumented",
        severity: strict ? "error" : "warning",
        variable,
        message: `${variable} is not mentioned in README or docs.`,
        files: filesFor(references, variable)
      });
    }
  }

  for (const reference of references.filter((ref) => ref.kind === "example" && ref.value)) {
    if (isDangerousDefault(reference.value ?? "")) {
      diagnostics.push({
        code: "dangerous-default",
        severity: "error",
        variable: reference.name,
        message: `${reference.name} has a risky example value. Use a placeholder instead.`,
        files: [reference.file]
      });
    }
  }

  for (const variable of ciVars) {
    if (!exampleVars.has(variable) && !docsVars.has(variable)) {
      diagnostics.push({
        code: "ci-missing",
        severity: strict ? "error" : "warning",
        variable,
        message: `${variable} appears in CI or deployment config but is not described for contributors.`,
        files: filesFor(references, variable)
      });
    }
  }

  return diagnostics.sort((a, b) => a.variable.localeCompare(b.variable) || a.code.localeCompare(b.code));
}

async function parseDotenvFile(file: string, relativePath: string): Promise<EnvReference[]> {
  const content = await readText(file);
  return content.split(/\r?\n/).flatMap((line, index) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) return [];
    const value = match[2]?.replace(/^['"]|['"]$/g, "");
    return [{ name: match[1], value, file: relativePath, line: index + 1, kind: "example" as const }];
  });
}

async function parseCodeFile(file: string, relativePath: string): Promise<EnvReference[]> {
  const content = await readText(file);
  const patterns = [
    /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
    /process\.env\[['"]([A-Za-z_][A-Za-z0-9_]*)['"]\]/g,
    /import\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
    /Deno\.env\.get\(['"]([A-Za-z_][A-Za-z0-9_]*)['"]\)/g
  ];
  return extractReferences(content, relativePath, "code", patterns);
}

async function parseDocsFile(file: string, relativePath: string): Promise<EnvReference[]> {
  const content = await readText(file);
  return extractReferences(content, relativePath, "docs", [/\b([A-Z][A-Z0-9_]{2,})\b/g]);
}

async function parseConfigFile(file: string, relativePath: string): Promise<EnvReference[]> {
  const content = await readText(file);
  const kind: EnvSourceKind = isCiFile(relativePath) ? "ci" : "config";
  return extractReferences(content, relativePath, kind, [
    /\$\{\{\s*(?:secrets|vars|env)\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
    /\b([A-Z][A-Z0-9_]{2,})\b/g
  ]);
}

function extractReferences(
  content: string,
  file: string,
  kind: EnvSourceKind,
  patterns: RegExp[]
): EnvReference[] {
  const references: EnvReference[] = [];
  const seen = new Set<string>();

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const name = match[1];
      if (!name || ignoredVariableName(name)) continue;
      const offset = match.index ?? 0;
      const line = content.slice(0, offset).split(/\r?\n/).length;
      const key = `${name}:${line}:${kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      references.push({ name, file, line, kind });
    }
  }

  return references;
}

async function readConfig(rootDir: string): Promise<EnvlensConfig> {
  const path = await import("node:path");
  const configPath = path.join(rootDir, "configenvy.config.json");
  try {
    const raw = await readText(configPath);
    const parsed = JSON.parse(raw) as Partial<EnvlensConfig>;
    return {
      required: validateStringArray(parsed.required, "required"),
      optional: validateStringArray(parsed.optional, "optional"),
      ignore: validateStringArray(parsed.ignore, "ignore"),
      docs: parsed.docs === undefined ? defaultConfig.docs : validateStringArray(parsed.docs, "docs")
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return defaultConfig;
    }
    throw new Error(`Failed to read configenvy.config.json: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function validateStringArray(value: unknown, field: keyof EnvlensConfig): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${field} must be an array of strings.`);
  }
  return value;
}

async function listFiles(rootDir: string): Promise<string[]> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        files.push(fullPath);
      }
    }
  }

  await walk(rootDir);
  return files;
}

async function readText(file: string): Promise<string> {
  const fs = await import("node:fs/promises");
  return fs.readFile(file, "utf8");
}

function byKind(references: EnvReference[], kind: EnvSourceKind): Set<string> {
  return new Set(references.filter((reference) => reference.kind === kind).map((reference) => reference.name));
}

function filesFor(references: EnvReference[], variable: string): string[] {
  return [...new Set(references.filter((reference) => reference.name === variable).map((reference) => reference.file))];
}

function isDangerousDefault(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^(changeme|replace-me|your-|example|localhost|127\.0\.0\.1)/i.test(trimmed)) return false;
  if (isRemoteUrl(trimmed)) return true;
  if (/(sk-|ghp_|gho_|xoxb-|AKIA|BEGIN PRIVATE KEY)/.test(trimmed)) return true;
  return /^[A-Za-z0-9_-]{32,}$/.test(trimmed);
}

function isRemoteUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (!parsed.protocol || !parsed.hostname) return false;
    return !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function isCodeFile(file: string): boolean {
  const extension = file.slice(file.lastIndexOf("."));
  return codeExtensions.has(extension);
}

function isDocsFile(relativePath: string, config: EnvlensConfig): boolean {
  if (relativePath === "README.md") return true;
  if (!relativePath.endsWith(".md")) return false;
  return config.docs.some((docPath) => relativePath === docPath || relativePath.startsWith(`${docPath.replace(/\/$/, "")}/`));
}

function isCiFile(relativePath: string): boolean {
  const extension = relativePath.slice(relativePath.lastIndexOf("."));
  return relativePath.startsWith(".github/workflows/") && workflowExtensions.has(extension);
}

function isComposeFile(relativePath: string): boolean {
  return relativePath === "docker-compose.yml" || relativePath === "docker-compose.yaml" || relativePath === "compose.yml" || relativePath === "compose.yaml";
}

function shouldSkip(relativePath: string): boolean {
  return relativePath === ".env" || /^\.env\.(?!example$|sample$|template$)/.test(relativePath);
}

function hasTypeScriptSibling(relativePath: string, relativeFiles: Set<string>): boolean {
  if (relativePath.endsWith(".js")) {
    return relativeFiles.has(relativePath.replace(/\.js$/, ".ts"));
  }
  if (relativePath.endsWith(".jsx")) {
    return relativeFiles.has(relativePath.replace(/\.jsx$/, ".tsx"));
  }
  return false;
}

function ignoredVariableName(name: string): boolean {
  return ["NODE_ENV", "NODE_AUTH_TOKEN", "PATH", "HOME", "PWD", "CI", "TRUE", "FALSE", "URL", "URI", "API", "HTTP", "HTTPS", "ID"].includes(name);
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}
