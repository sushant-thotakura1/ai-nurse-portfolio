import path from 'path';
import { readFile } from 'fs/promises';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { logger } from '../core/logger';

/**
 * Extracts plain text from an uploaded knowledge-base document.
 *
 * Uses standalone parsers (pdf-parse, mammoth, xlsx) rather than the
 * `@langchain/community` fs loaders — those need extra peer deps
 * (`d3-dsv`, `@langchain/classic` subpaths) that aren't installed and fail
 * at runtime.
 */
export class DocumentLoaderService {
  async extractText(filePath: string, originalName: string): Promise<string> {
    const ext = path.extname(originalName).toLowerCase();
    logger.info('Extracting text from document', { filePath, originalName, ext });
    try {
      let text: string;
      switch (ext) {
        case '.pdf': {
          const buf = await readFile(filePath);
          const parser = new PDFParse({ data: new Uint8Array(buf) });
          try {
            text = (await parser.getText()).text;
          } finally {
            await parser.destroy();
          }
          break;
        }
        case '.docx': {
          text = (await mammoth.extractRawText({ path: filePath })).value;
          break;
        }
        case '.csv':
        case '.xlsx':
        case '.xls': {
          // xlsx parses .csv too — one path, no fragile langchain CSV loader dep.
          const wb = XLSX.readFile(filePath);
          const sheets = wb.SheetNames.map((name) => {
            const rows = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
            // A single-sheet CSV needs no "## Sheet1" header; multi-sheet does.
            return wb.SheetNames.length > 1 ? `## ${name}\n${rows}` : rows;
          });
          text = sheets.join('\n\n');
          break;
        }
        case '.txt':
        case '.md': {
          text = await readFile(filePath, 'utf-8');
          break;
        }
        default:
          throw new Error(`Unsupported file type: ${ext}`);
      }
      if (!text.trim()) {
        throw new Error(`No extractable text found in file: ${originalName}`);
      }
      logger.info('Text extraction complete', { originalName, textLength: text.length });
      return text;
    } catch (err) {
      logger.error('Text extraction failed', { originalName, ext, err: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }
}
