# Nexo Atlântico: the document package

This package is a synthetic People Operations estate. Every name, identifier, contact, value, rule, and event was created for the challenge. Email addresses use `.invalid` and receive no real traffic. The source documents themselves are in Portuguese, like the production estate they mirror.

The envelope preserves the scale and structure of the production problem:

- 22 delivered files;
- 34 normalized sources;
- 13 FAQ categories and 269 citable rows;
- over 600,000 characters of synthetic source text, with lengths deliberately different from the production material;
- PDF, DOCX, XLSX, and PPTX origins;
- three reviewed OCR extractions.

The material is difficult on purpose. There are approved, pending, and rejected sources; regional rules; internal documents; high-sensitivity content; noisy extraction; untrusted instructions; and an incomplete operational record. Finding similar-looking text is not enough to conclude it can support an answer.

The PDF, DOCX, XLSX, and PPTX binaries are not distributed. The challenge starts at the extracted text and keeps format, extraction-mode, and OCR-review metadata so the focus stays on governed decisions, evidence, and human handoff.

Supporting files:

- `client-discovery/`: semantic reconstruction of the sessions, metrics, perspectives, and synthetic journeys used to diagnose the client problem; never usable as answer evidence.
- `client-discovery/admission-case-snapshot.json`: a synthetic, unlabeled operational state for analyzing dependencies and exceptions; never usable as answer evidence.
- `delivery-files.json`: the mapping between the 22 received files and the 34 normalized sources.
- `manifest.json`: inventory and governance metadata.
- `source-documents.json`: generated artifact with the content and SHA-256 of every source.
- `registry/source-registry.partial.csv`: a deliberately incomplete export of the operational catalog.
- `actors/profiles.json`: synthetic requester profiles.
- `operations/human-handoff-policy.json`: queues, reason codes, and human service levels.

No file in this package contains a test case, expected decision, target answer, or expected citation.

The discovery packet describes the business. Only `source-documents.json` may support a claim addressed to an employee.
