import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { extract, ExtractInputKind } from '@xberg-io/xberg';
import type { JsonValue, OcrConfig } from '@xberg-io/xberg';

import {
	binaryPropertyNameProperty,
	buildOcrConfig,
	callChatCompletion,
	getLlmConfig,
	listModels,
	modelProperty,
	providerCredentials,
	providerProperty,
} from '../shared/xberg';

type SchemaObject = {
	type?: string | string[];
	properties?: Record<string, SchemaObject>;
	required?: string[];
	pattern?: string;
	minimum?: number;
	maximum?: number;
	minLength?: number;
	maxLength?: number;
	enum?: unknown[];
	items?: SchemaObject;
};

/** Validate `value` against a JSON Schema subset and return human-readable error strings. */
function collectErrors(value: unknown, schema: SchemaObject, path: string): string[] {
	const errors: string[] = [];

	// type check
	if (schema.type !== undefined) {
		const types = Array.isArray(schema.type) ? schema.type : [schema.type];
		const actual =
			value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
		if (!types.includes(actual)) {
			errors.push(`"${path}" expected type ${types.join('|')}, got ${actual}`);
			return errors; // deeper checks don't make sense when the type is wrong
		}
	}

	if (typeof value === 'string') {
		if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
			errors.push(`"${path}" value "${value}" does not match pattern ${schema.pattern}`);
		}
		if (schema.minLength !== undefined && value.length < schema.minLength) {
			errors.push(`"${path}" is shorter than minLength ${schema.minLength}`);
		}
		if (schema.maxLength !== undefined && value.length > schema.maxLength) {
			errors.push(`"${path}" is longer than maxLength ${schema.maxLength}`);
		}
	}

	if (typeof value === 'number') {
		if (schema.minimum !== undefined && value < schema.minimum) {
			errors.push(`"${path}" ${value} is less than minimum ${schema.minimum}`);
		}
		if (schema.maximum !== undefined && value > schema.maximum) {
			errors.push(`"${path}" ${value} is greater than maximum ${schema.maximum}`);
		}
	}

	if (schema.enum !== undefined) {
		const allowed = schema.enum.map((v) => JSON.stringify(v)).join(', ');
		if (!schema.enum.some((v) => JSON.stringify(v) === JSON.stringify(value))) {
			errors.push(`"${path}" value ${JSON.stringify(value)} is not one of [${allowed}]`);
		}
	}

	if (schema.properties !== undefined && typeof value === 'object' && value !== null && !Array.isArray(value)) {
		const obj = value as Record<string, unknown>;

		for (const key of schema.required ?? []) {
			if (!(key in obj)) {
				errors.push(`"${path ? path + '.' : ''}${key}" is required but missing`);
			}
		}

		for (const [key, propSchema] of Object.entries(schema.properties)) {
			if (key in obj) {
				errors.push(...collectErrors(obj[key], propSchema, path ? `${path}.${key}` : key));
			}
		}
	}

	if (schema.items !== undefined && Array.isArray(value)) {
		value.forEach((item, idx) => {
			errors.push(...collectErrors(item, schema.items!, `${path}[${idx}]`));
		});
	}

	return errors;
}

export class PdfFieldExtractor implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'PDF Field Extractor',
		name: 'pdfFieldExtractor',
		icon: { light: 'file:pdfFieldExtractor.svg', dark: 'file:pdfFieldExtractor.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["model"]}}',
		description:
			'Extract structured fields from a PDF against a JSON Schema. Reads the PDF text layer (or OCRs when none is present) then calls the model to extract fields — works with any model, no structured-output support required.',
		defaults: {
			name: 'PDF Field Extractor',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: providerCredentials,
		properties: [
			binaryPropertyNameProperty,
			providerProperty,
			modelProperty,
			{
				displayName: 'JSON Schema',
				name: 'jsonSchema',
				type: 'json',
				default:
					'{\n  "type": "object",\n  "properties": {\n    "invoiceNumber": { "type": "string" },\n    "total": { "type": "number" },\n    "date": { "type": "string" }\n  },\n  "required": ["invoiceNumber"]\n}',
				required: true,
				typeOptions: {
					rows: 10,
				},
				hint: 'Describe the fields you want back as a JSON Schema — the model returns JSON in exactly this shape. Field names and the "required" list are your main way to steer extraction.',
				description:
					'JSON Schema describing the fields to extract. The LLM returns JSON matching this schema.',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Schema Description',
						name: 'schemaDescription',
						type: 'string',
						typeOptions: {
							rows: 4,
						},
						default: '',
						hint: 'A sentence or two of plain-language context about the document or fields. Helps the model when field names alone are ambiguous.',
						description: 'Optional description of the schema to help the LLM',
					},
				],
			},
			{
				displayName: 'OCR if No Text Layer',
				name: 'ocrFallback',
				type: 'boolean',
				default: false,
				hint: 'Off: read the PDF’s existing text layer and error if there is none (run PDF OCR first). On: OCR the PDF here when it has no text layer.',
				description:
					'Whether to run VLM OCR when the PDF has no usable text layer. Off (default): the node requires an existing text layer and errors if none is found — run the PDF OCR node first. On: the node OCRs the PDF itself when no text layer is present.',
			},
			{
				displayName: 'OCR Options',
				name: 'ocrOptions',
				type: 'collection',
				placeholder: 'Add OCR Option',
				default: {},
				displayOptions: {
					show: {
						ocrFallback: [true],
					},
				},
				options: [
					{
						displayName: 'Custom OCR Prompt',
						name: 'vlmPrompt',
						type: 'string',
						typeOptions: {
							rows: 4,
						},
						default: '',
						hint: 'Overrides xberg’s built-in OCR prompt entirely. Leave empty to use the tuned default.',
						description:
							'Custom prompt template for the OCR fallback. Leave empty to use the xberg default. Supports the <code>{{ language }}</code> template variable.',
					},
					{
						displayName: 'Force OCR',
						name: 'forceOcr',
						type: 'boolean',
						default: false,
						hint: 'On: always OCR the pages fresh, even when the PDF already has a text layer. Off: reuse the existing layer and only OCR when none is present.',
						description:
							'Whether to always run a fresh VLM OCR pass instead of reusing an existing text layer. Off reuses the embedded layer and only OCRs when none exists.',
					},
					{
						displayName: 'Languages',
						name: 'language',
						type: 'string',
						default: 'eng',
						placeholder: 'eng,deu',
						hint: 'ISO 639 codes hinting the OCR which language(s) the page is in. Separate multiple with commas, e.g. eng,deu.',
						description:
							'Comma-separated ISO 639 language code(s) to guide OCR (e.g. <code>eng</code> or <code>eng,deu</code>)',
					},
					{
						displayName: 'Temperature',
						name: 'temperature',
						type: 'number',
						default: 0,
						typeOptions: {
							minValue: 0,
							numberPrecision: 2,
						},
						hint: 'Keep at 0 for faithful transcription. Higher values add randomness.',
						description: 'Sampling temperature for the VLM. Lower is more deterministic.',
					},
					{
						displayName: 'Timeout (Seconds)',
						name: 'timeoutSecs',
						type: 'number',
						default: 300,
						typeOptions: {
							minValue: 1,
						},
						hint: 'Max wait per model call. Raise it for large PDFs or slow local models.',
						description: 'Per-request timeout for the OCR call, in seconds',
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {
			listModels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return listModels.call(this);
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
				const ocrFallback = this.getNodeParameter('ocrFallback', i, false) as boolean;
				const ocrOptions = this.getNodeParameter('ocrOptions', i, {}) as IDataObject;

				this.helpers.assertBinaryData(i, binaryPropertyName);
				const buffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);
				const binary = items[i].binary![binaryPropertyName];
				const fileName = binary.fileName ?? 'document.pdf';

				// OCR tuning options only apply when the OCR fallback is enabled.
				// getLlmConfig is still needed to build the OCR config, but field
				// extraction is now done via a direct chat call (no structured-output
				// grammar constraint), so any model — including MLX backends — works.
				const llm = await getLlmConfig(this, i, ocrFallback ? ocrOptions : {});

				// Parse and validate the JSON Schema before doing any work so a
				// malformed schema produces a clear, item-scoped error.
				const schemaRaw = this.getNodeParameter('jsonSchema', i) as string | IDataObject;
				let schema: JsonValue;
				if (typeof schemaRaw === 'string') {
					try {
						schema = JSON.parse(schemaRaw) as JsonValue;
					} catch (parseError) {
						throw new NodeOperationError(
							this.getNode(),
							`The provided JSON Schema is not valid JSON: ${(parseError as Error).message}`,
							{ itemIndex: i },
						);
					}
				} else {
					schema = schemaRaw as JsonValue;
				}

				const options = this.getNodeParameter('options', i, {}) as IDataObject;
				const schemaDescription = (options.schemaDescription as string | undefined) || undefined;

				// Step 1: use xberg for text extraction only (no structuredExtraction).
				// When the OCR fallback is off we pass no `ocr` config, so a PDF with no
				// text layer fails clearly instead of silently being OCR'd.
				let ocr: OcrConfig | undefined;
				let forceOcr = false;
				if (ocrFallback) {
					ocr = buildOcrConfig(llm, ocrOptions);
					forceOcr = (ocrOptions.forceOcr as boolean) ?? false;
				}

				const result = await extract(
					{
						kind: ExtractInputKind.Bytes,
						bytes: buffer,
						mimeType: 'application/pdf',
						filename: fileName,
					},
					{
						forceOcr,
						...(ocr ? { ocr } : {}),
						// No structuredExtraction — xberg just gives us the text.
					},
				);

				if (result.errors && result.errors.length > 0) {
					const message = result.errors
						.map((e) => (typeof e === 'string' ? e : JSON.stringify(e)))
						.join('; ');
					throw new NodeOperationError(this.getNode(), `xberg extraction failed: ${message}`, {
						itemIndex: i,
					});
				}

				const document = result.results?.[0];
				if (!document) {
					throw new NodeOperationError(
						this.getNode(),
						'xberg returned no extraction result for this document',
						{ itemIndex: i },
					);
				}

				const text = document.content ?? '';

				// Step 2: call the model directly — plain chat, no format constraint.
				// Ask it to return JSON matching the schema; parse the reply ourselves.
				const schemaStr = JSON.stringify(schema, null, 2);
				const descriptionLine = schemaDescription
					? `\n\nContext: ${schemaDescription}`
					: '';
				const prompt =
					`Extract fields from the document text below and return ONLY a JSON object ` +
					`that matches this JSON Schema — no markdown fences, no explanation, just the JSON.` +
					descriptionLine +
					`\n\nJSON Schema:\n${schemaStr}` +
					`\n\nDocument text:\n${text}`;

				const parseAndValidate = (raw: string): { fields: IDataObject; errors: string[] } => {
					const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
					const parsed = JSON.parse(stripped) as IDataObject;
					return { fields: parsed, errors: collectErrors(parsed, schema as SchemaObject, '') };
				};

				const rawResponse = await callChatCompletion(this, i, prompt);

				let fields: IDataObject;
				try {
					const first = parseAndValidate(rawResponse);
					if (first.errors.length === 0) {
						fields = first.fields;
					} else {
						// Output-fixing pass: send the errors back so the model can correct them.
						const repairPrompt =
							`Your previous response did not match the required JSON Schema. ` +
							`Fix the following errors and return ONLY the corrected JSON object — ` +
							`no markdown fences, no explanation.\n\n` +
							`Errors:\n${first.errors.join('\n')}\n\n` +
							`Your previous response:\n${rawResponse}\n\n` +
							`JSON Schema:\n${schemaStr}`;
						const repairResponse = await callChatCompletion(this, i, repairPrompt);
						const second = parseAndValidate(repairResponse);
						if (second.errors.length > 0) {
							throw new NodeOperationError(
								this.getNode(),
								`Model response still does not match the JSON Schema after repair attempt:\n${second.errors.join('\n')}`,
								{ itemIndex: i },
							);
						}
						fields = second.fields;
					}
				} catch (error) {
					if (error instanceof NodeOperationError) throw error;
					throw new NodeOperationError(
						this.getNode(),
						`Model returned invalid JSON. Raw response: ${rawResponse.slice(0, 500)}`,
						{ itemIndex: i },
					);
				}

				const json: IDataObject = {
					fields,
					text,
					pageCount: document.counts?.pages ?? null,
					extractionMethod: document.extractionMethod ?? null,
					mimeType: document.mimeType ?? 'application/pdf',
				};

				returnData.push({
					json,
					pairedItem: { item: i },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}

				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
