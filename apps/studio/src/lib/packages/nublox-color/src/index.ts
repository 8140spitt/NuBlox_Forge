export type Hex = `#${string}`;
export type Stop = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950;
export type RampProfileName = 'ui' | 'paint' | 'accessibility' | 'display';

export type Rgb = { r: number; g: number; b: number };
export type Oklab = { L: number; a: number; b: number };
export type Oklch = { l: number; c: number; h: number };

export type RampProfile = {
	name: RampProfileName;
	description: string;
	lightnessMin: number;
	lightnessMax: number;
	lightnessEasing: number;
	shadeChromaRetention: number;
	tintChromaRetention: number;
	chromaBoost: number;
	neutralChromaFloor: number;
	shadeHueDrift: number;
	tintHueDrift: number;
};

export type ColorStop = {
	stop: Stop;
	hex: Hex;
	rgb: Rgb;
	oklch: Oklch;
	metrics: {
		luminance: number;
		targetLightness: number;
		actualLightness: number;
		desiredChroma: number;
		maxChroma: number;
		chromaScale: number;
		hueAdjustment: number;
		contrastOnWhite: number;
		contrastOnBlack: number;
		preferredText: '#000000' | '#ffffff';
		deltaEFromPrevious?: number;
		deltaEFromBase: number;
		objectiveScore: number;
		gamutCompressed: boolean;
		gamutCompressionSteps: number;
		isAnchor: boolean;
	};
};

export type Ramp = Record<Stop, ColorStop>;

export type GenerateRampOptions = {
	profile?: RampProfileName;
	referenceStop?: Stop;
	explain?: boolean;
};

export const STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const satisfies readonly Stop[];

const PROFILES: Record<RampProfileName, RampProfile> = {
	ui: {
		name: 'ui',
		description: 'Interface ramp: seed-anchored perceptual lightness, stable hue, controlled chroma.',
		lightnessMin: 0.13,
		lightnessMax: 0.97,
		lightnessEasing: 1,
		shadeChromaRetention: 0.96,
		tintChromaRetention: 0.18,
		chromaBoost: 1,
		neutralChromaFloor: 0,
		shadeHueDrift: 0.72,
		tintHueDrift: 0.08
	},
	paint: {
		name: 'paint',
		description: 'Painterly ramp: clean tints, full-bodied shades, natural warm darkening for yellows/oranges.',
		lightnessMin: 0.11,
		lightnessMax: 0.975,
		lightnessEasing: 0.96,
		shadeChromaRetention: 1.08,
		tintChromaRetention: 0.14,
		chromaBoost: 1.04,
		neutralChromaFloor: 0,
		shadeHueDrift: 1,
		tintHueDrift: 0.05
	},
	accessibility: {
		name: 'accessibility',
		description: 'Accessibility ramp: maximum usable lightness spread with restrained chroma for predictable contrast.',
		lightnessMin: 0.08,
		lightnessMax: 0.985,
		lightnessEasing: 1.04,
		shadeChromaRetention: 0.86,
		tintChromaRetention: 0.11,
		chromaBoost: 0.9,
		neutralChromaFloor: 0,
		shadeHueDrift: 0.55,
		tintHueDrift: 0.04
	},
	display: {
		name: 'display',
		description: 'Display ramp: vivid perceptual colour for previews, visualisation and expressive UI.',
		lightnessMin: 0.12,
		lightnessMax: 0.965,
		lightnessEasing: 0.9,
		shadeChromaRetention: 1.18,
		tintChromaRetention: 0.22,
		chromaBoost: 1.18,
		neutralChromaFloor: 0.006,
		shadeHueDrift: 0.9,
		tintHueDrift: 0.08
	}
};

export function resolveProfile(profile: RampProfileName = 'ui'): RampProfile {
	return PROFILES[profile] ?? PROFILES.ui;
}

export function generateRamp(seedHex: Hex, options: GenerateRampOptions = {}): Ramp {
	const profile = resolveProfile(options.profile);
	const normalisedSeed = normaliseHex(seedHex);
	const seedRgb = hexToRgb(normalisedSeed);
	const seedOklch = rgbToOklch(seedRgb);
	const referenceStop = options.referenceStop ?? deriveStopFromLightness(seedOklch.l, profile);
	const referenceIndex = STOPS.indexOf(referenceStop);
	if (referenceIndex < 0) throw new Error(`Invalid reference stop: ${referenceStop}`);

	const seedHue = seedOklch.c < 0.0001 ? 0 : seedOklch.h;
	const lightnessByStop = deriveLightnessScale(seedOklch, referenceIndex, profile);

	const raw: ColorStop[] = STOPS.map((stop, index) => {
		const isAnchor = stop === referenceStop;

		if (isAnchor) {
			return makeStop({
				stop,
				rgb: seedRgb,
				oklch: seedOklch,
				targetLightness: seedOklch.l,
				seedOklch,
				desiredChroma: seedOklch.c,
				maxChroma: findMaxChroma(seedOklch.l, seedHue),
				chromaScale: 1,
				hueAdjustment: 0,
				gamutCompressed: false,
				gamutCompressionSteps: 0,
				isAnchor
			});
		}

		const targetLightness = lightnessByStop[index];
		const side = index < referenceIndex ? 'tint' : 'shade';
		const sideT = side === 'tint'
			? (referenceIndex - index) / Math.max(referenceIndex, 1)
			: (index - referenceIndex) / Math.max(STOPS.length - 1 - referenceIndex, 1);

		const targetHue = deriveHue(seedOklch, side, sideT, profile);
		const desiredChroma = deriveDesiredChroma(seedOklch, targetLightness, side, sideT, profile);
		const maxChroma = findMaxChroma(targetLightness, targetHue);
		const chroma = Math.min(desiredChroma, maxChroma * 0.997);
		const gamutCompressed = chroma < desiredChroma - 0.0001;

		const intended = { l: targetLightness, c: Math.max(chroma, 0), h: targetHue };
		const rgb = oklchToRgb(intended);
		const actual = rgbToOklch(rgb);

		return makeStop({
			stop,
			rgb,
			oklch: actual,
			targetLightness,
			seedOklch,
			desiredChroma,
			maxChroma,
			chromaScale: seedOklch.c > 0 ? actual.c / seedOklch.c : 0,
			hueAdjustment: shortestHueDelta(seedHue, actual.h),
			gamutCompressed,
			gamutCompressionSteps: gamutCompressed ? 1 : 0,
			isAnchor
		});
	});

	const deltas: number[] = [];
	for (let i = 1; i < raw.length; i++) deltas.push(deltaE(raw[i - 1].oklch, raw[i].oklch));
	const averageDelta = deltas.reduce((a, b) => a + b, 0) / Math.max(deltas.length, 1);

	for (let i = 0; i < raw.length; i++) {
		if (i > 0) raw[i].metrics.deltaEFromPrevious = deltas[i - 1];
		const spacingPenalty = raw[i].metrics.deltaEFromPrevious == null ? 0 : Math.abs(raw[i].metrics.deltaEFromPrevious - averageDelta);
		const compressionPenalty = raw[i].metrics.gamutCompressed ? 3 : 0;
		const lightnessPenalty = Math.abs(raw[i].metrics.actualLightness - raw[i].metrics.targetLightness) * 400;
		raw[i].metrics.objectiveScore = Number(clamp(100 - spacingPenalty * 1.8 - compressionPenalty - lightnessPenalty, 0, 100).toFixed(2));
	}

	return Object.fromEntries(raw.map((s) => [s.stop, s])) as Ramp;
}

export function deriveStopFromLightness(lightness: number, profileNameOrProfile: RampProfileName | RampProfile = 'ui'): Stop {
	const profile = typeof profileNameOrProfile === 'string' ? resolveProfile(profileNameOrProfile) : profileNameOrProfile;
	let bestStop: Stop = 500;
	let bestDistance = Infinity;
	for (let i = 0; i < STOPS.length; i++) {
		const nominal = lerp(profile.lightnessMax, profile.lightnessMin, i / (STOPS.length - 1));
		const distance = Math.abs(nominal - lightness);
		if (distance < bestDistance) {
			bestDistance = distance;
			bestStop = STOPS[i];
		}
	}
	return bestStop;
}

export function rampToCssVars(name: string, ramp: Ramp): string {
	const token = safeTokenName(name);
	return STOPS.map((stop) => `--${token}-${stop}: ${ramp[stop].hex};`).join('\n');
}

export function rampToCssOklchVars(name: string, ramp: Ramp): string {
	const token = safeTokenName(name);
	return STOPS.map((stop) => {
		const c = ramp[stop].oklch;
		return `--${token}-${stop}: oklch(${(c.l * 100).toFixed(2)}% ${c.c.toFixed(4)} ${c.h.toFixed(2)});`;
	}).join('\n');
}

export function generateHarmony(seedHex: Hex) {
	const seed = rgbToOklch(hexToRgb(seedHex));
	const rotate = (deg: number) => rgbToHex(oklchToRgb({ l: seed.l, c: Math.min(seed.c, findMaxChroma(seed.l, seed.h + deg) * 0.997), h: seed.h + deg }));
	return {
		base: normaliseHex(seedHex),
		complementary: rotate(180),
		analogous: [rotate(-30), rotate(30)],
		triadic: [rotate(120), rotate(240)],
		tetradic: [rotate(90), rotate(180), rotate(270)]
	};
}

function deriveLightnessScale(seed: Oklch, anchorIndex: number, profile: RampProfile): number[] {
	const top = Math.max(profile.lightnessMax, seed.l);
	const bottom = Math.min(profile.lightnessMin, seed.l);
	const values: number[] = [];

	for (let i = 0; i < STOPS.length; i++) {
		if (i === anchorIndex) {
			values.push(seed.l);
			continue;
		}

		if (i < anchorIndex) {
			const t = i / Math.max(anchorIndex, 1);
			values.push(lerp(top, seed.l, ease(t, profile.lightnessEasing)));
		} else {
			const t = (i - anchorIndex) / Math.max(STOPS.length - 1 - anchorIndex, 1);
			values.push(lerp(seed.l, bottom, ease(t, profile.lightnessEasing)));
		}
	}

	return values;
}

function deriveDesiredChroma(seed: Oklch, targetL: number, side: 'tint' | 'shade', t: number, profile: RampProfile): number {
	if (seed.c < 0.0001) return profile.neutralChromaFloor;

	const seedStrength = clamp(seed.c / 0.32, 0, 1);
	const targetMax = findMaxChroma(targetL, deriveHue(seed, side, t, profile));
	const anchorMax = Math.max(findMaxChroma(seed.l, seed.h), 0.0001);
	const gamutOpportunity = clamp(targetMax / anchorMax, 0, 1.45);

	if (side === 'tint') {
		const retainedAtWhite = profile.tintChromaRetention * (0.55 + 0.45 * seedStrength);
		const curve = lerp(1, retainedAtWhite, Math.pow(t, 0.82));
		return Math.max(profile.neutralChromaFloor, seed.c * curve * profile.chromaBoost * Math.min(1.08, gamutOpportunity));
	}

	const darkBody = profile.shadeChromaRetention;
	const naturalFalloff = lerp(1, 0.72, Math.pow(t, 1.85));
	const desired = seed.c * darkBody * naturalFalloff * profile.chromaBoost;
	return Math.max(profile.neutralChromaFloor, desired * Math.min(1.12, 0.72 + gamutOpportunity * 0.38));
}

function deriveHue(seed: Oklch, side: 'tint' | 'shade', t: number, profile: RampProfile): number {
	if (seed.c < 0.0001) return 0;
	const h = seed.h;
	let drift = 0;

	if (side === 'shade') {
		// Yellow/green-yellow shades look dirty if the hue is held rigidly; rotate toward amber/brown.
		if (h >= 82 && h <= 125) drift = -34 * profile.shadeHueDrift * Math.pow(t, 1.08);
		// Orange/red shades can go slightly warmer/deeper.
		else if (h >= 35 && h < 82) drift = -12 * profile.shadeHueDrift * Math.pow(t, 1.2);
		// Cyan/blue shades need a tiny violet bias to avoid green mud.
		else if (h >= 190 && h <= 270) drift = 8 * profile.shadeHueDrift * Math.pow(t, 1.2);
		// Purple/magenta stay mostly stable.
		else if (h > 270 && h <= 335) drift = 3 * profile.shadeHueDrift * Math.pow(t, 1.4);
	} else {
		// Tints stay much more hue-stable; only small correction to avoid acidic yellow whites.
		if (h >= 82 && h <= 125) drift = -6 * profile.tintHueDrift * Math.pow(t, 1.1);
		else if (h >= 190 && h <= 270) drift = -4 * profile.tintHueDrift * Math.pow(t, 1.1);
	}

	return normaliseHue(h + drift);
}

function makeStop(input: {
	stop: Stop;
	rgb: Rgb;
	oklch: Oklch;
	targetLightness: number;
	seedOklch: Oklch;
	desiredChroma: number;
	maxChroma: number;
	chromaScale: number;
	hueAdjustment: number;
	gamutCompressed: boolean;
	gamutCompressionSteps: number;
	isAnchor: boolean;
}): ColorStop {
	const luminance = relativeLuminance(input.rgb);
	const contrastOnWhite = contrastRatio(input.rgb, { r: 255, g: 255, b: 255 });
	const contrastOnBlack = contrastRatio(input.rgb, { r: 0, g: 0, b: 0 });
	return {
		stop: input.stop,
		hex: rgbToHex(input.rgb),
		rgb: input.rgb,
		oklch: input.oklch,
		metrics: {
			luminance,
			targetLightness: input.targetLightness,
			actualLightness: input.oklch.l,
			desiredChroma: input.desiredChroma,
			maxChroma: input.maxChroma,
			chromaScale: input.chromaScale,
			hueAdjustment: input.hueAdjustment,
			contrastOnWhite,
			contrastOnBlack,
			preferredText: contrastOnWhite >= contrastOnBlack ? '#ffffff' : '#000000',
			deltaEFromBase: deltaE(input.seedOklch, input.oklch),
			objectiveScore: 100,
			gamutCompressed: input.gamutCompressed,
			gamutCompressionSteps: input.gamutCompressionSteps,
			isAnchor: input.isAnchor
		}
	};
}

function findMaxChroma(l: number, h: number): number {
	let low = 0;
	let high = 0.5;
	for (let i = 0; i < 28; i++) {
		const mid = (low + high) / 2;
		if (isRgbInGamut(rawOklchToRgb({ l, c: mid, h }))) low = mid;
		else high = mid;
	}
	return low;
}

export function hexToRgb(hex: Hex | string): Rgb {
	const clean = String(hex).trim().replace('#', '');
	if (!/^[0-9a-fA-F]{6}$/.test(clean)) throw new Error(`Invalid hex colour: ${hex}`);
	return {
		r: parseInt(clean.slice(0, 2), 16),
		g: parseInt(clean.slice(2, 4), 16),
		b: parseInt(clean.slice(4, 6), 16)
	};
}

export function rgbToHex(rgb: Rgb): Hex {
	const part = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
	return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}` as Hex;
}

export function rgbToOklch(rgb: Rgb): Oklch {
	const lab = rgbToOklab(rgb);
	const c = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
	const h = c < 0.000001 ? 0 : normaliseHue((Math.atan2(lab.b, lab.a) * 180) / Math.PI);
	return { l: lab.L, c, h };
}

export function oklchToRgb(oklch: Oklch): Rgb {
	const rgb = rawOklchToRgb(oklch);
	return { r: clamp(rgb.r, 0, 255), g: clamp(rgb.g, 0, 255), b: clamp(rgb.b, 0, 255) };
}

function rgbToOklab(rgb: Rgb): Oklab {
	const r = srgbToLinear(rgb.r / 255);
	const g = srgbToLinear(rgb.g / 255);
	const b = srgbToLinear(rgb.b / 255);
	const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
	const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
	const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
	const l_ = Math.cbrt(l);
	const m_ = Math.cbrt(m);
	const s_ = Math.cbrt(s);
	return {
		L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
		a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
		b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_
	};
}

function rawOklchToRgb(oklch: Oklch): Rgb {
	const hRad = (normaliseHue(oklch.h) / 180) * Math.PI;
	const a = oklch.c * Math.cos(hRad);
	const b = oklch.c * Math.sin(hRad);
	const L = oklch.l;
	const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
	const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
	const s_ = L - 0.0894841775 * a - 1.291485548 * b;
	const l = l_ ** 3;
	const m = m_ ** 3;
	const s = s_ ** 3;
	const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
	const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
	const blue = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
	return { r: linearToSrgb(r) * 255, g: linearToSrgb(g) * 255, b: linearToSrgb(blue) * 255 };
}

function isRgbInGamut(rgb: Rgb): boolean {
	return rgb.r >= -0.0001 && rgb.r <= 255.0001 && rgb.g >= -0.0001 && rgb.g <= 255.0001 && rgb.b >= -0.0001 && rgb.b <= 255.0001;
}

function srgbToLinear(v: number): number {
	return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(v: number): number {
	return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

function relativeLuminance(rgb: Rgb): number {
	const r = srgbToLinear(rgb.r / 255);
	const g = srgbToLinear(rgb.g / 255);
	const b = srgbToLinear(rgb.b / 255);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: Rgb, b: Rgb): number {
	const l1 = relativeLuminance(a);
	const l2 = relativeLuminance(b);
	const lighter = Math.max(l1, l2);
	const darker = Math.min(l1, l2);
	return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}

function deltaE(a: Oklch, b: Oklch): number {
	const a1 = oklchToOklabCoords(a);
	const b1 = oklchToOklabCoords(b);
	return Math.sqrt((a1.L - b1.L) ** 2 + (a1.a - b1.a) ** 2 + (a1.b - b1.b) ** 2) * 100;
}

function oklchToOklabCoords(oklch: Oklch): Oklab {
	const hRad = (normaliseHue(oklch.h) / 180) * Math.PI;
	return { L: oklch.l, a: oklch.c * Math.cos(hRad), b: oklch.c * Math.sin(hRad) };
}

function shortestHueDelta(from: number, to: number): number {
	return ((((to - from) % 360) + 540) % 360) - 180;
}

function normaliseHue(h: number): number {
	return ((h % 360) + 360) % 360;
}

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * clamp(t, 0, 1);
}

function ease(t: number, power: number): number {
	return Math.pow(clamp(t, 0, 1), power);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function normaliseHex(hex: Hex | string): Hex {
	return rgbToHex(hexToRgb(hex));
}

function safeTokenName(name: string): string {
	return (name || 'brand').trim().replace(/[^a-zA-Z0-9_-]/g, '-') || 'brand';
}
