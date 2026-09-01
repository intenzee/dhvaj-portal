/**
 * Convert the HTML produced by the in-app Word editor into a real .docx Blob
 * using the `docx` library. This is a content-faithful (not pixel-faithful)
 * round-trip: paragraphs, headings, bold/italic/underline, ordered & unordered
 * lists, and simple tables are preserved; exotic Word styling is normalized.
 *
 * The walk is deliberately defensive — any unexpected node degrades to plain
 * text rather than throwing, so a save never fails outright.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ISectionOptions,
} from 'docx';

const OL_REFERENCE = 'app-ordered-list';

interface InlineCtx {
  bold?: boolean;
  italics?: boolean;
  underline?: boolean;
}

const HEADING_FOR: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  h1: HeadingLevel.HEADING_1,
  h2: HeadingLevel.HEADING_2,
  h3: HeadingLevel.HEADING_3,
  h4: HeadingLevel.HEADING_4,
  h5: HeadingLevel.HEADING_5,
  h6: HeadingLevel.HEADING_6,
};

function tag(node: Node): string {
  return node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement).tagName.toLowerCase() : '';
}

/** Flatten an element's inline content into styled TextRuns. */
function inlineRuns(node: Node, ctx: InlineCtx = {}): TextRun[] {
  const runs: TextRun[] = [];
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? '';
      if (text.replace(/\s+/g, ' ').trim().length === 0 && text.indexOf(' ') === -1) {
        // Keep meaningful whitespace between words, drop pure indentation noise.
        if (text.includes(' ')) runs.push(new TextRun({ text: ' ' }));
        return;
      }
      runs.push(
        new TextRun({
          text: text.replace(/\s+/g, ' '),
          bold: ctx.bold,
          italics: ctx.italics,
          underline: ctx.underline ? {} : undefined,
        }),
      );
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const t = tag(child);
    if (t === 'br') {
      runs.push(new TextRun({ break: 1 }));
      return;
    }
    const next: InlineCtx = { ...ctx };
    if (t === 'strong' || t === 'b') next.bold = true;
    if (t === 'em' || t === 'i') next.italics = true;
    if (t === 'u' || t === 'ins') next.underline = true;
    runs.push(...inlineRuns(child, next));
  });
  return runs;
}

function paragraphFrom(node: Node, opts: { heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel] } = {}): Paragraph {
  const children = inlineRuns(node);
  return new Paragraph({
    children: children.length ? children : [new TextRun({ text: '' })],
    heading: opts.heading,
  });
}

function listParagraphs(listEl: Element, ordered: boolean): Paragraph[] {
  const out: Paragraph[] = [];
  listEl.childNodes.forEach((li) => {
    if (tag(li) !== 'li') return;
    const children = inlineRuns(li);
    out.push(
      new Paragraph({
        children: children.length ? children : [new TextRun({ text: '' })],
        ...(ordered
          ? { numbering: { reference: OL_REFERENCE, level: 0 } }
          : { bullet: { level: 0 } }),
      }),
    );
  });
  return out;
}

function tableFrom(tableEl: Element): Table {
  const rows: TableRow[] = [];
  const trs = tableEl.querySelectorAll('tr');
  trs.forEach((tr) => {
    const cells: TableCell[] = [];
    tr.querySelectorAll('th,td').forEach((td) => {
      const runs = inlineRuns(td);
      cells.push(
        new TableCell({
          children: [new Paragraph({ children: runs.length ? runs : [new TextRun({ text: '' })] })],
        }),
      );
    });
    if (cells.length) rows.push(new TableRow({ children: cells }));
  });
  if (!rows.length) {
    rows.push(new TableRow({ children: [new TableCell({ children: [new Paragraph('')] })] }));
  }
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

/** Walk the top-level block nodes of the editor HTML into docx block elements. */
function blocksFrom(container: HTMLElement): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = [];
  const pushInlineAsParagraph = (node: Node): void => {
    const runs = inlineRuns(node);
    if (runs.length) blocks.push(new Paragraph({ children: runs }));
  };

  container.childNodes.forEach((node) => {
    const t = tag(node);
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (text) blocks.push(new Paragraph({ children: [new TextRun({ text })] }));
      return;
    }
    if (t in HEADING_FOR) {
      blocks.push(paragraphFrom(node, { heading: HEADING_FOR[t] }));
    } else if (t === 'ul') {
      blocks.push(...listParagraphs(node as Element, false));
    } else if (t === 'ol') {
      blocks.push(...listParagraphs(node as Element, true));
    } else if (t === 'table') {
      blocks.push(tableFrom(node as Element));
    } else if (t === 'blockquote' || t === 'p' || t === 'div' || t === 'section' || t === 'article') {
      // Nested block containers: recurse so wrapped paragraphs aren't flattened away.
      const el = node as HTMLElement;
      const hasBlockChildren = Array.from(el.childNodes).some((c) =>
        ['p', 'div', 'ul', 'ol', 'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote'].includes(tag(c)),
      );
      if (hasBlockChildren) blocks.push(...blocksFrom(el));
      else blocks.push(paragraphFrom(node));
    } else if (t === 'hr') {
      blocks.push(
        new Paragraph({
          children: [new TextRun({ text: '' })],
          border: { bottom: { color: '999999', size: 6, style: BorderStyle.SINGLE, space: 1 } },
        }),
      );
    } else {
      // Unknown inline-ish element: keep its text.
      pushInlineAsParagraph(node);
    }
  });

  return blocks;
}

export async function htmlToDocxBlob(html: string): Promise<Blob> {
  let blocks: (Paragraph | Table)[];
  try {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    blocks = blocksFrom(doc.body);
  } catch {
    blocks = [];
  }
  // Never emit an empty document, and never let a parse quirk lose the text.
  if (!blocks.length) {
    const fallback = new DOMParser().parseFromString(html, 'text/html').body?.textContent ?? '';
    blocks = fallback
      .split(/\n{1,}/)
      .map((line) => new Paragraph({ children: [new TextRun({ text: line })] }));
    if (!blocks.length) blocks = [new Paragraph({ children: [new TextRun({ text: '' })] })];
  }

  const section: ISectionOptions = { properties: {}, children: blocks };
  const document = new Document({
    numbering: {
      config: [
        {
          reference: OL_REFERENCE,
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [section],
  });

  return Packer.toBlob(document);
}
