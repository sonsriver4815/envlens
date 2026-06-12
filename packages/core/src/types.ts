export type EnvSourceKind = "example" | "code" | "docs" | "ci" | "config";

export type EnvReference = {
  name: string;
  file: string;
  line: number;
  kind: EnvSourceKind;
  value?: string;
  description?: string;
};

export type DiagnosticCode =
  | "missing-example"
  | "unused-example"
  | "undocumented"
  | "dangerous-default"
  | "ci-missing"
  | "dynamic-env";

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
