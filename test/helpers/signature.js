'use strict';

/**
 * The part of a node's parameter definition that decides what a saved workflow can
 * store and what the node does with it: names, types, defaults, visibility rules and
 * option values. Display text (descriptions, hints, notices) is deliberately left
 * out, because wording is allowed to improve between versions.
 */
function signature(property) {
	return {
		name: property.name,
		type: property.type,
		default: property.default,
		required: property.required,
		displayOptions: property.displayOptions,
		typeOptions: property.typeOptions,
		options: property.options?.map((option) => {
			if (option.values) return { name: option.name, values: option.values.map(signature) };
			if (option.type) return signature(option);
			return { name: option.name, value: option.value };
		}),
	};
}

function descriptionSignature(description) {
	// Round-trip through JSON so the result compares equal to the stored golden file
	// (which cannot hold undefined values).
	return JSON.parse(
		JSON.stringify({
			version: description.version,
			credentials: description.credentials,
			properties: description.properties.map(signature),
		}),
	);
}

module.exports = { descriptionSignature, signature };
