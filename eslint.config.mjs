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
];
