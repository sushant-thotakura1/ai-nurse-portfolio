import { DocumentLoaderService } from '../document-loader.service';

// Mock logger so tests don't produce console noise
jest.mock('../../core/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
  },
}));

const mockGetText = jest.fn();
const mockDestroy = jest.fn();
jest.mock('pdf-parse', () => ({
  PDFParse: jest.fn().mockImplementation(() => ({
    getText: mockGetText,
    destroy: mockDestroy,
  })),
}));

jest.mock('mammoth', () => ({
  extractRawText: jest.fn().mockResolvedValue({ value: 'DOCX content.' }),
}));

jest.mock('fs/promises', () => ({
  readFile: jest.fn().mockResolvedValue(Buffer.from('Plain text content.')),
}));

jest.mock('xlsx', () => ({
  readFile: jest.fn().mockReturnValue({
    SheetNames: ['Sheet1', 'Sheet2'],
    Sheets: { Sheet1: {}, Sheet2: {} },
  }),
  utils: {
    sheet_to_csv: jest.fn().mockReturnValue('a,b\n1,2'),
  },
}));

describe('DocumentLoaderService', () => {
  let service: DocumentLoaderService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetText.mockResolvedValue({ text: 'PDF page 1.\n\nPDF page 2.' });
    mockDestroy.mockResolvedValue(undefined);
    service = new DocumentLoaderService();
  });

  it('extracts text from a PDF file (via pdf-parse) and cleans up', async () => {
    const text = await service.extractText('/tmp/f.pdf', 'document.pdf');
    expect(text).toBe('PDF page 1.\n\nPDF page 2.');
    expect(mockDestroy).toHaveBeenCalled();
  });

  it('extracts text from a DOCX file (via mammoth)', async () => {
    const text = await service.extractText('/tmp/f.docx', 'document.docx');
    expect(text).toBe('DOCX content.');
  });

  it('extracts text from a CSV file (parsed via xlsx, no langchain CSV loader)', async () => {
    const text = await service.extractText('/tmp/f.csv', 'data.csv');
    expect(text).toContain('a,b');
  });

  it('extracts text from an XLSX file (multiple sheets)', async () => {
    const text = await service.extractText('/tmp/f.xlsx', 'data.xlsx');
    expect(text).toContain('## Sheet1');
    expect(text).toContain('## Sheet2');
    expect(text).toContain('a,b');
  });

  it('extracts text from an XLS file', async () => {
    const text = await service.extractText('/tmp/f.xls', 'data.xls');
    expect(text).toContain('## Sheet1');
    expect(text).toContain('a,b');
  });

  it('extracts text from a TXT file', async () => {
    const { readFile } = require('fs/promises');
    (readFile as jest.Mock).mockResolvedValueOnce('Plain text content.');
    const text = await service.extractText('/tmp/f.txt', 'notes.txt');
    expect(text).toBe('Plain text content.');
  });

  it('extracts text from a MD file', async () => {
    const { readFile } = require('fs/promises');
    (readFile as jest.Mock).mockResolvedValueOnce('Plain text content.');
    const text = await service.extractText('/tmp/f.md', 'readme.md');
    expect(text).toBe('Plain text content.');
  });

  it('throws on unsupported file extension', async () => {
    await expect(
      service.extractText('/tmp/f.exe', 'virus.exe')
    ).rejects.toThrow('Unsupported file type: .exe');
  });

  it('propagates loader errors', async () => {
    mockGetText.mockRejectedValueOnce(new Error('Corrupt file'));
    await expect(service.extractText('/tmp/f.pdf', 'bad.pdf')).rejects.toThrow('Corrupt file');
  });

  it('throws when extracted text is empty', async () => {
    mockGetText.mockResolvedValueOnce({ text: '   ' });
    await expect(service.extractText('/tmp/scan.pdf', 'scan.pdf')).rejects.toThrow(
      'No extractable text found'
    );
  });
});
