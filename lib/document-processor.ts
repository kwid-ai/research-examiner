/**
 * Document processor: extracts raw text from PDF and DOCX files,
 * then attempts to locate common research paper sections via regex.
 */

export interface DocumentData {
  fullText: string;
  sections: Record<string, string>;
  wordCount: number;
  filename: string;
}

const SECTION_PATTERNS: Record<string, RegExp> = {
  abstract: /(?:^|\n)\s*(?:#{1,3}\s*)?abstract\s*\n/i,
  introduction: /(?:^|\n)\s*(?:#{1,3}\s*)?(?:introduction|background)\s*\n/i,
  literature_review:
    /(?:^|\n)\s*(?:#{1,3}\s*)?(?:literature\s+review|related\s+work|theoretical\s+framework|prior\s+work)\s*\n/i,
  methodology:
    /(?:^|\n)\s*(?:#{1,3}\s*)?(?:method(?:ology)?|research\s+(?:methodology|design))\s*\n/i,
  results:
    /(?:^|\n)\s*(?:#{1,3}\s*)?(?:results?|findings?|data\s+analysis|analysis)\s*\n/i,
  discussion: /(?:^|\n)\s*(?:#{1,3}\s*)?(?:discussion|interpretation)\s*\n/i,
  conclusion: /(?:^|\n)\s*(?:#{1,3}\s*)?(?:conclusions?|summary)\s*\n/i,
  references:
    /(?:^|\n)\s*(?:#{1,3}\s*)?(?:references?|bibliography|works\s+cited)\s*\n/i,
};

function detectSections(text: string): Record<string, string> {
  const anchors: Array<{ name: string; index: number }> = [];

  for (const [name, pattern] of Object.entries(SECTION_PATTERNS)) {
    const match = pattern.exec(text);
    if (match) {
      anchors.push({ name, index: match.index });
    }
  }

  if (anchors.length === 0) {
    // No structure detected — return full text for every section
    return Object.fromEntries(
      Object.keys(SECTION_PATTERNS).map((k) => [k, text])
    );
  }

  anchors.sort((a, b) => a.index - b.index);
  const sections: Record<string, string> = {};

  for (let i = 0; i < anchors.length; i++) {
    const start = anchors[i].index;
    const end =
      i + 1 < anchors.length ? anchors[i + 1].index : text.length;
    sections[anchors[i].name] = text.slice(start, end).trim();
  }

  // Fill missing sections with full text so agents always have context
  for (const name of Object.keys(SECTION_PATTERNS)) {
    if (!sections[name]) sections[name] = text;
  }

  return sections;
}

export async function processDocument(
  buffer: Buffer,
  filename: string
): Promise<DocumentData> {
  const lower = filename.toLowerCase();
  let fullText = "";

  if (lower.endsWith(".pdf")) {
    // Dynamic require avoids Next.js build-time resolution of test files
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require("pdf-parse/lib/pdf-parse");
    const result = await pdfParse(buffer);
    fullText = result.text ?? "";
  } else if (lower.endsWith(".docx") || lower.endsWith(".doc")) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mammoth = require("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    fullText = result.value ?? "";
  } else {
    throw new Error(
      `Unsupported file type. Please upload a PDF or DOCX file.`
    );
  }

  fullText = fullText.trim();
  const sections = detectSections(fullText);
  const wordCount = fullText.split(/\s+/).filter(Boolean).length;

  return { fullText, sections, wordCount, filename };
}

/** Truncate a string to `limit` characters, appending a note if cut. */
export function trunc(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + "\n\n[... truncated for length ...]";
}
