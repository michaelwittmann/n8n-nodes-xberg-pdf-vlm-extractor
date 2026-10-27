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
import type {
	ExtractionConfig,
	JsonValue,
	OcrConfig,
	StructuredExtractionConfig,
} from '@xberg-io/xberg';

import {
	binaryPropertyNameProperty,
	buildOcrConfig,
	getLlmConfig,
	listModels,
	modelProperty,
	providerCredentials,
	providerProperty,
} from '../shared/xberg';

export class PdfFieldExtractor implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'PDF Field Extractor',
		name: 'pdfFieldExtractor',
		icon: { light: 'file:pdfFieldExtractor.svg', dark: 'file:pdfFieldExtractor.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["model"]}}',
		description:
			'Extract structured fields from a PDF against a JSON Schema. Expects a PDF that already has a text layer (e.g. from the PDF OCR node or a born-digital PDF); optionally falls back to VLM OCR when no text layer is present.',
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
					{
						displayName: 'Strict',
						name: 'strict',
						type: 'boolean',
						default: false,
						hint: 'On: force output to match the schema exactly (types and required fields). Some models follow strict mode better than others — turn off if extraction fails.',
						description:
							'Whether the output must exactly match the schema. Models vary in how well they honor strict mode.',
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
				const options = this.getNodeParameter('options', i, {}) as IDataObject;
				const ocrFallback = this.getNodeParameter('ocrFallback', i, false) as boolean;
				const ocrOptions = this.getNodeParameter('ocrOptions', i, {}) as IDataObject;

				this.helpers.assertBinaryData(i, binaryPropertyName);
				const buffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);
				const binary = items[i].binary![binaryPropertyName];
				const fileName = binary.fileName ?? 'document.pdf';

				// The LLM config is always needed for structured extraction. OCR tuning
				// options only apply when the OCR fallback is enabled.
				const llm = await getLlmConfig(this, i, ocrFallback ? ocrOptions : {});

				// Parse and validate the JSON Schema before calling into xberg so a
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

				const schemaDescription = (options.schemaDescription as string | undefined) || undefined;

				// No custom prompt is exposed: xberg's `prompt` fully *replaces* its
				// built-in default (there is no extend/append hook), so a partial prompt
				// would discard xberg's tuned template and misbehave. We always let the
				// default apply and shape extraction via the schema + description.
				const structuredExtraction: StructuredExtractionConfig = {
					schema,
					// xberg requires a schema name; it's an internal label for the LLM's
					// structured-output mode and not worth exposing, so we fix it.
					schemaName: 'extracted_fields',
					schemaDescription,
					strict: (options.strict as boolean) ?? false,
					llm,
				};

				// When the OCR fallback is off we pass no `ocr` config at all, so a PDF
				// with no text layer fails clearly instead of silently being OCR'd.
				// When it's on, xberg reuses any embedded layer and only OCRs when none
				// exists (unless Force OCR is set).
				let ocr: OcrConfig | undefined;
				let forceOcr = false;
				if (ocrFallback) {
					ocr = buildOcrConfig(llm, ocrOptions);
					forceOcr = (ocrOptions.forceOcr as boolean) ?? false;
				}

				const config: ExtractionConfig = {
					forceOcr,
					...(ocr ? { ocr } : {}),
					structuredExtraction,
				};

				const result = await extract(
					{
						kind: ExtractInputKind.Bytes,
						bytes: buffer,
						mimeType: 'application/pdf',
						filename: fileName,
					},
					config,
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

				const json: IDataObject = {
					fields: (document.structuredOutput as IDataObject) ?? null,
					text: document.content ?? '',
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
