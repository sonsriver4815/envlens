# FAQ

## Does envlens read `.env`?

No. envlens intentionally skips `.env` and non-example `.env.*` files.

## Does envlens upload files?

No. The CLI runs locally and does not call external APIs.

## Is the parser perfect?

No. v0.1 uses lightweight static extraction. It favors useful setup feedback over full AST coverage.
