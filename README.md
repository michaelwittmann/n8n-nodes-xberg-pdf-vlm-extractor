# n8n-nodes-xberg-pdf-vlm-extractor

An [n8n](https://n8n.io) community node that runs **Vision Language Model (VLM) OCR** on PDF files and **extracts structured fields** from them, powered by the [`@xberg-io/xberg`](https://www.npmjs.com/package/@xberg-io/xberg) document-extraction library.

The node sends each page of a PDF to a vision model through an OpenAI-compatible endpoint (local [Ollama](https://ollama.com), vLLM, OpenAI, etc.) and returns the transcribed text — or, with a JSON Schema you provide, the fields you care about as structured JSON.

> **Self-hosted only.** This package has a runtime dependency (`@xberg-io/xberg` ships platform-specific native binaries), so it is **not eligible for n8n Cloud verification**. It installs and runs on self-hosted n8n.

## Features

- **OCR Extract Text** — VLM-based OCR of an incoming PDF, returning the full text, page count, and MIME type.
- **Extract Fields** — the same OCR pass plus schema-driven extraction: supply a JSON Schema describing the fields you want and get back matching JSON. Optionally override the extraction prompt.
- Model is configurable per node, falling back to a default stored in the credential.
- OCR tuning: force OCR, OCR languages, custom OCR prompt, request timeout, and temperature.

## Installation

Follow the [n8n community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation-and-management/).

In your self-hosted n8n: **Settings → Community Nodes → Install**, then enter:

```
n8n-nodes-xberg-pdf-vlm-extractor
```

Or install from the command line in your n8n custom-nodes directory:

```bash
npm install n8n-nodes-xberg-pdf-vlm-extractor
```

## Prerequisites

- **Node.js >= 22** (required by `@xberg-io/xberg`).
- An **OpenAI-compatible VLM endpoint** with a vision model available.

For a local setup with Ollama:

```bash
ollama pull glm-ocr:latest          # or any vision model, e.g. llama3.2-vision
curl http://localhost:11434/v1/models   # confirm the OpenAI-compatible API is up
```

## Credentials

Create an **Xberg VLM API** credential:

| Field | Description | Example |
| --- | --- | --- |
| **Base URL** | OpenAI-compatible endpoint. The `/v1` suffix is required for Ollama. | `http://localhost:11434/v1` |
| **API Key** | API key for the endpoint. Leave empty for a local Ollama server. | *(empty)* |
| **Default Model** | Vision model used when the node's Model field is empty. | `glm-ocr:latest` |

The credential's **test** lists models on the endpoint, so you get immediate feedback if the URL or key is wrong.

## Operations

### OCR Extract Text

1. Feed a PDF into the node as binary data (e.g. from a **Read/Write Files from Disk** or **HTTP Request** node). The default binary field name is `data`.
2. Select **Document → OCR Extract Text**.
3. Output:

   ```json
   {
     "text": "…full transcribed text…",
     "pageCount": 3,
     "mimeType": "application/pdf"
   }
   ```

### Extract Fields

1. Provide the PDF binary as above.
2. Select **Document → Extract Fields**.
3. In **JSON Schema**, describe the fields you want:

   ```json
   {
     "type": "object",
     "properties": {
       "invoiceNumber": { "type": "string" },
       "total": { "type": "number" },
       "date": { "type": "string" }
     },
     "required": ["invoiceNumber"]
   }
   ```

4. Output adds a `fields` object matching your schema:

   ```json
   {
     "text": "…",
     "pageCount": 3,
     "mimeType": "application/pdf",
     "fields": { "invoiceNumber": "INV-042", "total": 199.9, "date": "2026-10-27" }
   }
   ```

### Options

**OCR Options** (both operations): Force OCR, Languages (comma-separated ISO codes, e.g. `eng,deu`), Custom OCR Prompt, Timeout (seconds), Temperature.

**Extraction Options** (Extract Fields): Schema Name, Schema Description, Strict mode, Custom Extraction Prompt.

> **Tip:** OCR-oriented models (like `glm-ocr`) are great at transcription but may extract fields less reliably in strict mode. For field extraction, a general vision model (e.g. `llama3.2-vision`) can work better. `Strict` defaults to off; adjust the custom prompt as needed.

## Local development

```bash
npm install
npm run build        # compile TypeScript to dist/
npm run lint         # lint
npm run dev          # start a local n8n with the node hot-reloaded (http://localhost:5678)
```

`npm run dev` ([docs](https://docs.n8n.io/integrations/creating-nodes/test/run-node-locally/)) is the local test environment — no separate n8n instance is required. From n8n 3.0+ it runs in a container by default; if your Ollama runs on the host, point the credential Base URL at `http://host.docker.internal:11434/v1` (or `host.containers.internal` for Podman). To run against an existing host n8n instead:

```bash
N8N_DEV_RELOAD=true npx n8n start
n8n-node dev --external-n8n --custom-user-folder <path>
```

## Compatibility

- Requires Node.js >= 22.
- Built and tested against `n8n-workflow` 2.x and `@xberg-io/xberg` 1.3.x.

## License

[MIT](LICENSE)
