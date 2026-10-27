# Screenshot capture guide

The README references the images below. They aren't committed yet — capture
them from your local dev instance (`npm run dev` → http://localhost:5678) and
drop them in this folder with the exact filenames so the README picks them up.

A clean, readable screenshot: light theme, default zoom, crop tight to the
relevant panel (no OS chrome), export as PNG, keep width ≤ 1600px.

| Filename | What to capture |
| --- | --- |
| `nodes-panel.png` | The n8n **nodes panel** with "pdf" typed in search, showing **PDF OCR** and **PDF Field Extractor** with the package icon. Shows the icons + that both nodes are discoverable. |
| `workflow-canvas.png` | The imported example workflow on the canvas: **Read PDF from Disk → PDF OCR → PDF Field Extractor**. (Import `docs/example-workflow.json` first.) |
| `pdf-ocr-config.png` | The **PDF OCR** node open, showing Provider = Ollama, a Model chosen from the dropdown, and **Replace Existing Text Layer** on. |
| `pdf-ocr-output.png` | The PDF OCR node's **output** panel: the JSON (`text`, `pageCount`, `searchable: true`) and the binary PDF field. |
| `field-extractor-config.png` | The **PDF Field Extractor** node open, showing the **JSON Schema** field with the invoice schema and the **Options → Schema Description**. |
| `field-extractor-output.png` | The Field Extractor's **output** JSON with `fields` populated (e.g. invoiceNumber/total/date) and `extractionMethod`. |

Optional but nice:

| Filename | What to capture |
| --- | --- |
| `searchable-pdf-ctrlf.png` | The downloaded output PDF opened in a viewer with **Ctrl/Cmd+F** finding a word — proves the invisible text layer is searchable. |

After adding images, run `npm run build` isn't needed — they're docs only. Just
commit the PNGs alongside the README.
