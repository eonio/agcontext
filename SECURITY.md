# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.x     | Yes       |

Security fixes land on the latest minor release.

## Reporting a Vulnerability

Please **do not open a public issue** for security problems.

Report privately via one of:

- GitHub private vulnerability reporting on
  [eonio/agcontext](https://github.com/eonio/agcontext/security/advisories/new)
- Email: **eonio.junior@gmail.com** with subject `SECURITY: agcontext`

Include a description, reproduction steps, affected versions, and impact. You
can expect an acknowledgement within 72 hours and a status update within 7
days. Coordinated disclosure is appreciated — we will credit reporters in the
release notes unless you prefer otherwise.

## Threat Model Notes

Things worth knowing when deploying AGContext:

- **API keys** are read from environment variables only, sent solely to the
  provider they belong to, transported in headers (never URLs), and never
  written to any cache, log, or telemetry record.
- **Telemetry is off by default** and, when enabled, is strictly local
  (in-memory plus an opt-in JSONL file under `.agcontext/`). AGContext never
  transmits telemetry over the network.
- **The `.agcontext/` cache contains your source code** (chunk texts,
  signatures, summaries). Treat it with the same sensitivity as the repository
  itself; it is gitignored by `agc init` for that reason.
- **Config files and plugins execute code.** `agcontext.config.ts` and plugin
  modules are evaluated with full process privileges — only run AGContext
  against repositories you trust, as you would with any build tool.
