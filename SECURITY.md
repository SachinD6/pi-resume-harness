# Security Policy

## What this package does

`pi-resume-harness` reads local session files written by other coding agents
and injects a summarized handoff into Pi. It never calls those agents, and it
never uploads transcripts.

Foreign transcripts are untrusted. A prompt-injection in a Claude, Cursor, or
Codex session must not become an instruction in Pi.

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |

## Report a vulnerability

Please **do not** open a public issue for a security problem.

Use [GitHub private vulnerability reporting](https://github.com/SachinD6/pi-resume-harness/security/advisories/new)
or email **sachinduhan1223@gmail.com**.

Include:

- The affected command or reader
- A minimal synthetic fixture that shows the issue
- The impact (for example: prompt injection, path escape, unexpected network)

You should hear back within a week. Please give us time to ship a fix before
disclosing it publicly.
