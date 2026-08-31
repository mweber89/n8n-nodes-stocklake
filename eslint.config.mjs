import tseslint from 'typescript-eslint';
import communityNodesPlugin from '@n8n/eslint-plugin-community-nodes';

export default tseslint.config(
	{
		files: ['**/*.ts'],
		extends: [tseslint.configs.recommended],
	},
	communityNodesPlugin.configs.recommended,
);
