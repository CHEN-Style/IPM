import { tool } from '@langchain/core/tools';
import { z } from 'zod';

const MAX_RESPONSE_SIZE = 200_000; // ~200 KB text
const FETCH_TIMEOUT_MS = 30_000;

export function createFetchWebTool() {
  return tool(
    async ({ url, maxLength }) => {
      try {
        new URL(url); // validate
      } catch {
        return `无效的 URL: ${url}`;
      }

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'IPM-Supervisor/1.0',
            'Accept': 'text/html, application/json, text/plain, */*',
          },
        });
        clearTimeout(timer);

        if (!response.ok) {
          return `HTTP ${response.status} ${response.statusText}`;
        }

        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('image') || contentType.includes('video') || contentType.includes('audio')) {
          return `该 URL 返回的是媒体内容 (${contentType})，无法以文本形式展示。`;
        }

        let text = await response.text();
        const limit = Math.min(maxLength || MAX_RESPONSE_SIZE, MAX_RESPONSE_SIZE);

        if (text.length > limit) {
          text = text.slice(0, limit) + `\n\n[... 截断, 原始长度 ${text.length} 字符]`;
        }

        if (contentType.includes('text/html')) {
          text = stripHtmlTags(text);
        }

        return text;
      } catch (e) {
        if (e.name === 'AbortError') return `请求超时 (${FETCH_TIMEOUT_MS / 1000}s)`;
        return `网络请求失败: ${e.message}`;
      }
    },
    {
      name: 'fetch_web',
      description: 'Fetch content from a URL. Returns text/HTML content (HTML tags stripped). Useful for web scraping, API calls, or downloading text data.',
      schema: z.object({
        url: z.string().min(1).describe('The URL to fetch'),
        maxLength: z.number().optional().describe('Max response length in characters (default 200000)'),
      }),
    },
  );
}

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
