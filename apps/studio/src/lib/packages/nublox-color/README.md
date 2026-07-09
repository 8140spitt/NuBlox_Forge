# NuBlox Color v5

Seed-anchored OKLCH colour ramp engine for design-system tokens.

## What v5 fixes

- Preserves the exact input colour at the selected/auto reference stop.
- Derives the anchor stop directly from the seed OKLCH lightness.
- Uses OKLCH lightness as the perceptual backbone.
- Separates desired chroma from maximum in-gamut chroma.
- Uses binary-search sRGB gamut limiting instead of arbitrary chroma tables.
- Adds natural hue drift for problematic shade families, especially yellow/green-yellow.
- Emits hex and native `oklch()` CSS variables.

## Usage

```ts
import { generateRamp, rampToCssVars, rampToCssOklchVars } from '$lib/packages/nublox-color/dist';

const ramp = generateRamp('#9437ff', {
  profile: 'ui'
});

console.log(ramp[500]);
console.log(rampToCssVars('brand', ramp));
console.log(rampToCssOklchVars('brand', ramp));
```

## Invariant

When a reference stop is supplied:

```ts
const ramp = generateRamp('#9437ff', { referenceStop: 500 });
ramp[500].hex === '#9437ff';
```

That invariant is intentional. The seed is the source of truth.

## Profiles

- `ui` — stable general interface ramp.
- `paint` — fuller painterly shade behaviour.
- `accessibility` — wider contrast spread with restrained chroma.
- `display` — vivid ramps for previews and data/display usage.

## Drop-in tester

Copy `svelte/NuBloxColorTester.svelte` into a route or component and import from your package path.
