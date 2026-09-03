#!/usr/bin/env node
/**
 * Builds Word versions of the delivery documents from their markdown sources,
 * so the agreement can be edited as markdown and handed to a lawyer as .docx.
 *
 *   npm install --no-save docx
 *   node scripts/delivery-docx.mjs [outDir]
 *
 * Output (default ./dist/delivery):
 *   heskem-mesira-shlav-a.docx   agreement + appendices B, C, D  (goes to the client)
 *   doch-raayot.docx             evidence report                 (internal)
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, WidthType, BorderStyle, ShadingType, PageBreak,
} from 'docx';

const FONT = 'Arial';           // ships with Hebrew coverage everywhere
const PAGE_W = 11906;           // A4 width in DXA
const MARGIN = 1134;            // 2cm
const CONTENT_W = PAGE_W - MARGIN * 2;

const rtl = { bidirectional: true, alignment: AlignmentType.RIGHT };

/** Split a line into bold / code / plain runs. */
function runs(text, base = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), font: FONT, ...base }));
    const tok = m[0];
    if (tok.startsWith('**')) {
      out.push(new TextRun({ text: tok.slice(2, -2), font: FONT, bold: true, ...base }));
    } else {
      out.push(new TextRun({ text: tok.slice(1, -1), font: 'Courier New', size: 19, ...base }));
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), font: FONT, ...base }));
  return out.length ? out : [new TextRun({ text: '', font: FONT, ...base })];
}

const clean = (s) => s.replace(/<br\s*\/?>/gi, ' ').replace(/&rlm;/g, '').trim();

function heading(text, level) {
  const sizes = { 1: 34, 2: 26, 3: 22 };
  return new Paragraph({
    ...rtl,
    heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
    spacing: { before: level === 1 ? 0 : 280, after: 120 },
    children: runs(clean(text)).map(() => null) && [
      new TextRun({ text: clean(text).replace(/\*\*/g, ''), font: FONT, bold: true, size: sizes[level] || 22 }),
    ],
    border: level === 2
      ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999', space: 4 } }
      : undefined,
  });
}

function table(rows) {
  const cols = Math.max(...rows.map((r) => r.length));
  const colW = Math.floor(CONTENT_W / cols);
  const widths = Array(cols).fill(colW);
  widths[cols - 1] = CONTENT_W - colW * (cols - 1);

  return new Table({
    visuallyRightToLeft: true,
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: widths,
    rows: rows.map((cells, ri) =>
      new TableRow({
        tableHeader: ri === 0,
        children: Array.from({ length: cols }, (_, ci) =>
          new TableCell({
            width: { size: widths[ci], type: WidthType.DXA },
            shading: ri === 0 ? { type: ShadingType.CLEAR, fill: 'EEEEEE' } : undefined,
            margins: { top: 60, bottom: 60, left: 90, right: 90 },
            children: [new Paragraph({
              ...rtl,
              spacing: { before: 20, after: 20 },
              children: runs(clean(cells[ci] ?? ''), { size: 19, bold: ri === 0 }),
            })],
          })),
      })),
  });
}

function parse(md) {
  const lines = md.split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();

    if (!t) { i++; continue; }

    // horizontal rule
    if (/^-{3,}$/.test(t)) {
      out.push(new Paragraph({
        ...rtl, spacing: { before: 160, after: 160 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'BBBBBB', space: 2 } },
        children: [new TextRun({ text: '', font: FONT })],
      }));
      i++; continue;
    }

    // heading
    const h = t.match(/^(#{1,4})\s+(.*)$/);
    if (h) { out.push(heading(h[2], Math.min(h[1].length, 3))); i++; continue; }

    // table
    if (t.startsWith('|') && lines[i + 1] && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const rows = [];
      const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      rows.push(cells(lines[i])); i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(cells(lines[i])); i++; }
      out.push(table(rows));
      out.push(new Paragraph({ ...rtl, spacing: { after: 140 }, children: [new TextRun({ text: '', font: FONT })] }));
      continue;
    }

    // blockquote (may span lines)
    if (t.startsWith('>')) {
      const buf = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        buf.push(lines[i].trim().replace(/^>\s?/, '')); i++;
      }
      out.push(new Paragraph({
        ...rtl,
        spacing: { before: 140, after: 140 },
        indent: { right: 260 },
        border: { right: { style: BorderStyle.SINGLE, size: 12, color: '888888', space: 8 } },
        children: runs(clean(buf.join(' ')), { italics: true, color: '444444' }),
      }));
      continue;
    }

    // list item
    const li = t.match(/^(?:[-*]|\d+\.)\s+(.*)$/);
    if (li) {
      out.push(new Paragraph({
        ...rtl, spacing: { after: 60 }, indent: { right: 360 },
        children: [new TextRun({ text: '• ', font: FONT }), ...runs(clean(li[1]))],
      }));
      i++; continue;
    }

    // fenced block — keep verbatim, LTR
    if (t.startsWith('```')) {
      i++;
      const buf = [];
      while (i < lines.length && !lines[i].trim().startsWith('```')) { buf.push(lines[i]); i++; }
      i++;
      for (const b of buf) {
        out.push(new Paragraph({
          bidirectional: false, alignment: AlignmentType.LEFT, spacing: { after: 0 },
          children: [new TextRun({ text: b || ' ', font: 'Courier New', size: 18 })],
        }));
      }
      out.push(new Paragraph({ ...rtl, spacing: { after: 140 }, children: [new TextRun({ text: '', font: FONT })] }));
      continue;
    }

    // paragraph — gather until blank line or a new block starts
    const buf = [];
    while (i < lines.length) {
      const c = lines[i].trim();
      if (!c || c.startsWith('|') || c.startsWith('>') || c.startsWith('#')
          || /^-{3,}$/.test(c) || /^(?:[-*]|\d+\.)\s/.test(c) || c.startsWith('```')) break;
      buf.push(c); i++;
    }
    if (buf.length) {
      out.push(new Paragraph({ ...rtl, spacing: { after: 140 }, children: runs(clean(buf.join(' '))) }));
    }
  }
  return out;
}

async function build(sources, outFile, title) {
  const children = [];
  sources.forEach((src, n) => {
    if (n) children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(...parse(fs.readFileSync(src, 'utf8')));
  });

  const doc = new Document({
    creator: 'Imagick',
    title,
    styles: { default: { document: { run: { font: FONT, size: 22 }, paragraph: { spacing: { line: 300 } } } } },
    sections: [{
      properties: { page: { margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } } },
      children,
    }],
  });

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, await Packer.toBuffer(doc));
  console.log('wrote', outFile);
}

const outDir = process.argv[2] || 'dist/delivery';
const d = 'docs/delivery/';
await build(
  [d + 'delivery-agreement-phase1.md', d + 'appendix-b-c-scope.md', d + 'appendix-d-change-control.md'],
  path.join(outDir, 'heskem-mesira-shlav-a.docx'),
  'הסכם מסירה שלב א',
);
await build([d + 'evidence-report.md'], path.join(outDir, 'doch-raayot.docx'), 'דוח ראיות');
