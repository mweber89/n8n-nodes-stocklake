import tseslint from 'typescript-eslint';
import communityNodesPlugin from '@n8n/eslint-plugin-community-nodes';
import n8nNodesBase from 'eslint-plugin-n8n-nodes-base';

export default tseslint.config(
	{
		files: ['**/*.ts'],
		extends: [tseslint.configs.recommended],
	},
	communityNodesPlugin.configs.recommended,
	{
		// The Creator Portal's automated vetting runs @n8n/scan-community-package,
		// which lints with eslint-plugin-n8n-nodes-base — a DIFFERENT plugin from
		// @n8n/eslint-plugin-community-nodes above. Running only the latter locally
		// gave a green `npm run lint` on a package the official scanner then failed
		// with 17 errors (0.1.0, 2026-09-01), so both plugins have to run here or
		// the local check keeps disagreeing with the one that actually gates
		// submission. `nodes` is the config whose rules the scanner's report cited.
		files: ['nodes/**/*.ts', 'credentials/**/*.ts'],
		plugins: { 'n8n-nodes-base': n8nNodesBase },
		rules: {
			...n8nNodesBase.configs.nodes.rules,
			// These two demand the string literals `['main']` for inputs/outputs.
			// That is the pre-NodeConnectionTypes style; this node uses the current
			// `NodeConnectionTypes.Main` enum, which is what modern n8n expects and
			// what the packed node was verified to load with. The official scanner
			// does not flag either rule (confirmed against its 0.1.0 report), so
			// they are the plugin lagging the n8n API, not a real defect — turning
			// them off rather than regressing working code to satisfy them.
			'n8n-nodes-base/node-class-description-inputs-wrong-regular-node': 'off',
			'n8n-nodes-base/node-class-description-outputs-wrong': 'off',
		},
	},
	{
		// 13 of @n8n/eslint-plugin-community-nodes' recommended rules early-return
		// unless ESLint is linting package.json itself, and read it as a plain JS
		// object expression. Without this block ESLint skips the file entirely
		// ("File ignored because no matching configuration was supplied") and all
		// 13 silently never run. Verified by sabotage: deleting "files"/"homepage"
		// and adding a runtime dependency reports 3 violations with this block and
		// zero without it.
		files: ['package.json'],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: { ecmaVersion: 'latest', sourceType: 'script' },
		},
	},
);
