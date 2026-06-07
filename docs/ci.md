# CI

Use `check --ci` to fail when errors or warnings are found:

```yaml
name: configenvy
on: [pull_request]
jobs:
  configenvy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npx configenvy check --ci
```

With the default text output, `check --ci` also emits GitHub Actions annotations for warnings and errors.

To upload SARIF to GitHub code scanning:

```yaml
name: configenvy-sarif
on: [pull_request]
jobs:
  configenvy:
    runs-on: ubuntu-latest
    permissions:
      security-events: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - id: configenvy
        run: npx configenvy check --ci --format sarif > configenvy.sarif
        continue-on-error: true
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: configenvy.sarif
      - run: exit 1
        if: steps.configenvy.outcome == 'failure'
```
