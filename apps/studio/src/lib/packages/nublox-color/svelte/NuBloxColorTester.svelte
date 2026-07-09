<script lang="ts">
	import {
		deriveStopFromLightness,
		generateRamp,
		hexToRgb,
		rampToCssOklchVars,
		rampToCssVars,
		resolveProfile,
		rgbToOklch,
		STOPS,
		type ColorStop,
		type Hex,
		type Ramp,
		type RampProfileName,
		type Stop
	} from '$lib/packages/nublox-color/dist';

	type StopSelection = 'auto' | 'manual';
	type CssMode = 'hex' | 'oklch';

	let seed = $state<Hex>('#9437ff');
	let name = $state('brand');
	let stopSelection = $state<StopSelection>('auto');
	let anchor = $state<Stop>(500);
	let profile = $state<RampProfileName>('ui');
	let cssMode = $state<CssMode>('hex');

	let seedOklch = $derived(rgbToOklch(hexToRgb(seed)));
	let activeProfile = $derived(resolveProfile(profile));
	let autoAnchor = $derived(deriveStopFromLightness(seedOklch.l, activeProfile));
	let activeAnchor = $derived(stopSelection === 'auto' ? autoAnchor : anchor);

	let ramp: Ramp = $derived(
		generateRamp(seed, {
			profile,
			referenceStop: activeAnchor,
			explain: true
		})
	);

	let palette: ColorStop[] = $derived(STOPS.map((stop) => ramp[stop]));
	let cssVars = $derived(
		cssMode === 'hex' ? rampToCssVars(name || 'brand', ramp) : rampToCssOklchVars(name || 'brand', ramp)
	);

	let quality = $derived.by(() => {
		const compressed = palette.filter((s) => s.metrics.gamutCompressed).length;
		const anchorPreserved = ramp[activeAnchor]?.hex.toLowerCase() === seed.toLowerCase();

		const weakForeground = palette.filter(
			(s) => Math.max(s.metrics.contrastOnWhite, s.metrics.contrastOnBlack) < 4.5
		).length;

		const lightnessErrors = palette.map((s) => Math.abs(s.metrics.actualLightness - s.metrics.targetLightness));
		const maxLightnessError = Math.max(...lightnessErrors);

		const deltaValues = palette
			.map((s) => s.metrics.deltaEFromPrevious)
			.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

		const averageDelta =
			deltaValues.length > 0 ? deltaValues.reduce((a, b) => a + b, 0) / deltaValues.length : 0;

		const deltaVariance =
			deltaValues.length > 0
				? deltaValues.reduce((sum, value) => sum + Math.abs(value - averageDelta), 0) /
					deltaValues.length
				: 0;

		const score = Math.max(
			0,
			Math.round(
				100 -
					(anchorPreserved ? 0 : 50) -
					compressed * 2 -
					weakForeground * 4 -
					deltaVariance * 1.25 -
					maxLightnessError * 500
			)
		);

		return {
			score,
			pass: score >= 75 && anchorPreserved,
			anchorPreserved,
			issues: [
				...(anchorPreserved ? [] : [`Seed is not preserved at ${activeAnchor}.`]),
				...(weakForeground > 0
					? [`${weakForeground} stops have weak black/white foreground contrast.`]
					: [])
			],
			warnings: [
				...(compressed > 0 ? [`${compressed} stops required sRGB gamut chroma limiting.`] : []),
				...(deltaVariance > 6 ? ['Perceptual spacing is uneven across the ramp.'] : []),
				...(maxLightnessError > 0.002 ? ['Actual lightness drifted after conversion.'] : [])
			]
		};
	});

	function n(value: unknown, digits = 2) {
		return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
	}
</script>

<section class="tester">
	<div class="controls">
		<label>
			Seed
			<input type="color" bind:value={seed} />
			<input type="text" bind:value={seed} />
		</label>

		<label>
			Token name
			<input type="text" bind:value={name} />
		</label>

		<label>
			Stop selection
			<select bind:value={stopSelection}>
				<option value="auto">Auto from seed lightness</option>
				<option value="manual">Manual reference stop</option>
			</select>
		</label>

		<label>
			Reference stop
			<select bind:value={anchor} disabled={stopSelection === 'auto'}>
				{#each STOPS as stop}
					<option value={stop}>{stop}</option>
				{/each}
			</select>
		</label>

		<label>
			Profile
			<select bind:value={profile}>
				<option value="ui">UI</option>
				<option value="paint">Paint</option>
				<option value="accessibility">Accessibility</option>
				<option value="display">Display</option>
			</select>
		</label>

		<label>
			CSS
			<select bind:value={cssMode}>
				<option value="hex">Hex</option>
				<option value="oklch">OKLCH</option>
			</select>
		</label>
	</div>

	<div class="summary">
		<div><strong>Seed</strong> {seed}</div>
		<div><strong>Seed OKLCH</strong> {n(seedOklch.l, 3)} {n(seedOklch.c, 3)} {n(seedOklch.h, 1)}</div>
		<div><strong>Profile</strong> {activeProfile.name}</div>
		<div><strong>Reference stop</strong> {activeAnchor}</div>
		<div><strong>Anchor preserved</strong> {quality.anchorPreserved ? 'yes' : 'no'}</div>
		<div class:pass={quality.pass} class:fail={!quality.pass}>
			<strong>Quality</strong> {quality.score}/100
		</div>
	</div>

	<p class="description">{activeProfile.description}</p>

	{#if quality.issues.length > 0 || quality.warnings.length > 0}
		<ul class="issues">
			{#each quality.issues as issue}<li>{issue}</li>{/each}
			{#each quality.warnings as warning}<li>{warning}</li>{/each}
		</ul>
	{/if}

	<div class="ramp">
		{#each palette as stop}
			<div class:anchor={stop.stop === activeAnchor} class="swatch">
				<div class="chip" style={`background:${stop.hex}; color:${stop.metrics.preferredText}`}>
					<span>{stop.stop}</span>
				</div>

				<div class="meta">
					<strong>{stop.hex}</strong>
					<span>OKLCH {n(stop.oklch.l, 3)} {n(stop.oklch.c, 3)} {n(stop.oklch.h, 1)}</span>
					<span>Luminance {n(stop.metrics.luminance, 3)}</span>
					<span>Target L {n(stop.metrics.targetLightness, 3)}</span>
					<span>Actual L {n(stop.metrics.actualLightness, 3)}</span>
					<span>Desired C {n(stop.metrics.desiredChroma, 3)}</span>
					<span>Max C {n(stop.metrics.maxChroma, 3)}</span>
					<span>Chroma scale {n(stop.metrics.chromaScale, 3)}</span>
					<span>Hue drift {n(stop.metrics.hueAdjustment, 2)}°</span>
					<span>Contrast W {n(stop.metrics.contrastOnWhite, 2)} B {n(stop.metrics.contrastOnBlack, 2)}</span>
					<span>ΔE prev {n(stop.metrics.deltaEFromPrevious, 3)}</span>
					<span>ΔE base {n(stop.metrics.deltaEFromBase, 3)}</span>
					<span>Objective {n(stop.metrics.objectiveScore, 2)}</span>

					{#if stop.metrics.isAnchor}
						<span class="ok">Exact seed anchor</span>
					{/if}

					{#if stop.metrics.gamutCompressed}
						<span class="warn">Chroma limited to sRGB gamut</span>
					{/if}
				</div>
			</div>
		{/each}
	</div>

	<h3>CSS variables</h3>
	<pre>{cssVars}</pre>

	<h3>Raw anchor stop</h3>
	<pre>{JSON.stringify(ramp[activeAnchor], null, 2)}</pre>
</section>

<style>
	.tester {
		font-family: system-ui, sans-serif;
		padding: 1rem;
		color: #111827;
	}

	.controls,
	.summary {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: end;
		margin-bottom: 1rem;
	}

	label {
		display: grid;
		gap: 0.25rem;
		font-size: 0.85rem;
		font-weight: 700;
	}

	input,
	select {
		font: inherit;
		padding: 0.35rem 0.45rem;
	}

	.summary > div {
		border: 1px solid #e5e7eb;
		border-radius: 0.6rem;
		padding: 0.55rem 0.7rem;
		background: #f9fafb;
	}

	.pass { color: #047857; }
	.fail { color: #b91c1c; }

	.description { max-width: 72rem; }

	.issues {
		margin-block: 1rem;
		padding: 0.75rem 1rem 0.75rem 2rem;
		background: #fffbeb;
		border: 1px solid #fde68a;
		border-radius: 0.75rem;
	}

	.ramp {
		display: grid;
		gap: 0.5rem;
	}

	.swatch {
		display: grid;
		grid-template-columns: 8rem minmax(0, 1fr);
		border: 1px solid #e5e7eb;
		border-radius: 0.8rem;
		overflow: hidden;
	}

	.swatch.anchor {
		outline: 3px solid #111827;
	}

	.chip {
		display: grid;
		place-items: center;
		min-height: 5.5rem;
		font-size: 1.35rem;
		font-weight: 900;
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 0.75rem;
		align-content: center;
		padding: 0.7rem;
		font-size: 0.84rem;
	}

	.meta strong {
		width: 100%;
		font-size: 1rem;
	}

	.warn { color: #b45309; font-weight: 800; }
	.ok { color: #047857; font-weight: 800; }

	pre {
		white-space: pre-wrap;
		padding: 1rem;
		background: #111827;
		color: #e5e7eb;
		border-radius: 0.75rem;
		overflow: auto;
	}
</style>
