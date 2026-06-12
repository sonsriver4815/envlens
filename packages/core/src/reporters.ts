import type { DiagnosticCode, ScanResult } from "./types.js";

export type SarifLog = {
  version: "2.1.0";
  $schema: string;
  runs: Array<{
    tool: {
      driver: {
        name: "configenvy";
        informationUri: string;
        rules: Array<{
          id: DiagnosticCode;
          name: DiagnosticCode;
          shortDescription: {
            text: string;
          };
          defaultConfiguration: {
            level: "error" | "warning";
          };
        }>;
      };
    };
    results: Array<{
      ruleId: DiagnosticCode;
      level: "error" | "warning";
      message: {
        text: string;
      };
      locations?: Array<{
        physicalLocation: {
          artifactLocation: {
            uri: string;
          };
        };
      }>;
    }>;
  }>;
};

export function buildMarkdownTable(result: ScanResult): string {
  const rows = result.variables.map((variable) => {
    const refs = result.references.filter((reference) => reference.name === variable);
    const inExample = refs.some((reference) => reference.kind === "example") ? "yes" : "no";
    const inCode = refs.some((reference) => reference.kind === "code") ? "yes" : "no";
    const inDocs = refs.some((reference) => reference.kind === "docs") ? "yes" : "no";
    const inCi = refs.some((reference) => reference.kind === "ci" || reference.kind === "config") ? "yes" : "no";
    const description = refs.find((reference) => reference.kind === "example" && reference.description)?.description;
    const issues = result.diagnostics
      .filter((diagnostic) => diagnostic.variable === variable)
      .map((diagnostic) => diagnostic.code)
      .join(", ");

    return `| ${markdownTableCell(variable)} | ${inExample} | ${inCode} | ${inDocs} | ${inCi} | ${markdownTableCell(description ?? "-")} | ${markdownTableCell(issues || "-")} |`;
  });

  return [
    "| Variable | .env example | Code | Docs | CI/config | Description | Issues |",
    "| --- | --- | --- | --- | --- | --- | --- |",
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

export function toSarif(result: ScanResult): string {
  const rules = [...new Set(result.diagnostics.map((diagnostic) => diagnostic.code))]
    .sort()
    .map((code) => ({
      id: code,
      name: code,
      shortDescription: {
        text: diagnosticRuleDescriptions[code]
      },
      defaultConfiguration: {
        level: diagnosticRuleDefaultLevels[code]
      }
    }));

  const sarif: SarifLog = {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: {
          driver: {
            name: "configenvy",
            informationUri: "https://github.com/sonsriver4815/configenvy",
            rules
          }
        },
        results: result.diagnostics.map((diagnostic) => ({
          ruleId: diagnostic.code,
          level: diagnostic.severity,
          message: {
            text: `${diagnostic.variable}: ${diagnostic.message}`
          },
          ...(diagnostic.files[0]
            ? {
                locations: [
                  {
                    physicalLocation: {
                      artifactLocation: {
                        uri: diagnostic.files[0]
                      }
                    }
                  }
                ]
              }
            : {})
        }))
      }
    ]
  };

  return JSON.stringify(sarif, null, 2);
}

function markdownTableCell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

const diagnosticRuleDescriptions: Record<DiagnosticCode, string> = {
  "ci-missing": "A variable appears in CI or deployment config but is not described for contributors.",
  "dangerous-default": "An example file contains a value that looks risky for contributors to copy.",
  "dynamic-env": "Code reads environment variables through a dynamic expression that cannot be resolved statically.",
  "missing-example": "A variable is used by code or required by config but is missing from env example files.",
  undocumented: "A variable is not mentioned in README or docs.",
  "unused-example": "A variable is documented in an env example but was not found in code or CI config."
};

const diagnosticRuleDefaultLevels: Record<DiagnosticCode, "error" | "warning"> = {
  "ci-missing": "warning",
  "dangerous-default": "error",
  "dynamic-env": "warning",
  "missing-example": "error",
  undocumented: "warning",
  "unused-example": "warning"
};
