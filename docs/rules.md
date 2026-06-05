# Diagnostic Rules

## missing-example

The variable is used by code or marked as required, but no `.env.example`, `.env.sample`, or `.env.template` entry exists.

## unused-example

The variable appears in an example file but was not found in code, CI, deployment config, or `required`.

## undocumented

The variable is not mentioned in `README.md` or configured docs paths.

## dangerous-default

The example value looks like a real secret, long token, production URL, or private key.

## ci-missing

The variable appears in GitHub Actions, Docker Compose, or deployment config but is missing from contributor-facing docs.
