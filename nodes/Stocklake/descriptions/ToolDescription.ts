import type { INodeProperties, INodePropertyOptions, NodeParameterValueType } from 'n8n-workflow';

import {
	TOOLKIT_ARGS,
	TOOLKIT_RESOURCE,
	TOOLKIT_DEFAULT_OPERATIONS,
	TOOLKIT_OPERATIONS,
	TOOL_OPERATIONS,
	fromAI,
} from '../toolCatalog';
import type { ToolArg } from '../toolCatalog';

/**
 * Node version 2 used as a tool by an AI Agent ("Stocklake Tool" in n8n). Everything here
 * is shown only while the node is a tool (`@tool`), so the node on the canvas is unchanged:
 *
 *  - every operation has a Tool Description written for a model (toolCatalog.ts);
 *  - the parameters an agent should fill in (ticker, days, limit, ...) default to a
 *    `$fromAI()` expression, so nothing has to be wired by hand;
 *  - a Toolkit resource turns the node into ONE tool that offers several operations, with an
 *    operation filter that decides which ones the agent sees and may run.
 *
 * The execution side of the Toolkit is in toolkit.ts.
 */

const IN_TOOL = { '@tool': [true] };

/** `resource.operation` of a property that is shown for exactly one operation. */
function operationKey(property: INodeProperties): string | undefined {
	const show = property.displayOptions?.show;
	const resource = show?.resource?.[0];
	const operation = show?.operation?.[0];
	return typeof resource === 'string' && typeof operation === 'string'
		? `${resource}.${operation}`
		: undefined;
}

/** The same property, but not for a tool (an agent has no use for it). */
function hiddenInTool(property: INodeProperties): INodeProperties {
	return {
		...property,
		displayOptions: {
			...property.displayOptions,
			hide: { ...property.displayOptions?.hide, '@tool': [true] },
		},
	};
}

/** Properties an agent cannot use: it gets one input and no choice of where tickers come from. */
function isToolIrrelevant(property: INodeProperties): boolean {
	return (
		property.name === 'returnAll' ||
		property.name === 'page' ||
		property.name === 'symbolSource' ||
		property.name === 'symbolsFromInput' ||
		property.name === 'symbolSourceNotice' ||
		property.name === 'holdingsNotice' ||
		property.displayOptions?.show?.symbolSource !== undefined
	);
}

/** The copy of a property that an agent sees: the same field, filled by `$fromAI()`. */
function filledByAgent(property: INodeProperties, arg: ToolArg): INodeProperties {
	const show = { ...property.displayOptions?.show };
	// An agent has no Return All and no Symbol Source, so neither decides whether this shows.
	delete show.returnAll;
	delete show.symbolSource;
	const expression = fromAI(arg);
	const value: NodeParameterValueType =
		property.type === 'resourceLocator' ? { mode: 'id', value: expression } : expression;
	return {
		...property,
		default: value,
		displayOptions: { show: { ...show, ...IN_TOOL } },
	};
}

function toolDescriptionField(
	resource: string,
	operation: string,
	text: string,
): INodeProperties {
	return {
		displayName: 'Description',
		name: 'toolDescription',
		type: 'string',
		default: text,
		required: true,
		typeOptions: { rows: 4 },
		description:
			'What the AI model is told about this tool. The default is written for a model: what comes back, when to use it, what a free key gets. Edit it to add your own guidance.',
		displayOptions: { show: { resource: [resource], operation: [operation], ...IN_TOOL } },
	};
}

/** "stock.getHistory(symbol, [days])" - optional arguments in brackets. */
function signature(key: string): string {
	const args = Object.values(TOOL_OPERATIONS[key].args).map((arg) =>
		arg.fallback === undefined ? arg.key : `[${arg.key}]`,
	);
	return `${key}(${args.join(', ')})`;
}

const TOOLKIT_INTRO =
	'Stocklake stock market data, quotes delayed about 15 minutes. One tool, several operations: set operation to exactly ONE of the operations below and pass only the arguments that operation takes (in brackets: optional). Operations you can use:';

/**
 * The Toolkit's Tool Description, written as an n8n expression so that it lists only the
 * operations the filter lets through: a model that is not offered an operation cannot be
 * tempted to call it, and every entry costs it tokens.
 */
export function toolkitDescriptionExpression(): string {
	const lines: Record<string, string> = {};
	for (const key of TOOLKIT_OPERATIONS) {
		lines[key] = `${signature(key)} - ${TOOL_OPERATIONS[key].summary}`;
	}
	return (
		`={{ ${JSON.stringify(TOOLKIT_INTRO)} + "\\n" + ` +
		`($parameter["toolkitOperations"] || []).map(o => (${JSON.stringify(lines)})[o]).join("\\n") }}`
	);
}

const ARGUMENT_NAMES: Record<string, string> = {
	symbol: 'Symbol',
	symbols: 'Symbols',
	days: 'Days',
	limit: 'Limit',
	preset: 'Preset',
	sector: 'Sector',
	category: 'Category',
	rank_by: 'Rank By',
	order: 'Order',
};

function argumentProperty(arg: ToolArg): INodeProperties {
	return {
		displayName: ARGUMENT_NAMES[arg.key] ?? arg.key,
		name: `agent${arg.key.replace(/(^|_)(\w)/g, (_m, _s, c: string) => c.toUpperCase())}`,
		type: arg.type === 'number' ? 'number' : 'string',
		default: fromAI(arg),
		description: `Filled in by the AI model, from the question. ${arg.description}.`,
		displayOptions: { show: { resource: [TOOLKIT_RESOURCE], ...IN_TOOL } },
	};
}

/** Name of the node parameter an agent argument is stored under, for toolkit.ts. */
export function toolkitParameter(key: string): string {
	return argumentProperty(TOOLKIT_ARGS.find((a) => a.key === key) as ToolArg).name;
}

function toolkitProperties(labels: Record<string, string>): INodeProperties[] {
	const options: INodePropertyOptions[] = TOOLKIT_OPERATIONS.map((key) => ({
		name: labels[key] ?? key,
		value: key,
		description: TOOL_OPERATIONS[key].summary,
	})).sort((a, b) => a.name.localeCompare(b.name));

	return [
		{
			displayName: 'Operation',
			name: 'operation',
			type: 'options',
			noDataExpression: true,
			default: 'choose',
			options: [
				{
					name: 'Let the Agent Choose',
					value: 'choose',
					description:
						'One tool for all the operations switched on below. The agent picks the operation from the question.',
					action: 'Let the agent choose the operation',
				},
			],
			displayOptions: { show: { resource: [TOOLKIT_RESOURCE], ...IN_TOOL } },
		},
		{
			displayName: 'Operations the Agent May Use',
			name: 'toolkitOperations',
			type: 'multiOptions',
			default: [...TOOLKIT_DEFAULT_OPERATIONS],
			options,
			description:
				'The operation filter. The agent is told about these operations only and cannot run any other. Fewer operations make a better choice and a shorter prompt. Operations that need Pro fail for a free key.',
			displayOptions: { show: { resource: [TOOLKIT_RESOURCE], ...IN_TOOL } },
		},
		{
			displayName: 'Description',
			name: 'toolDescription',
			type: 'string',
			default: toolkitDescriptionExpression(),
			required: true,
			typeOptions: { rows: 4 },
			description:
				'What the AI model is told about this tool. The default lists the operations switched on above, so it follows the filter.',
			displayOptions: { show: { resource: [TOOLKIT_RESOURCE], ...IN_TOOL } },
		},
		{
			displayName: 'Operation to Run',
			name: 'agentOperation',
			type: 'string',
			default:
				"={{ $fromAI('operation', 'Which operation to run, exactly as written in the list of operations, for example stock.get', 'string') }}",
			description: 'Filled in by the AI model: the operation it picked from the list',
			displayOptions: { show: { resource: [TOOLKIT_RESOURCE], ...IN_TOOL } },
		},
		...TOOLKIT_ARGS.map(argumentProperty),
	];
}

/**
 * Turns the version 2 properties into those of the Stocklake Tool: ready-made descriptions
 * and `$fromAI()` defaults for each operation, and the Toolkit. Nothing changes for the
 * node itself: every change is shown only while `@tool` is true, and the properties that
 * are replaced for a tool are hidden for it.
 */
export function withToolVariant(list: INodeProperties[]): INodeProperties[] {
	// "Stock: Get Many" for the multi-select of the Toolkit.
	const resourceNames: Record<string, string> = {};
	const labels: Record<string, string> = {};
	for (const property of list) {
		if (property.name === 'resource') {
			for (const option of property.options as INodePropertyOptions[]) {
				resourceNames[String(option.value)] = option.name;
			}
		}
	}
	for (const property of list) {
		const resource = property.displayOptions?.show?.resource?.[0];
		if (property.name !== 'operation' || typeof resource !== 'string') continue;
		for (const option of property.options as INodePropertyOptions[]) {
			labels[`${resource}.${option.value}`] = `${resourceNames[resource] ?? resource}: ${option.name}`;
		}
	}

	const out: INodeProperties[] = [];
	let lastOperation = -1;
	for (const property of list) {
		if (property.name === 'resource') {
			out.push(hiddenInTool(property));
			out.push({
				...property,
				options: [
					{
						name: 'Toolkit (Agent Chooses the Operation)',
						value: TOOLKIT_RESOURCE,
						description:
							'One tool that offers several operations to the agent. You choose which ones.',
					},
					...(property.options as INodePropertyOptions[]),
				],
				displayOptions: { show: IN_TOOL },
			});
			continue;
		}

		const key = operationKey(property);
		const arg = key && !property.type.startsWith('notice') ? TOOL_OPERATIONS[key]?.args[property.name] : undefined;
		if (arg) {
			out.push(hiddenInTool(property));
			out.push(filledByAgent(property, arg));
		} else if (isToolIrrelevant(property)) {
			out.push(hiddenInTool(property));
		} else {
			out.push(property);
		}
		if (property.name === 'operation') lastOperation = out.length - 1;
	}

	// The descriptions and the Toolkit follow the last operation selector.
	const additions: INodeProperties[] = [];
	for (const key of Object.keys(TOOL_OPERATIONS)) {
		const [resource, operation] = key.split('.');
		additions.push(toolDescriptionField(resource, operation, TOOL_OPERATIONS[key].description));
	}
	additions.push(...toolkitProperties(labels));
	out.splice(lastOperation + 1, 0, ...additions);
	return out;
}
