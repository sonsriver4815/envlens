# Configuration

`configenvy.config.json` is optional.

```json
{
  "required": ["DATABASE_URL"],
  "optional": ["LOG_LEVEL"],
  "ignore": ["NODE_ENV"],
  "docs": ["README.md", "docs"]
}
```

- `required`: Variables that must be listed in env examples.
- `optional`: Variables that are allowed but not required.
- `ignore`: Variables configenvy should not report.
- `docs`: Markdown files or directories used for documentation checks.
