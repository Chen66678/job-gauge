# Changelog

## [0.0.1] - 2026-08-19

### Initial source release

- JobGauge workflow covering resume ingestion, JD extraction, preference parsing, AI-assisted matching, follow-up questions, and traceable resume material generation.
- Electron desktop application and a loopback API for importing jobs from the browser extension.
- WXT browser extension for reading the current BOSS Zhipin job and sending it to JobGauge.
- Unit tests for domain logic and major React pages.
- Release verification scripts for Electron scaffold, browser extension boundary, and repository release gate.
- Renderer IPC queries no longer rebroadcast unchanged state, preventing the idle job-list CPU loop.
- Root and browser-extension dependency trees updated to resolve the initial source release security audit findings.
- Public product name, README, screenshots, package metadata, and extension surfaces unified as JobGauge.
