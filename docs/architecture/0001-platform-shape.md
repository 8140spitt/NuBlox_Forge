# ADR 0001: Platform Shape

## Decision

NuBlox Forge is a modular monolith in an npm workspace monorepo.

The first deployable application is `apps/studio`.

The generated business applications are metadata-driven rather than generated as separate SvelteKit codebases.

## Rationale

The uploaded reference schemas showed four useful platform patterns:

- User management and tenancy
- Rich client runtime
- API management
- Workflow automation

NuBlox Forge merges those patterns around one source of truth: the generated app definition.

## First slice

```text
CSV
→ Import Analysis
→ App Schema
→ Rich Client Manifest
→ Runtime Workbench
```
