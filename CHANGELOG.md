# Changelog

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
