import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

const FETCH_TIMEOUT_MS = 30_000;
const MAX_SUMMARY_INPUT = 6000;

function stripHtmlTags(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Fetch a URL and extract the main article content using Readability.
 * Falls back to raw stripped HTML if Readability fails.
 */
export async function fetchAndExtract(url) {
  try {
    new URL(url);
  } catch {
    return { error: `无效的 URL: ${url}`, title: '', textContent: '', excerpt: '', siteName: '' };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html, application/xhtml+xml, */*',
      },
    });
    clearTimeout(timer);

    if (!response.ok) {
      return { error: `HTTP ${response.status} ${response.statusText}`, title: '', textContent: '', excerpt: '', siteName: '' };
    }

    const html = await response.text();

    try {
      const dom = new JSDOM(html, { url });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();

      if (article && article.textContent && article.textContent.trim().length > 50) {
        return {
          title: article.title || '',
          content: article.content || '',
          textContent: article.textContent || '',
          excerpt: article.excerpt || '',
          siteName: article.siteName || '',
          error: null,
        };
      }
    } catch {
      // Readability failed, fall through to raw strip
    }

    const rawText = stripHtmlTags(html);
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return {
      title: titleMatch ? stripHtmlTags(titleMatch[1]).slice(0, 200) : '',
      content: '',
      textContent: rawText.slice(0, 50_000),
      excerpt: rawText.slice(0, 300),
      siteName: '',
      error: null,
    };
  } catch (e) {
    if (e.name === 'AbortError') {
      return { error: `请求超时 (${FETCH_TIMEOUT_MS / 1000}s)`, title: '', textContent: '', excerpt: '', siteName: '' };
    }
    return { error: `网络请求失败: ${e.message}`, title: '', textContent: '', excerpt: '', siteName: '' };
  }
}

/**
 * Summarize extracted content using the configured LLM.
 * Returns empty string on failure (best-effort, never throws).
 */
export async function summarizeContent(text) {
  if (!text || text.trim().length < 100) return '';

  try {
    const { createSummaryModel } = await import('./llm.js');
    const model = createSummaryModel();
    const truncated = text.slice(0, MAX_SUMMARY_INPUT);
    const result = await model.invoke([
      { role: 'system', content: '你是一个知识管理助手。用户会给你一段网页正文，请用中文总结核心要点，200字以内。只输出总结内容，不要任何前缀。' },
      { role: 'user', content: truncated },
    ]);
    return typeof result?.content === 'string' ? result.content.trim() : String(result?.content || '').trim();
  } catch {
    return '';
  }
}
