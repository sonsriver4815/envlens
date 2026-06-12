# Framework Presets

`configenvy init --preset <name>` creates a starter `configenvy.config.json` tuned for common project types.

```powershell
npx configenvy@latest init --preset nextjs
npx configenvy@latest init --preset vite
npx configenvy@latest init --preset docker
npx configenvy@latest init --preset vercel
```

Presets keep detected runtime variables in `required`, then add common platform variables to `optional` or `ignore`.

| Preset | Adds to optional | Adds to ignore |
| --- | --- | --- |
| `nextjs` | `NEXT_PUBLIC_APP_URL` | `NEXT_RUNTIME` |
| `vite` | `VITE_PUBLIC_URL` | `BASE_URL`, `DEV`, `MODE`, `PROD`, `SSR` |
| `docker` | `COMPOSE_PROJECT_NAME` | `HOSTNAME` |
| `vercel` | - | `VERCEL`, `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_BRANCH_URL`, `VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_REGION` |

Use `--dry-run` to preview the generated config before writing:

```powershell
npx configenvy@latest init --preset nextjs --dry-run
```
