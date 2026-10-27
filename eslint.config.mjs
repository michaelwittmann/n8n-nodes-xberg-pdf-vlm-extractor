import { configWithoutCloudSupport } from '@n8n/node-cli/eslint';

export default [
	...configWithoutCloudSupport,
	{
		// This node wraps the @xberg-io/xberg native addon, which must be a
		// runtime dependency (it ships platform-specific prebuilt .node binaries
		// and cannot be bundled). That makes the package ineligible for n8n Cloud
		// verification, but it installs and runs fine on self-hosted n8n. We
		// deliberately keep the dependency, so disable the no-runtime-dependencies
		// rule for package.json only.
		files: ['package.json'],
		rules: {
			'@n8n/community-nodes/no-runtime-dependencies': 'off',
		},
	},
	{
		// Both nodes deliberately reuse n8n's built-in `ollamaApi` credential
		// (from @n8n/n8n-nodes-langchain) instead of shipping a bespoke one, so a
		// user configures their Ollama endpoint once and both nodes pick it up —
		// the same pattern the first-party LangChain nodes use. We therefore
		// cannot declare the credential in this package's n8n.credentials field,
		// which is what the no-credential-reuse rule requires. Disable it for the
		// node files; no credential definition is bundled here to abuse.
		files: ['nodes/**/*.ts'],
		rules: {
			'@n8n/community-nodes/no-credential-reuse': 'off',
		},
	},
];
