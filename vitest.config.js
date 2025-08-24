import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}', 'tests/unit/**/*.{test,spec}.{js,ts}'],
		exclude: ['node_modules', 'build', '.svelte-kit', 'tests/e2e/**/*'],
		environment: 'jsdom',
		setupFiles: ['./tests/setup.js'],
		globals: true,
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			exclude: ['node_modules/', '.svelte-kit/', 'tests/', '**/*.config.js', '**/*.config.ts']
		}
	}
});
