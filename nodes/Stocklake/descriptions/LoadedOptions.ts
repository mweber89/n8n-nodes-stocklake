import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';

import { COUNTRY_OPTIONS } from '../optionLists';

/**
 * Version 2 only: fields that were fixed lists (or free text) in version 1 and now take
 * their values from Stocklake through `methods.loadOptions`. The lists that shipped with
 * the node are the fallback, kept in optionLists.ts and used by the load functions, so
 * the `options` of these properties are dropped here. Version 1 is not touched.
 */

function shows(property: INodeProperties, resource: string): boolean {
	return property.displayOptions?.show?.resource?.includes(resource) ?? false;
}

function loaded(property: INodeProperties, method: string): INodeProperties {
	const copy: INodeProperties = { ...property };
	delete copy.options;
	return { ...copy, typeOptions: { ...property.typeOptions, loadOptionsMethod: method } };
}

function withCountryList(property: INodeProperties): INodeProperties {
	if (property.name !== 'additionalFields' || !shows(property, 'screener')) return property;
	return {
		...property,
		options: (property.options as INodeProperties[]).map((field) =>
			field.name === 'country'
				? {
						...field,
						type: 'options',
						default: '',
						options: [{ name: 'Any', value: '' }, ...COUNTRY_OPTIONS],
						description:
							'Countries with stocks in the universe. Not listed? Use an expression with the full English name.',
					}
				: field,
		),
	};
}

/** The Signal operation text names a source the API does not have. */
function withoutSocialSource(property: INodeProperties): INodeProperties {
	if (property.name !== 'operation' || !shows(property, 'signal')) return property;
	return {
		...property,
		options: (property.options as INodePropertyOptions[]).map((option) => ({
			...option,
			description: option.description?.replace(' sentiment and social ', ' and sentiment '),
		})),
	};
}

function withListedWatchlist(property: INodeProperties): INodeProperties {
	if (property.type !== 'resourceLocator') return property;
	return {
		...property,
		modes: property.modes?.map((mode) =>
			mode.name === 'list'
				? {
						...mode,
						placeholder: 'Search stocks or pick from your watchlist…',
						// Nothing typed lists the watchlist (Pro); other credentials see an empty list.
						typeOptions: { ...mode.typeOptions, searchFilterRequired: false },
					}
				: mode,
		),
	};
}

export function withLoadedOptions(list: INodeProperties[]): INodeProperties[] {
	return list.map((raw) => {
		const property = withListedWatchlist(withCountryList(withoutSocialSource(raw)));
		if (property.name === 'preset' && shows(property, 'screener'))
			return loaded(property, 'getScreenerPresets');
		if (property.name === 'sector') {
			if (shows(property, 'sector')) return loaded(property, 'getSectorsForRotation');
			if (shows(property, 'screener') || shows(property, 'earnings'))
				return loaded(property, 'getSectors');
		}
		if (shows(property, 'signal') && property.name === 'direction')
			return loaded(property, 'getSignalDirections');
		if (shows(property, 'signal') && property.name === 'source')
			return loaded(property, 'getSignalSources');
		if (property.name === 'types' && shows(property, 'stock'))
			return loaded(property, 'getActivityTypes');
		return property;
	});
}
