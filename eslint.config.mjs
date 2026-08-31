import tseslint from 'typescript-eslint';
import communityNodesPlugin from '@n8n/eslint-plugin-community-nodes';

export default tseslint.config(
	{
		files: ['**/*.ts'],
		extends: [tseslint.configs.recommended],
	},
	communityNodesPlugin.configs.recommended,
	{
		// 13 of the plugin's recommended rules (require-files-array, require-homepage,
		// no-runtime-dependencies, valid-author, valid-peer-dependencies,
		// package-name-convention, require-version, valid-description,
		// no-forbidden-lifecycle-scripts, no-overrides-field, no-template-placeholders,
		// node-registration-complete, ai-node-package-json) early-return unless ESLint
		// is linting package.json itself, and they read it as a plain JS object
		// expression. Without this block ESLint skips the file entirely ("File ignored
		// because no matching configuration was supplied") and all 13 silently never
		// run — while @n8n/scan-community-package still runs them at submission time,
		// so the failure would only surface there. Verified by sabotage: deleting
		// "files"/"homepage" and adding a runtime dependency correctly reports 3
		// violations with this block, and zero without it.
		files: ['package.json'],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: { ecmaVersion: 'latest', sourceType: 'script' },
		},
	},
);
