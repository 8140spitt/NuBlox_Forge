# NuBlox Forge Starter

NuBlox Forge is being built as a metadata-driven business application platform.

This starter proves the first product slice:

```text
CSV upload / paste
→ column analysis
→ app schema generation
→ rich client manifest generation
```

## Install

```bash
npm install
npm run dev
```

Then open the local SvelteKit dev URL.

## Current packages

```text
apps/studio                  SvelteKit studio app
packages/core                Shared primitives and result types
packages/schema-engine       App/entity/field schema model
packages/import-engine       CSV parser and column analysis
packages/rich-client-engine  Commands, views, menus, perspectives manifest
packages/ui                  Placeholder UI package
```

## First milestone

The first profitable product slice is:

```text
Upload CSV
→ Generate Project/Action/Risk style business workbench
→ Show forms/views/dashboard/workflow/audit
```

This starter implements the first half of that path.
