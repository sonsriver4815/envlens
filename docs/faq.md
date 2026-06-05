# FAQ

## Does configenvy read `.env`?

No. configenvy intentionally skips `.env` and non-example `.env.*` files.

## Does configenvy upload files?

No. The CLI runs locally and does not call external APIs.

## Is the parser perfect?

No. v0.1 uses lightweight static extraction. It favors useful setup feedback over full AST coverage.
