# Contributing to AGContext

Thanks for helping make AI coding agents smarter about codebases. This guide
covers everything you need to land a change.

## Development setup

Requirements: **Node.js >= 22** and npm 10+.

```bash
git clone https://github.com/eonio/agcontext.git
cd agcontext
npm install
npm run build
npm test
```

Useful scripts (run from the repository root):

| Script                  | What it does                                   |
| ----------------------- | ---------------------------------------------- |
| `npm run build`         | Compile `packages/agcontext` to `dist/`        |
| `npm run typecheck`     | Type-check sources and tests without emitting  |
| `npm test`              | Unit + integration tests (Vitest)              |
| `npm run test:coverage` | Tests with V8 coverage                         |
| `npm run test:e2e`      | Build, then exercise the real `agc` binary     |
| `npm run bench`         | Retrieval benchmarks on a synthetic repository |
| `npm run lint`          | ESLint over the monorepo                       |
| `npm run format`        | Prettier write                                 |

Try your working copy against a real repository:

```bash
node packages/agcontext/dist/cli/main.js index --cwd /path/to/some/repo
node packages/agcontext/dist/cli/main.js retrieve "how does auth work" --cwd /path/to/some/repo
```

## Project layout

- `packages/agcontext/src/` — the library and CLI (see `docs/architecture.md`
  for the layer map).
- `packages/agcontext/tests/` — `unit/`, `integration/`, `e2e/`,
  `benchmarks/`, plus `fixtures/sample-repo/` (a miniature app exercising
  every graph relationship).
- `docs/` — product and engineering documentation.

## Making changes

1. **Fork and branch.** Branch from `main`; name it `feat/...`, `fix/...`, or
   `docs/...`.
2. **Keep the pipeline honest.** Retrieval and context assembly must stay
   deterministic (stable sorts, id tie-breaks, no wall-clock in output) and
   offline-capable (the `local` embedding provider is the zero-config path —
   never make an API key mandatory).
3. **Add tests.** New behavior needs unit coverage; cross-module behavior
   belongs in `tests/integration/`. The fixture repo is the shared canvas —
   extend it rather than inventing parallel fixtures.
4. **Run the full gate** before pushing:

   ```bash
   npm run lint && npm run typecheck && npm test && npm run test:e2e
   ```

## Commit messages

Releases are cut by semantic-release from
[Conventional Commits](https://www.conventionalcommits.org/):

- `fix: ...` → patch release
- `feat: ...` → minor release
- `feat!: ...` or a `BREAKING CHANGE:` footer → major release
- `docs:`, `chore:`, `test:`, `refactor:`, `ci:` → no release

Example: `feat(ranking): add reciprocal-rank fusion mode`.

## Pull requests

- Describe the problem, the approach, and any trade-offs.
- Include benchmark numbers for performance-sensitive changes
  (`npm run bench` before/after).
- CI must be green (lint, typecheck, tests on Linux + Windows).
- Public API changes need a matching update in `docs/api.md` and the README.

## Reporting bugs and proposing features

Open a GitHub issue with a minimal reproduction — ideally a small repository
plus the `agc` command that misbehaves. `agc doctor --json` output helps a
lot. For security reports, see [SECURITY.md](SECURITY.md) — please do not open
public issues for vulnerabilities.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Be
excellent to each other.
