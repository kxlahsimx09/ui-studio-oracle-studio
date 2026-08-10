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

/** Google AI key — env GEMINI_API_KEY, else ~/.fleet-town/gemini.key. Shared by tts. */
export function geminiKey(): string {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  try { if (existsSync(KEY_FILE)) return readFileSync(KEY_FILE, 'utf8').trim(); } catch { /* */ }
  return '';
}
const apiKey = geminiKey;

export async function summarize(text: string): Promise<{ summary?: string; error?: string }> {
  const key = apiKey();
  if (!key) return { error: 'no Google AI key — put it in ~/.fleet-town/gemini.key (one line) or set GEMINI_API_KEY' };
  const t = (text || '').slice(0, 30000).trim();
  if (!t) return { error: 'nothing to summarise' };
  // Pick the OUTPUT language explicitly (any Thai → Thai), so the summary matches
  // what the operator wants read aloud — a "same language" hint alone is unreliable.
  const lang = /[฀-๿]/.test(t) ? 'Thai (ภาษาไทย)' : 'English';
  // The listener is the developer driving this agent fleet — summarise for an
  // engineer: lead with what was done / what broke / what's the next action, and
  // keep technical terms (file names, commands, errors) intact.
  const prompt = `You are briefing a software developer about one of their AI coding agents. Summarise the agent message below in 1–3 short, clear sentences for an engineer: focus on what was done, what's blocked or broken, and the next action. Keep technical terms, file names, and commands as-is. Respond in ${lang}. It will be read aloud, so use plain spoken words and no markdown. Output ONLY the summary.\n\n---\n${t}`;
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
