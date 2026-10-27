import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { extract, ExtractInputKind } from '@xberg-io/xberg';
import type {
	ExtractionConfig,
	JsonValue,
	LlmConfig,
	OcrConfig,
	StructuredExtractionConfig,
} from '@xberg-io/xberg';

export class PdfVlmExtractor implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'PDF VLM Extractor',
		name: 'pdfVlmExtractor',
		icon: { light: 'file:pdfVlmExtractor.svg', dark: 'file:pdfVlmExtractor.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'OCR PDFs with a Vision Language Model and extract structured fields using xberg',
		defaults: {
			name: 'PDF VLM Extractor',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'xbergVlmApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Document',
						value: 'document',
					},
				],
				default: 'document',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['document'],
					},
				},
				options: [
					{
						name: 'OCR Extract Text',
						value: 'ocrText',
						description: 'Run VLM-based OCR on a PDF and return the extracted text',
						action: 'Ocr extract text from a pdf',
					},
					{
						name: 'Extract Fields',
						value: 'extractFields',
						description:
							'Run VLM-based OCR and extract fields described by a JSON Schema as structured JSON',
						action: 'Extract structured fields from a PDF',
					},
				],
				default: 'ocrText',
			},
			{
				displayName: 'Input Binary Field',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				required: true,
				placeholder: 'data',
				displayOptions: {
					show: {
						resource: ['document'],
					},
				},
				description:
					'Name of the input binary field that holds the PDF file to process',
			},
			{
				displayName: 'Model',
				name: 'model',
				type: 'string',
				default: '',
				placeholder: 'glm-ocr:latest',
				displayOptions: {
					show: {
						resource: ['document'],
					},
				},
				description:
					'Vision model to use. Leave empty to use the default model from the credential.',
			},
			// --- JSON Schema (Extract Fields only) ---
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
				displayOptions: {
					show: {
						resource: ['document'],
						operation: ['extractFields'],
					},
				},
				description:
					'JSON Schema describing the fields to extract. The VLM returns JSON matching this schema.',
			},
			// --- OCR options (both operations) ---
			{
				displayName: 'OCR Options',
				name: 'ocrOptions',
				type: 'collection',
				placeholder: 'Add OCR Option',
				default: {},
				displayOptions: {
					show: {
						resource: ['document'],
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
						description:
							'Custom prompt template for VLM OCR. Leave empty to use the xberg default. Supports the <code>{{ language }}</code> template variable.',
					},
					{
						displayName: 'Force OCR',
						name: 'forceOcr',
						type: 'boolean',
						default: true,
						description:
							'Whether to force OCR on every page instead of using any embedded PDF text layer',
					},
					{
						displayName: 'Languages',
						name: 'language',
						type: 'string',
						default: 'eng',
						placeholder: 'eng,deu',
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
						description: 'Per-request timeout for the VLM call, in seconds',
					},
				],
			},
			// --- Extraction options (Extract Fields only) ---
			{
				displayName: 'Extraction Options',
				name: 'extractionOptions',
				type: 'collection',
				placeholder: 'Add Extraction Option',
				default: {},
				displayOptions: {
					show: {
						resource: ['document'],
						operation: ['extractFields'],
					},
				},
				options: [
					{
						displayName: 'Custom Extraction Prompt',
						name: 'prompt',
						type: 'string',
						typeOptions: {
							rows: 4,
						},
						default: '',
						description:
							'Custom prompt template for field extraction. Leave empty to use the xberg default. Supports <code>{{ content }}</code>, <code>{{ schema }}</code>, <code>{{ schema_name }}</code>, and <code>{{ schema_description }}</code>.',
					},
					{
						displayName: 'Schema Description',
						name: 'schemaDescription',
						type: 'string',
						default: '',
						description: 'Optional description of the schema to help the VLM',
					},
					{
						displayName: 'Schema Name',
						name: 'schemaName',
						type: 'string',
						default: 'extracted_fields',
						description: 'Name passed to the LLM structured-output mode for this schema',
					},
					{
						displayName: 'Strict',
						name: 'strict',
						type: 'boolean',
						default: false,
						description:
							'Whether the output must exactly match the schema. Local models vary in how well they honor strict mode.',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const credentials = await this.getCredentials('xbergVlmApi');
		const credentialBaseUrl = credentials.baseUrl as string;
		const credentialApiKey = (credentials.apiKey as string) ?? '';
		const credentialModel = credentials.model as string;

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;
				const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
				const modelParam = this.getNodeParameter('model', i, '') as string;
				const ocrOptions = this.getNodeParameter('ocrOptions', i, {}) as IDataObject;

				// Resolve the PDF bytes from the item's binary data. A Node Buffer is a
				// Uint8Array, so it passes straight into xberg's `bytes` input.
				this.helpers.assertBinaryData(i, binaryPropertyName);
				const buffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);
				const binary = items[i].binary![binaryPropertyName];
				const fileName = binary.fileName;

				const model = modelParam !== '' ? modelParam : credentialModel;
				const apiKey = credentialApiKey !== '' ? credentialApiKey : undefined;

				const llm: LlmConfig = {
					model,
					baseUrl: credentialBaseUrl,
					apiKey,
					timeoutSecs: (ocrOptions.timeoutSecs as number) ?? 300,
					temperature: (ocrOptions.temperature as number) ?? 0,
				};

				const language = ((ocrOptions.language as string) ?? 'eng')
					.split(',')
					.map((lang) => lang.trim())
					.filter((lang) => lang.length > 0);

				const vlmPrompt = ocrOptions.vlmPrompt as string | undefined;

				const ocr: OcrConfig = {
					backend: 'vlm',
					vlmConfig: llm,
					language: language.length > 0 ? language : ['eng'],
					...(vlmPrompt ? { vlmPrompt } : {}),
				};

				// Build the optional structured-extraction config up front so the
				// ExtractionConfig below can be assembled in one immutable literal
				// (xberg's config interfaces are readonly).
				let structuredExtraction: StructuredExtractionConfig | undefined;
				if (operation === 'extractFields') {
					const schemaRaw = this.getNodeParameter('jsonSchema', i) as string | IDataObject;
					const extractionOptions = this.getNodeParameter(
						'extractionOptions',
						i,
						{},
					) as IDataObject;

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

					const prompt = extractionOptions.prompt as string | undefined;
					const schemaDescription = extractionOptions.schemaDescription as string | undefined;

					structuredExtraction = {
						schema,
						schemaName: (extractionOptions.schemaName as string) ?? 'extracted_fields',
						schemaDescription: schemaDescription || undefined,
						strict: (extractionOptions.strict as boolean) ?? false,
						prompt: prompt || undefined,
						llm,
					};
				}

				const config: ExtractionConfig = {
					forceOcr: (ocrOptions.forceOcr as boolean) ?? true,
					ocr,
					...(structuredExtraction ? { structuredExtraction } : {}),
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
					text: document.content ?? '',
					pageCount: document.counts?.pages ?? null,
					mimeType: document.mimeType ?? 'application/pdf',
				};

				if (operation === 'extractFields') {
					json.fields = (document.structuredOutput as IDataObject) ?? null;
				}

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

				// Wrap every failure (validation errors thrown above and native
				// xberg errors alike) into a typed NodeOperationError for n8n.
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
