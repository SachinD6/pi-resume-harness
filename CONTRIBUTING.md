# Contributing

Thanks for helping. Keep changes small and testable.

## Setup

```bash
git clone git@github.com:SachinD6/pi-resume-harness.git
cd pi-resume-harness
npm test
```

Node.js 22+ is required for the test runner. The extension itself runs inside
Pi via jiti.

## What to change

| Area | Live here |
| --- | --- |
| Slash commands and TUI | `src/command.ts`, `src/picker.ts`, `extensions/resume.ts` |
| Session discovery | `src/readers/` |
| Handoff prompt / safety copy | `src/handoff.ts` |
| Fixtures | `tests/` |

Readers should stay offline. Do not spawn Claude, Cursor, Codex, or any other
agent CLI. Do not send transcript contents anywhere.

Treat every foreign field as untrusted data. Tool calls recovered from a
transcript must stay marked `inert: true`.

## Tests

Add or update a test next to the behavior you change.

```bash
npm test
```

Use synthetic fixtures only. Never commit a real transcript, home path, or
credential.

## Pull requests

1. One concern per PR.
2. Say what a user can do afterward that they could not do before.
3. Keep the README, changelog, and command help in sync when the UX changes.

By contributing you agree that your work is licensed under the MIT License.
