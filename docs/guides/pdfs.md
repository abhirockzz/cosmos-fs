# Guide: ingest PDFs

cosmos-fs indexes text, so PDFs are not searchable until their text is extracted. This guide
pulls the text out of each PDF in a folder, loads it, and explores it like any other folder.
It walks through the bundled sample at `examples/sample-pdfs/` (two Acme Widgets PDFs); swap
in your own folder wherever it appears.

**Prerequisite:** you can already ingest and explore a folder (see
[Index your own docs](../quickstarts/01-index-your-docs.md)).

Extraction is an edge step (cosmos-fs core stays text-only on purpose; see
[Concepts](../concepts.md)). This guide uses `pdftotext`, part of Poppler:

```bash
brew install poppler            # macOS
sudo apt-get install poppler-utils   # Debian/Ubuntu
```

## 1. Extract text from your PDFs

Convert each PDF to a `.txt` in an output folder. The `.txt` file name becomes the item's
key, so keep names meaningful:

```bash
mkdir -p extracted
for f in examples/sample-pdfs/*.pdf; do
  pdftotext -nopgbrk "$f" "extracted/$(basename "${f%.pdf}").txt"
done
ls extracted
```

```
pricing.txt
security.txt
```

`-nopgbrk` drops page-break markers so the extracted text stays clean. Add `-layout` if a
PDF has tables or columns you want preserved. To keep a folder structure (so keys read like
`guide/security.txt`), mirror the source subdirectories into `extracted/`.

## 2. Ingest the extracted text

```bash
cosmos-fs ingest extracted --namespace acme-pdfs
```

```
Ingested 2 items into docs/pages (namespace=acme-pdfs; cleared 0 existing).
```

## 3. Explore

The extracted pages now behave like any other documents. List them, find a topic, read one:

```bash
cosmos-fs --namespace acme-pdfs -c "ls"
```

```
pricing.txt
security.txt
```

```bash
cosmos-fs --namespace acme-pdfs -c "grep -rl 'SOC 2' ."
```

```
security.txt
```

```bash
cosmos-fs --namespace acme-pdfs -c "grep -rn 429 ."
```

```
pricing.txt:4:Exceeding your quota returns HTTP 429. Upgrade the plan or contact sales for Enterprise pricing.
```

```bash
cosmos-fs --namespace acme-pdfs -c "cat security.txt"
```

```
Acme Widgets Security
Acme Widgets encrypts all data at rest with AES-256 and in transit with TLS 1.2 or higher.
Acme is SOC 2 Type II certified. Audit reports are available on request under NDA.
Data residency: choose US or EU storage at account creation. Data never leaves the region.
```

## Extract with Python instead

If you prefer a script (or need per-page control), `pypdf` does the same without Poppler:

```python
from pypdf import PdfReader
from pathlib import Path

Path("extracted").mkdir(exist_ok=True)
for pdf in Path("examples/sample-pdfs").glob("*.pdf"):
    text = "\n".join(page.extract_text() or "" for page in PdfReader(str(pdf)).pages)
    Path("extracted", pdf.stem + ".txt").write_text(text)
```

Then `cosmos-fs ingest extracted --namespace acme-pdfs` as above.

## Notes

- **When the PDFs change**, re-run extraction and `cosmos-fs ingest`. Ingest is a full
  refresh of the namespace, so deletions and edits are mirrored.
- **Very large PDFs** are worth splitting into per-section text files (for example one file
  per chapter) so search hits point at a precise place rather than a 200-page document.
- **Scanned PDFs** hold images, not text; run OCR (for example `ocrmypdf`) before extraction.

## Next

- [Separate document sets with namespaces](namespaces.md) to keep PDF sets separate.
- `cosmos-fs --help` for the full command reference.
