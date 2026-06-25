// Gemini summariser for the message Reader's "Summary" button. Server-side so the
// Google AI key never reaches the browser. Key resolution (first hit wins):
//   1. env GEMINI_API_KEY
//   2. file ~/.fleet-town/gemini.key   (one line — the easiest place to drop it)
// Model overridable via GEMINI_MODEL (default gemini-2.0-flash).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const KEY_FILE = join(homedir(), '.fleet-town', 'gemini.key');
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

function apiKey(): string {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  try { if (existsSync(KEY_FILE)) return readFileSync(KEY_FILE, 'utf8').trim(); } catch { /* */ }
  return '';
}

export async function summarize(text: string): Promise<{ summary?: string; error?: string }> {
  const key = apiKey();
  if (!key) return { error: 'no Google AI key — put it in ~/.fleet-town/gemini.key (one line) or set GEMINI_API_KEY' };
  const t = (text || '').slice(0, 30000).trim();
  if (!t) return { error: 'nothing to summarise' };
  const prompt = `Summarise the message below in 1–2 short, clear sentences, in the SAME language as the message (Thai or English). It will be read aloud, so use plain words and no markdown. Output ONLY the summary.\n\n---\n${t}`;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          // thinkingBudget 0 → no hidden "thinking" tokens eating the output budget
          // (2.5-flash), so the short summary comes out complete.
          generationConfig: { temperature: 0.2, maxOutputTokens: 400, thinkingConfig: { thinkingBudget: 0 } },
        }),
      },
    );
    const j = await res.json().catch(() => ({})) as {
      error?: { message?: string };
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    if (!res.ok) return { error: j?.error?.message || `gemini ${res.status}` };
    const out = (j?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
    return out ? { summary: out } : { error: 'Gemini returned no summary (content filtered?)' };
  } catch (e) { return { error: (e as Error).message }; }
}
