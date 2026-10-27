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
import type { ExtractionConfig, PageContent } from '@xberg-io/xberg';

import {
	binaryPropertyNameProperty,
	buildOcrConfig,
	getLlmConfig,
	listModels,
	modelProperty,
	ocrOptionsProperty,
	providerCredentials,
	providerProperty,
} from '../shared/xberg';
import { buildSearchablePdf } from '../shared/searchablePdf';

export class PdfOcr implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'PDF OCR',
		name: 'pdfOcr',
		icon: { light: 'file:pdfOcr.svg', dark: 'file:pdfOcr.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["model"]}}',
		description:
			'OCR a PDF with a Vision Language Model (via Ollama) and output a searchable PDF with an embedded text layer',
		defaults: {
			name: 'PDF OCR',
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
				displayName: 'Replace Existing Text Layer',
				name: 'replaceTextLayer',
				type: 'boolean',
				default: true,
				hint: 'On: strip any text already in the PDF before adding the OCR layer, so you don’t get two overlapping layers. Off: keep the original text and add OCR on top.',
				description:
					'Whether to remove any text already embedded in the PDF before adding the OCR layer. Leave on to avoid duplicate/overlapping text on PDFs that already have a (possibly wrong) text layer. Turn off to keep the original text and append the OCR layer on top.',
			},
			ocrOptionsProperty,
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
				const replaceTextLayer = this.getNodeParameter('replaceTextLayer', i, true) as boolean;
				const ocrOptions = this.getNodeParameter('ocrOptions', i, {}) as IDataObject;

				// Resolve the PDF bytes from the item's binary data. A Node Buffer is a
				// Uint8Array, so it passes straight into xberg's `bytes` input.
				this.helpers.assertBinaryData(i, binaryPropertyName);
				const buffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);
				const binary = items[i].binary![binaryPropertyName];
				const fileName = binary.fileName ?? 'document.pdf';

				const llm = await getLlmConfig(this, i, ocrOptions);
				const ocr = buildOcrConfig(llm, ocrOptions);

				// Force OCR on every page and ask xberg for per-page content so we can
				// rebuild a searchable PDF page by page.
				const config: ExtractionConfig = {
					forceOcr: true,
					ocr,
					pages: { extractPages: true },
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

				const text = document.content ?? '';
				const pages = (document.pages ?? []) as PageContent[];

				const json: IDataObject = {
					text,
					pageCount: document.counts?.pages ?? pages.length ?? null,
					mimeType: 'application/pdf',
				};

				// Rebuild the PDF with an invisible OCR text layer so the output is
				// searchable. If pdf-lib can't process the source (encryption, exotic
				// structure), fall back to returning the original PDF plus the text in
				// JSON, flagging that no layer was embedded.
				const outName = ensurePdfExtension(fileName);
				let pdfBuffer: Buffer = Buffer.from(buffer);
				let searchable = false;

				if (pages.length > 0) {
					try {
						const rebuilt = await buildSearchablePdf(buffer, pages, replaceTextLayer);
						pdfBuffer = Buffer.from(rebuilt);
						searchable = true;
					} catch (pdfError) {
						json.warning = `Could not embed a searchable text layer; returning the original PDF. ${(pdfError as Error).message}`;
					}
				} else {
					json.warning =
						'xberg returned no per-page content; returning the original PDF without a searchable layer.';
				}

				json.searchable = searchable;

				const binaryData = await this.helpers.prepareBinaryData(
					pdfBuffer,
					outName,
					'application/pdf',
				);

				returnData.push({
					json,
					binary: { [binaryPropertyName]: binaryData },
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

				// Wrap every failure (validation errors thrown above and native xberg
				// errors alike) into a typed NodeOperationError for n8n.
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}

/** Ensure the output filename carries a `.pdf` extension. */
function ensurePdfExtension(fileName: string): string {
	return /\.pdf$/i.test(fileName) ? fileName : `${fileName.replace(/\.[^./]*$/, '')}.pdf`;
}
