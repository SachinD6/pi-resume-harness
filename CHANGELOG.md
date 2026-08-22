# Changelog

## Unreleased

- `/copy` now exports the full session transcript — every user and assistant message plus tool activity, unclipped and untruncated — as portable markdown with session metadata, ready to paste into any other coding agent; it no longer copies the Pi-only handoff prompt

## 0.2.0

- `/resume-grok` — resume Grok CLI sessions from `~/.grok/sessions` (`GROK_HOME`)
- Grok titles come from `summary.json`; system prompts and encrypted reasoning are never surfaced
- `/copy` — export any foreign session handoff to the clipboard (pbcopy / clip / wl-copy / xclip / xsel, WSL `clip.exe`)
- `/copy` clipboard attempts share one five-second deadline; a stalled tool no longer stretches the wait
- Windows-style session cwds recorded on another OS now match without host-path mangling
- Grok `<user_info>`, `<git_status>`, and `<system-reminder>` wrappers are stripped like Cursor/Claude wrappers
- Explicit transcript paths no longer resolve to an empty session under the wrong harness; each reader rejects foreign formats

## 0.1.2

- Apply the same project-cwd rule to Claude, Codex, and `/resume-foreign`
- `$HOME` no longer matches every child project for any harness
- Unwrap `<user_query>` / Claude slash-command XML in titles and last-request text

## 0.1.1

- Strip Cursor Desktop `<user_query>` / `<timestamp>` wrappers so titles are `hey`, not XML
- Do not treat `$HOME` as matching every Cursor project folder under it
- Attribute Cursor session `cwd` to the project path, matching Grok's reader

## 0.1.0

- `/resume-claude`, `/resume-cursor`, `/resume-codex`, and `/resume-foreign`
- Searchable TUI picker, `latest` / id / keyword / path resolution
- Native TypeScript readers (no Python)
- Inert handoff prompt with safety boundary
- Public repository layout: CI, contributing, security, and issue templates
