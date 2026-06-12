import ts from "typescript";
import type { Diagnostic, EnvlensConfig, EnvReference, EnvSourceKind, ScanOptions, ScanResult } from "./types.js";

export type {
  Diagnostic,
  DiagnosticCode,
  DiagnosticSeverity,
  EnvlensConfig,
  EnvReference,
  EnvSourceKind,
  ScanOptions,
  ScanResult
} from "./types.js";

export { buildMarkdownTable, explainVariable, toJson, toSarif, type SarifLog } from "./reporters.js";

export const defaultConfig: EnvlensConfig = {
  required: [],
  optional: [],
  ignore: [],
  docs: ["README.md", "docs"]
};

const exampleFileNames = new Set([".env.example", ".env.sample", ".env.template"]);
const codeExtensions = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);
const workflowExtensions = new Set([".yml", ".yaml"]);
const dynamicEnvReferenceName = "<dynamic-env>";
const maxScannedFileBytes = 1024 * 1024;
const skippedDirectoryNames = new Set([
  ".cache",
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  "build",
  "coverage",
  "dist",
  "fixtures",
  "node_modules",
  "out",
  "test",
  "tests",
  "__mocks__",
  "__tests__"
]);

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
  const variables = [...new Set(filteredReferences.map((reference) => reference.name).filter((name) => name !== dynamicEnvReferenceName))].sort();

  return {
    rootDir,
    references: filteredReferences,
    diagnostics,
    variables
  };
}

function buildDiagnostics(references: EnvReference[], config: EnvlensConfig, strict: boolean): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const dynamicReferences = references.filter((reference) => reference.name === dynamicEnvReferenceName);
  const namedReferences = references.filter((reference) => reference.name !== dynamicEnvReferenceName);
  const exampleVars = byKind(namedReferences, "example");
  const codeVars = byKind(namedReferences, "code");
  const docsVars = byKind(namedReferences, "docs");
  const ciVars = new Set([...byKind(namedReferences, "ci"), ...byKind(namedReferences, "config")]);
  const requiredVars = new Set(config.required);
  const optionalVars = new Set(config.optional);

  for (const variable of new Set([...codeVars, ...requiredVars])) {
    if (!exampleVars.has(variable)) {
      diagnostics.push({
        code: "missing-example",
        severity: "error",
        variable,
        message: `${variable} is used by code or required by config but is missing from .env.example files.`,
        files: filesFor(namedReferences, variable)
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
        files: filesFor(namedReferences, variable)
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
        files: filesFor(namedReferences, variable)
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
        files: filesFor(namedReferences, variable)
      });
    }
  }

  if (dynamicReferences.length > 0) {
    diagnostics.push({
      code: "dynamic-env",
      severity: "warning",
      variable: "dynamic env access",
      message: "Environment variables are read through a dynamic expression and cannot be fully checked statically.",
      files: [...new Set(dynamicReferences.map((reference) => reference.file))]
    });
  }

  return diagnostics.sort((a, b) => a.variable.localeCompare(b.variable) || a.code.localeCompare(b.code));
}

async function parseDotenvFile(file: string, relativePath: string): Promise<EnvReference[]> {
  const content = await readText(file);
  const references: EnvReference[] = [];
  let pendingComments: string[] = [];

  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const comment = parseCommentLine(line);
    if (comment !== null) {
      pendingComments.push(comment);
      continue;
    }

    if (line.trim() === "") {
      pendingComments = [];
      continue;
    }

    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!match) {
      pendingComments = [];
      continue;
    }

    const rawValue = match[2] ?? "";
    const inline = splitInlineComment(rawValue);
    const description = inline.comment ?? (pendingComments.length > 0 ? pendingComments.join(" ") : undefined);
    references.push({
      name: match[1],
      value: stripQuotes(inline.value.trim()),
      file: relativePath,
      line: index + 1,
      kind: "example" as const,
      ...(description ? { description } : {})
    });
    pendingComments = [];
  }

  return references;
}

async function parseCodeFile(file: string, relativePath: string): Promise<EnvReference[]> {
  const content = await readText(file);
  const references = extractCodeReferencesWithAst(content, relativePath, scriptKindFor(file));
  if (references.length > 0) {
    return references;
  }

  return extractReferences(content, relativePath, "code", [
    /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
    /process\.env\[['"]([A-Za-z_][A-Za-z0-9_]*)['"]\]/g,
    /import\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
    /Deno\.env\.get\(['"]([A-Za-z_][A-Za-z0-9_]*)['"]\)/g
  ]);
}

function extractCodeReferencesWithAst(content: string, file: string, scriptKind: ts.ScriptKind): EnvReference[] {
  const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, scriptKind);
  const references: EnvReference[] = [];
  const seen = new Set<string>();

  function addReference(name: string, node: ts.Node): void {
    if (ignoredVariableName(name)) return;
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const lineNumber = line + 1;
    const key = `${name}:${lineNumber}:code`;
    if (seen.has(key)) return;
    seen.add(key);
    references.push({ name, file, line: lineNumber, kind: "code" });
  }

  function visit(node: ts.Node): void {
    if (ts.isPropertyAccessExpression(node)) {
      if (isProcessEnvExpression(node.expression) || isImportMetaEnvExpression(node.expression)) {
        addReference(node.name.text, node.name);
      }
    } else if (ts.isElementAccessExpression(node)) {
      const envObject = node.expression;
      const name = stringLiteralText(node.argumentExpression);
      if (isProcessEnvExpression(envObject) || isImportMetaEnvExpression(envObject)) {
        addReference(name ?? dynamicEnvReferenceName, node.argumentExpression);
      }
    } else if (ts.isCallExpression(node)) {
      const name = node.arguments[0] ? stringLiteralText(node.arguments[0]) : undefined;
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "get" && isDenoEnvExpression(node.expression.expression)) {
        addReference(name ?? dynamicEnvReferenceName, node.arguments[0] ?? node.expression.name);
      }
    } else if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && isProcessEnvExpression(node.initializer)) {
      for (const element of node.name.elements) {
        if (ts.isIdentifier(element.name) && !element.propertyName) {
          addReference(element.name.text, element.name);
        } else if (element.propertyName && ts.isIdentifier(element.propertyName)) {
          addReference(element.propertyName.text, element.propertyName);
        } else if (element.propertyName && ts.isStringLiteralLike(element.propertyName)) {
          addReference(element.propertyName.text, element.propertyName);
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return references;
}

function isProcessEnvExpression(node: ts.Node | undefined): boolean {
  return Boolean(
    node &&
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "env" &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "process"
  );
}

function isImportMetaEnvExpression(node: ts.Node | undefined): boolean {
  return Boolean(
    node &&
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "env" &&
      ts.isMetaProperty(node.expression) &&
      node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
      node.expression.name.text === "meta"
  );
}

function isDenoEnvExpression(node: ts.Node | undefined): boolean {
  return Boolean(
    node &&
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "env" &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "Deno"
  );
}

function stringLiteralText(node: ts.Node | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

function scriptKindFor(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
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

function parseCommentLine(line: string): string | null {
  const match = line.match(/^\s*#\s?(.*)$/);
  if (!match) return null;
  return match[1]?.trim() ?? "";
}

function splitInlineComment(value: string): { value: string; comment?: string } {
  let quote: "'" | "\"" | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === "\"" || char === "'") && value[index - 1] !== "\\") {
      quote = quote === char ? null : quote ?? char;
      continue;
    }
    if (char === "#" && quote === null && /\s/.test(value[index - 1] ?? "")) {
      const comment = value.slice(index + 1).trim();
      return {
        value: value.slice(0, index).trimEnd(),
        ...(comment ? { comment } : {})
      };
    }
  }
  return { value };
}

function stripQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, "");
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
      if (entry.isDirectory() && skippedDirectoryNames.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        const stat = await fs.stat(fullPath);
        if (stat.size > maxScannedFileBytes) continue;
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
