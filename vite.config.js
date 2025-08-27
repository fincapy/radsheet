import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	resolve: {
		alias: {
			$components: fileURLToPath(new URL('./src/components', import.meta.url)),
			$ui: fileURLToPath(new URL('./src/components/ui', import.meta.url)),
			$hooks: fileURLToPath(new URL('./src/components/hooks', import.meta.url)),
			$utils: fileURLToPath(new URL('./src/components/utils', import.meta.url))
		}
	},
	test: {
		expect: { requireAssertions: true },
		environment: 'jsdom',
		include: ['src/**/*.{test,spec}.{js,ts}', 'tests/unit/**/*.{test,spec}.{js,ts}'],
		exclude: ['tests/e2e/**/*']
	}
});
