# Contributing

Thanks for contributing to Ava Agent.

## Development setup

1. Install Bun, the Codex CLI, GitHub CLI, and PostgreSQL.
2. Fork and clone the repository.
3. Run `bun install`.
4. Copy `.env.example` to `.env` only when using Prisma CLI commands, then replace the example database URL.
5. Run `bun run db:generate` and `bun run dev`.

Configure runtime credentials in the Electron UI. Never commit tokens, database URLs, numeric Telegram IDs, local settings files, or exported production data.

## Before opening a pull request

Run:

```bash
bun run typecheck
bun test
bun run build
```

Keep changes focused, add tests for behavior changes, and update the README when configuration or user-facing behavior changes.

## Pull requests

- Explain the problem and the chosen solution.
- Include relevant screenshots for UI changes.
- Call out schema migrations and security-sensitive changes.
- Do not include generated credentials or personal service endpoints in fixtures or documentation.
