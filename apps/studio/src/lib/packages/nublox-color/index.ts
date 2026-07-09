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
	chromaMode: 'balanced' | 'paint' | 'accessible' | 'display';
	chromaPower: number;
	chromaBoost: number;
	neutralChromaFloor: number;
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
		maxChroma: number;
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
		description: 'General interface ramp: clean perceptual lightness, controlled chroma, stable hue.',
		lightnessMin: 0.14,
		lightnessMax: 0.97,
		chromaMode: 'balanced',
		chromaPower: 0.86,
		chromaBoost: 1,
		neutralChromaFloor: 0
	},
	paint: {
		name: 'paint',
		description: 'Painterly ramp: tints lose chroma toward white and shades retain body toward black.',
		lightnessMin: 0.12,
		lightnessMax: 0.975,
		chromaMode: 'paint',
		chromaPower: 0.72,
		chromaBoost: 1.06,
		neutralChromaFloor: 0
	},
	accessibility: {
		name: 'accessibility',
		description: 'Accessibility ramp: wider lightness spread and slightly restrained chroma for UI contrast.',
		lightnessMin: 0.09,
		lightnessMax: 0.985,
		chromaMode: 'accessible',
		chromaPower: 0.95,
		chromaBoost: 0.88,
		neutralChromaFloor: 0
	},
	display: {
		name: 'display',
		description: 'Display ramp: vivid colour for charts, previews and visual exploration.',
		lightnessMin: 0.13,
		lightnessMax: 0.965,
		chromaMode: 'display',
		chromaPower: 0.66,
		chromaBoost: 1.22,
		neutralChromaFloor: 0.006
	}
};

export function resolveProfile(profile: RampProfileName = 'ui'): RampProfile {
	return PROFILES[profile] ?? PROFILES.ui;
}

export function generateRamp(seedHex: Hex, options: GenerateRampOptions = {}): Ramp {
	const profile = resolveProfile(options.profile);
	const seedRgb = hexToRgb(seedHex);
	const seedOklch = rgbToOklch(seedRgb);
	const referenceStop = options.referenceStop ?? deriveStopFromLightness(seedOklch.l, profile);
	const referenceIndex = STOPS.indexOf(referenceStop);
	if (referenceIndex < 0) throw new Error(`Invalid reference stop: ${referenceStop}`);

	const seedHue = seedOklch.c < 0.0001 ? 0 : seedOklch.h;
	const seedChroma = seedOklch.c;
	const lightnessByStop = deriveLightnessScale(seedOklch, referenceIndex, profile);

	const raw: ColorStop[] = STOPS.map((stop, index) => {
		const isAnchor = stop === referenceStop;

		if (isAnchor) {
			const rgb = seedRgb;
			const oklch = seedOklch;
			return makeStop({
				stop,
				rgb,
				oklch,
				targetLightness: seedOklch.l,
				seedOklch,
				chromaScale: 1,
				hueAdjustment: 0,
				maxChroma: findMaxChroma(seedOklch.l, seedHue),
				gamutCompressed: false,
				gamutCompressionSteps: 0,
				isAnchor
			});
		}

		const targetLightness = lightnessByStop[index];
		const distanceFromAnchor = Math.abs(index - referenceIndex) / Math.max(referenceIndex, STOPS.length - 1 - referenceIndex, 1);
		const endpointFade = targetLightness > seedOklch.l ? 1 - targetLightness : targetLightness;
		const seedEndpointFade = targetLightness > seedOklch.l ? 1 - seedOklch.l : seedOklch.l;
		const availableRatio = seedEndpointFade > 0 ? clamp(endpointFade / seedEndpointFade, 0, 1.25) : 0;
		let chromaScale = Math.pow(availableRatio, profile.chromaPower) * profile.chromaBoost;

		if (profile.chromaMode === 'paint' && targetLightness < seedOklch.l) chromaScale *= 0.94 + 0.14 * (1 - distanceFromAnchor);
		if (profile.chromaMode === 'accessible') chromaScale *= 0.96;
		if (profile.chromaMode === 'display') chromaScale *= 1.04;

		let targetChroma = Math.max(profile.neutralChromaFloor, seedChroma * chromaScale);
		const maxChroma = findMaxChroma(targetLightness, seedHue);
		const safeChroma = Math.min(targetChroma, maxChroma * 0.995);
		const gamutCompressed = safeChroma < targetChroma - 0.0001;
		const gamutCompressionSteps = gamutCompressed ? 1 : 0;

		const oklch = { l: targetLightness, c: safeChroma, h: seedHue };
		const rgb = oklchToRgb(oklch);

		return makeStop({
			stop,
			rgb,
			oklch: rgbToOklch(rgb),
			targetLightness,
			seedOklch,
			chromaScale: seedChroma > 0 ? safeChroma / seedChroma : 0,
			hueAdjustment: shortestHueDelta(seedHue, rgbToOklch(rgb).h),
			maxChroma,
			gamutCompressed,
			gamutCompressionSteps,
			isAnchor
		});
	});

	for (let i = 0; i < raw.length; i++) {
		if (i > 0) raw[i].metrics.deltaEFromPrevious = deltaE(raw[i - 1].oklch, raw[i].oklch);
		const spacingPenalty = raw[i].metrics.deltaEFromPrevious == null ? 0 : Math.abs(raw[i].metrics.deltaEFromPrevious - 8);
		const compressionPenalty = raw[i].metrics.gamutCompressed ? 8 : 0;
		raw[i].metrics.objectiveScore = clamp(100 - spacingPenalty * 2 - compressionPenalty, 0, 100);
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
	const token = (name || 'brand').trim().replace(/[^a-zA-Z0-9_-]/g, '-');
	return STOPS.map((stop) => `--${token}-${stop}: ${ramp[stop].hex};`).join('\n');
}

export function rampToCssOklchVars(name: string, ramp: Ramp): string {
	const token = (name || 'brand').trim().replace(/[^a-zA-Z0-9_-]/g, '-');
	return STOPS.map((stop) => {
		const c = ramp[stop].oklch;
		return `--${token}-${stop}: oklch(${(c.l * 100).toFixed(2)}% ${c.c.toFixed(4)} ${c.h.toFixed(2)});`;
	}).join('\n');
}

function makeStop(input: {
	stop: Stop;
	rgb: Rgb;
	oklch: Oklch;
	targetLightness: number;
	seedOklch: Oklch;
	chromaScale: number;
	hueAdjustment: number;
	maxChroma: number;
	gamutCompressed: boolean;
	gamutCompressionSteps: number;
	isAnchor: boolean;
}): ColorStop {
	const luminance = relativeLuminance(input.rgb);
	const contrastOnWhite = contrastRatio(input.rgb, { r: 255, g: 255, b: 255 });
	const contrastOnBlack = contrastRatio(input.rgb, { r: 0, g: 0, b: 0 });
	return {
		stop: input.stop,
		hex: rgbToHex(input.rgb) as Hex,
		rgb: input.rgb,
		oklch: input.oklch,
		metrics: {
			luminance,
			targetLightness: input.targetLightness,
			actualLightness: input.oklch.l,
			chromaScale: input.chromaScale,
			hueAdjustment: input.hueAdjustment,
			contrastOnWhite,
			contrastOnBlack,
			preferredText: contrastOnWhite >= contrastOnBlack ? '#ffffff' : '#000000',
			deltaEFromBase: deltaE(input.seedOklch, input.oklch),
			objectiveScore: 100,
			gamutCompressed: input.gamutCompressed,
			gamutCompressionSteps: input.gamutCompressionSteps,
			maxChroma: input.maxChroma,
			isAnchor: input.isAnchor
		}
	};
}

function deriveLightnessScale(seed: Oklch, anchorIndex: number, profile: RampProfile): number[] {
	const values: number[] = [];
	const top = Math.max(deriveUsableLightnessMax(seed, profile), seed.l);
	const bottom = Math.min(profile.lightnessMin, seed.l);

	for (let i = 0; i < STOPS.length; i++) {
		if (i === anchorIndex) values.push(seed.l);
		else if (i < anchorIndex) values.push(lerp(top, seed.l, i / anchorIndex));
		else values.push(lerp(seed.l, bottom, (i - anchorIndex) / (STOPS.length - 1 - anchorIndex)));
	}

	return values;
}

function deriveUsableLightnessMax(seed: Oklch, profile: RampProfile): number {
	if (seed.c <= 0.0001) return profile.lightnessMax;

	const targetTintChroma = seed.c * deriveTintChromaRetention(seed, profile);
	if (findMaxChroma(profile.lightnessMax, seed.h) >= targetTintChroma) return profile.lightnessMax;

	let low = seed.l;
	let high = profile.lightnessMax;

	for (let i = 0; i < 24; i++) {
		const mid = (low + high) / 2;
		if (findMaxChroma(mid, seed.h) >= targetTintChroma) low = mid;
		else high = mid;
	}

	return low;
}

function deriveTintChromaRetention(seed: Oklch, profile: RampProfile): number {
	const chromaStrength = clamp(seed.c / 0.32, 0, 1);
	const profileBias =
		profile.chromaMode === 'display' ? 0.18 :
		profile.chromaMode === 'paint' ? 0.12 :
		profile.chromaMode === 'accessible' ? 0.08 :
		0.14;

	return profileBias * (0.65 + 0.35 * chromaStrength);
}

function findMaxChroma(l: number, h: number): number {
	let low = 0;
	let high = 0.45;
	for (let i = 0; i < 24; i++) {
		const mid = (low + high) / 2;
		const rgb = rawOklchToRgb({ l, c: mid, h });
		if (isRgbInGamut(rgb)) low = mid;
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
	return {
		r: clamp(rgb.r, 0, 255),
		g: clamp(rgb.g, 0, 255),
		b: clamp(rgb.b, 0, 255)
	};
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

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
