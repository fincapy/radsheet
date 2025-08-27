// Theme configuration for Radsheet. Export light (default) and dark themes
// plus a resolver that accepts a string name ("light" | "dark") or a
// partial override object which will be deep-merged over the light theme.

const light = {
	name: 'light',
	font: {
		family: 'Inter, system-ui, sans-serif',
		headerSizePx: 12,
		cellSizePx: 14
	},
	surface: {
		background: '#ffffff'
	},
	header: {
		background: '#ffffff',
		text: '#475569',
		gridLine: '#e5e7eb',
		border: '#d1d5db'
	},
	grid: {
		lineColor: '#e5e7eb',
		text: '#111827'
	},
	selection: {
		stroke: '#e11d48', // rose-600
		fillGrid: 'rgba(225,29,72,0.12)', // rose-600 with opacity
		fillHeader: 'rgba(225,29,72,0.15)', // rose-600 with opacity
		hoverResizeGlow: 'rgba(225,29,72,0.12)', // rose-600 with opacity
		hoverResizeLine: '#e11d48' // rose-600
	},
	border: {
		color: '#d1d5db'
	},
	icon: {
		muted: '#6b7280'
	},
	popover: {
		background: '#ffffff',
		border: '#e5e7eb',
		text: '#374151',
		mutedText: '#9ca3af',
		hoverBackground: '#f3f4f6'
	},
	scrollbar: {
		track: '#f3f4f6',
		thumb: '#9ca3af',
		thumbHover: '#6b7280',
		thumbActive: '#4b5563',
		border: '#d1d5db',
		buttonBg: '#f9fafb',
		buttonHoverBg: '#e5e7eb',
		icon: '#4b5563'
	},
	editor: {
		background: '#ffffff',
		text: '#111827',
		borderFocus: '#e11d48' // rose-600
	}
};

const dark = {
	name: 'dark',
	font: {
		family: 'Inter, system-ui, sans-serif',
		headerSizePx: 12,
		cellSizePx: 14
	},
	surface: {
		background: '#18181b' // zinc-900
	},
	header: {
		background: '#18181b', // zinc-800
		text: '#d4d4d8', // zinc-400
		gridLine: '#3f3f46', // zinc-600
		border: '#3f3f46' // zinc-600
	},
	grid: {
		lineColor: '#27272a', // zinc-600
		text: '#f4f4f5' // zinc-200
	},
	selection: {
		stroke: '#fb7185', // rose-400
		fillGrid: 'rgba(251,113,133,0.20)', // rose-400 with opacity
		fillHeader: 'rgba(251,113,133,0.25)', // rose-400 with opacity
		hoverResizeGlow: 'rgba(251,113,133,0.25)', // rose-400 with opacity
		hoverResizeLine: '#fb7185' // rose-400
	},

	border: {
		color: '#52525b' // zinc-600
	},
	icon: {
		muted: '#a1a1aa' // zinc-400
	},
	popover: {
		background: '#18181b', // zinc-900
		border: '#52525b', // zinc-600
		text: '#e4e4e7', // zinc-200
		mutedText: '#a1a1aa', // zinc-400
		hoverBackground: '#27272a', // zinc-800
		applyButton: '#f43f5e' // rose-500
	},
	scrollbar: {
		track: '#27272a', // zinc-800
		thumb: '#52525b', // zinc-600
		thumbHover: '#71717a', // zinc-500
		thumbActive: '#a1a1aa', // zinc-400
		border: '#52525b', // zinc-600
		buttonBg: '#27272a', // zinc-800
		buttonHoverBg: '#3f3f46', // zinc-700
		icon: '#a1a1aa' // zinc-400
	},
	editor: {
		background: '#18181b', // zinc-900
		text: '#e4e4e7', // zinc-200
		borderFocus: '#fb7185' // rose-400
	}
};

export const themes = { light, dark };

function isPlainObject(value) {
	return value != null && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override) {
	if (!isPlainObject(override)) return base;
	const result = { ...base };
	for (const key of Object.keys(override)) {
		const b = base[key];
		const o = override[key];
		if (isPlainObject(b) && isPlainObject(o)) {
			result[key] = deepMerge(b, o);
		} else {
			result[key] = o;
		}
	}
	return result;
}

export function resolveTheme(input) {
	if (typeof input === 'string') {
		return themes[input] || themes.light;
	}
	if (isPlainObject(input)) {
		return deepMerge(themes.light, input);
	}
	return themes.light;
}
