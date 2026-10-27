import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		// Pure Node code — no DOM needed.
		environment: 'node',
		// Silence noisy "sourcemap points to missing source files" warnings from
		// the prebuilt n8n-workflow ESM bundle; they're unrelated to our tests.
		onConsoleLog: (log) => (log.includes('Sourcemap for') ? false : undefined),
		// Unit tests live next to the source they cover; the node-contract
		// suite lives under test/.
		include: ['nodes/**/*.test.ts', 'test/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			include: ['nodes/**/*.ts'],
			exclude: ['nodes/**/*.test.ts', 'nodes/**/*.node.ts'],
			reporter: ['text', 'lcov'],
		},
	},
});
