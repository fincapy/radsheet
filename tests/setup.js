import '@testing-library/jest-dom';

// Mock canvas API for Svelte component tests
HTMLCanvasElement.prototype.getContext = function () {
	return {
		fillRect: () => {},
		clearRect: () => {},
		getImageData: () => ({ data: new Array(4) }),
		putImageData: () => {},
		createImageData: () => [],
		setTransform: () => {},
		drawImage: () => {},
		save: () => {},
		fillText: () => {},
		restore: () => {},
		beginPath: () => {},
		moveTo: () => {},
		lineTo: () => {},
		closePath: () => {},
		stroke: () => {},
		translate: () => {},
		scale: () => {},
		rotate: () => {},
		arc: () => {},
		fill: () => {},
		measureText: () => ({ width: 0 }),
		transform: () => {},
		rect: () => {},
		clip: () => {}
	};
};

// Mock pointer capture methods
HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
HTMLCanvasElement.prototype.releasePointerCapture = vi.fn();

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
	constructor(callback) {
		this.callback = callback;
	}
	observe() {}
	unobserve() {}
	disconnect() {}
};

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
	constructor(callback) {
		this.callback = callback;
	}
	observe() {}
	unobserve() {}
	disconnect() {}
};

// Mock requestAnimationFrame
global.requestAnimationFrame = (callback) => setTimeout(callback, 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);

// Mock requestIdleCallback
global.requestIdleCallback = (callback) => setTimeout(callback, 0);
global.cancelIdleCallback = (id) => clearTimeout(id);

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
	writable: true,
	value: vi.fn().mockImplementation((query) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: vi.fn(), // deprecated
		removeListener: vi.fn(), // deprecated
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn()
	}))
});

// Mock window.getComputedStyle
Object.defineProperty(window, 'getComputedStyle', {
	value: () => ({
		getPropertyValue: () => ''
	})
});

// Mock window.devicePixelRatio
Object.defineProperty(window, 'devicePixelRatio', {
	value: 1,
	writable: true
});

// Mock console methods to reduce noise in tests
const originalConsole = { ...console };
beforeEach(() => {
	console.warn = vi.fn();
	console.error = vi.fn();
});

afterEach(() => {
	console.warn = originalConsole.warn;
	console.error = originalConsole.error;
});
