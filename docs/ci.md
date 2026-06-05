# CI

Use `check --ci` to fail when errors or warnings are found:

```yaml
name: envlens
on: [pull_request]
jobs:
  envlens:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npx envlens check --ci
```
