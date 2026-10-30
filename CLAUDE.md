## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues for pkhamdee/modernapp (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Conventions

Conventions and local gotchas (Rancher Docker socket, test harness, adding an endpoint/service, deploy layout, human-only steps): see `docs/agents/conventions.md`.

## Git workflow

Tag-based releases: new work lands on `main` only; each minor series has a `release/N.x` branch for fixes; releases are annotated `vX.Y.Z` tags on the release branch. Every fix on a release branch must also land on `main`. See `docs/git-workflow.md`.
