import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { RANK_COLUMNS } from './composites';
import { errorItem, executeRows } from './executeRows';
import { toolkitParameter } from './descriptions/ToolDescription';
import {
	TOOLKIT_ARGS,
	TOOLKIT_DEFAULT_OPERATIONS,
	TOOLKIT_OPERATIONS,
	TOOL_OPERATIONS,
	matchOperation,
} from './toolCatalog';

/**
 * The Toolkit (Stocklake Tool, resource "Toolkit"): one tool that offers several operations.
 * The agent names the operation and fills in a small shared set of arguments; the node
 * checks the operation against the filter the builder set, then runs the ordinary
 * operation with those arguments in place of the node's own parameters. Nothing about an
 * operation is re-implemented here, so it behaves exactly like the same operation set
 * up by hand (batching, partial failures, errors, CSV off).
 */

const CATEGORIES = ['all', 'gainers', 'losers', 'most_active'];

type AgentArgs = Record<string, string | number | undefined>;

function split(operation: string): [string, string] {
	const [resource, ...rest] = operation.split('.');
	return [resource, rest.join('.')];
}

/** What the agent sent, with empty text and 0 meaning "not given". */
function readAgentArguments(context: IExecuteFunctions, i: number): AgentArgs {
	const args: AgentArgs = {};
	for (const arg of TOOLKIT_ARGS) {
		const raw = context.getNodeParameter(toolkitParameter(arg.key), i, arg.fallback) as unknown;
		if (arg.type === 'number') {
			const n = Number(raw);
			if (Number.isFinite(n) && n !== 0) args[arg.key] = n;
		} else if (typeof raw === 'string' && raw.trim() !== '') {
			args[arg.key] = raw.trim();
		}
	}
	return args;
}

/** Fails with a message the model can act on: what was wrong and what is allowed. */
function refuse(context: IExecuteFunctions, i: number, message: string, description?: string) {
	return new NodeOperationError(context.getNode(), message, { itemIndex: i, description });
}

function oneOf(
	context: IExecuteFunctions,
	i: number,
	name: string,
	value: string | number | undefined,
	allowed: string[],
): string | undefined {
	if (value === undefined) return undefined;
	const found = allowed.find((a) => a.toLowerCase() === String(value).toLowerCase());
	if (!found) {
		throw refuse(context, i, `${name} must be one of: ${allowed.join(', ')} (got "${value}")`);
	}
	return found;
}

/** The node parameters of `operation`, taken from what the agent sent. */
function parametersFor(
	context: IExecuteFunctions,
	i: number,
	operation: string,
	args: AgentArgs,
): Record<string, unknown> {
	const parameters: Record<string, unknown> = {};
	for (const [name, arg] of Object.entries(TOOL_OPERATIONS[operation].args)) {
		let value = args[arg.key];
		if (arg.key === 'rank_by') {
			value = oneOf(context, i, 'rank_by', value, Object.keys(RANK_COLUMNS).concat('none'));
		} else if (arg.key === 'order') {
			value = oneOf(context, i, 'order', value, ['asc', 'desc']);
		} else if (arg.key === 'category') {
			value = oneOf(context, i, 'category', value, CATEGORIES);
		}
		if (value === undefined) {
			if (arg.fallback === undefined) {
				throw refuse(
					context,
					i,
					`${operation} needs the argument ${arg.key}`,
					`Call the tool again with ${arg.key} set. ${arg.description}.`,
				);
			}
			value = arg.fallback;
		}
		parameters[name] = value;
	}
	return parameters;
}

/** The execution context an operation sees: the node's own, except that the parameters of
 * the chosen operation come from the agent and everything else has its normal default. */
function contextFor(
	base: IExecuteFunctions,
	item: INodeExecutionData,
	operation: string,
	parameters: Record<string, unknown>,
): IExecuteFunctions {
	const [resource, name] = split(operation);
	const own: Record<string, unknown> = {
		...parameters,
		resource,
		operation: name,
		returnAll: false,
		simplify: true,
		options: {},
		additionalFields: {},
	};
	return new Proxy(base, {
		get(target, property, receiver) {
			if (property === 'getInputData') return () => [item];
			if (property === 'getNodeParameter') {
				return (parameter: string, _index: number, fallback?: unknown) => {
					if (parameter in own) return own[parameter];
					// The request options (retries, timeout, remaining calls) stay the builder's.
					if (parameter === 'requestOptions') return base.getNodeParameter(parameter, 0, fallback);
					return fallback;
				};
			}
			const value = Reflect.get(target, property, receiver) as unknown;
			return typeof value === 'function' ? value.bind(target) : value;
		},
	}) as IExecuteFunctions;
}

export async function executeToolkit(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const returnData: INodeExecutionData[] = [];

	for (let i = 0; i < items.length; i++) {
		const run = async (): Promise<INodeExecutionData[]> => {
			const enabled = (this.getNodeParameter(
				'toolkitOperations',
				i,
				TOOLKIT_DEFAULT_OPERATIONS,
			) as string[]).filter((key) => TOOLKIT_OPERATIONS.includes(key));
			const list = enabled.join(', ');
			if (enabled.length === 0) {
				throw refuse(this, i, 'No operation is switched on in this tool', 'Pick at least one under "Operations the Agent May Use".');
			}

			const asked = this.getNodeParameter('agentOperation', i, '') as string;
			if (String(asked).trim() === '') {
				throw refuse(this, i, `Say which operation to run. Use one of: ${list}`);
			}
			const known = matchOperation(asked, TOOLKIT_OPERATIONS);
			const operation = known && matchOperation(known, enabled);
			if (!operation) {
				throw refuse(
					this,
					i,
					known
						? `Operation "${asked}" is not available in this tool. Use one of: ${list}`
						: `Unknown operation "${asked}". Use one of: ${list}`,
				);
			}

			const parameters = parametersFor(this, i, operation, readAgentArguments(this, i));
			const result = await executeRows.call(contextFor(this, items[i], operation, parameters));
			return result[0].map((item) => ({ ...item, pairedItem: { item: i } }));
		};

		if (!this.continueOnFail()) {
			returnData.push(...(await run()));
			continue;
		}
		try {
			returnData.push(...(await run()));
		} catch (error) {
			returnData.push(errorItem(error, { item: i }));
		}
	}
	return [returnData];
}

