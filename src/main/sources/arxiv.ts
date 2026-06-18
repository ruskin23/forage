import { FeedDate, ArxivEntry, DownloadResult } from '@shared/types';
import { XMLParser } from 'fast-xml-parser';
import { abortableSleep } from '../services/cancellation';

// Identify ourselves to arXiv. Their robots.txt advertises `Crawl-delay: 15`
// for unidentified `User-agent: *` clients, and prior incidents on this project
// have led to IP bans. A descriptive UA + contact mailto is the polite default.
const USER_AGENT = 'forage/0.1 (https://github.com/ruskin/forage; mailto:ruskin.patel23@gmail.com)';
const ARXIV_HEADERS: HeadersInit = { 'User-Agent': USER_AGENT };

interface ArxivPaper {
  arxivId: string;
  title: string;
  authors: string[];
  abstract: string | null;
  categories: string[];
  primaryCategory: string;
  published: string | null;
  pdfUrl: string | null;
}

interface FetchFeedResult {
  papers: ArxivPaper[];
  totalResults: number;
}

const ARXIV_FEED_URL = 'https://export.arxiv.org/api/query';
const ARXIV_SOURCE_URL = 'https://arxiv.org/e-print';
const PAGE_SIZE = 200;
const PAGE_DELAY_MS = 30_000;     // between paginated API queries
export const DOWNLOAD_DELAY_MS = 5_000;  // between e-print downloads (ToU: min 3s)

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  attributeNamePrefix: '@_',
});

function buildUrl(category: string, date: FeedDate, start: number = 0): string {
  const day = String(date.day).padStart(2, '0');
  const month = String(date.month).padStart(2, '0');
  const dateStr = `${date.year}${month}${day}`;

  const query = `cat:${category}+AND+submittedDate:[${dateStr}0000+TO+${dateStr}2359]`;

  return `${ARXIV_FEED_URL}?search_query=${query}&start=${start}&max_results=${PAGE_SIZE}&sortBy=submittedDate&sortOrder=ascending`;
}

function parseEntry(entry: ArxivEntry): ArxivPaper | null {
  const match = entry.id.match(/(\d{4}\.\d{4,5})/);
  if (!match) {
    return null
  };

  const authors = Array.isArray(entry.author) ? entry.author : [entry.author];
  const categories = Array.isArray(entry.category) ? entry.category : [entry.category];

  const pdfLink = Array.isArray(entry.link)
    ? entry.link.find((l) => l['@_title'] === 'pdf')
    : undefined;

  return {
    arxivId: match[1],
    title: entry.title?.trim() ?? '',
    authors: authors.map((a) => a.name),
    abstract: entry.summary?.trim() ?? null,
    categories: categories.map((c) => c['@_term']),
    primaryCategory: entry.primary_category?.['@_term'] ?? categories[0]?.['@_term'],
    published: entry.published?.slice(0, 10) ?? null,
    pdfUrl: pdfLink?.['@_href'] ?? null,
  };
}

export async function fetchFeed(category: string, date: FeedDate, signal: AbortSignal): Promise<FetchFeedResult> {
  let start = 0;
  let totalResults = Infinity;
  const allPapers: ArxivPaper[] = [];

  while (start < totalResults) {
    const url = buildUrl(category, date, start);
    const response = await fetch(url, { headers: ARXIV_HEADERS, signal });

    if (!response.ok) {
      throw new Error(`arXiv API error: HTTP ${response.status}`);
    }

    const xml = await response.text();
    const result = parser.parse(xml);

    totalResults = result.feed.totalResults ?? 0;

    const entries = result.feed.entry;
    if (!entries) break;

    const entryList = Array.isArray(entries) ? entries : [entries];

    for (const entry of entryList) {
      const paper = parseEntry(entry);
      if (paper) allPapers.push(paper);
    }

    start += PAGE_SIZE;

    if (start < totalResults) {
      await abortableSleep(PAGE_DELAY_MS, signal);
    }
  }

  return { papers: allPapers, totalResults };
}

const GZIP_MAGIC = [0x1f, 0x8b];

function detectSourceType(buffer: Buffer): 'TAR' | 'TEX' {
  if (buffer.length >= 2 && buffer[0] === GZIP_MAGIC[0] && buffer[1] === GZIP_MAGIC[1]) {
    return 'TAR';
  }
  return 'TEX';
}

export async function downloadSource(arxivId: string, pdfUrl: string | null, signal: AbortSignal): Promise<DownloadResult> {
  // Try e-print first
  try {
    const response = await fetch(`${ARXIV_SOURCE_URL}/${arxivId}`, { headers: ARXIV_HEADERS, signal });
    if (response.ok) {
      const buffer = Buffer.from(await response.arrayBuffer());
      return { buffer, sourceType: detectSourceType(buffer) };
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
  }

  // Fallback to PDF
  if (pdfUrl) {
    try {
      const response = await fetch(pdfUrl, { headers: ARXIV_HEADERS, signal });
      if (response.ok) {
        const buffer = Buffer.from(await response.arrayBuffer());
        return { buffer, sourceType: 'PDF' };
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
    }
  }

  // Both failed
  return { buffer: null, sourceType: null };
}

