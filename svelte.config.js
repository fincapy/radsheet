import adapter from '@sveltejs/adapter-auto';
import { fileURLToPath, URL } from 'node:url';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
		// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
		// See https://svelte.dev/docs/kit/adapters for more information about adapters.
		adapter: adapter(),
		alias: {
			$components: fileURLToPath(new URL('./src/components', import.meta.url)),
			$ui: fileURLToPath(new URL('./src/components/ui', import.meta.url)),
			$hooks: fileURLToPath(new URL('./src/components/hooks', import.meta.url)),
			$utils: fileURLToPath(new URL('./src/components/utils', import.meta.url))
		}
	}
};

export default config;
