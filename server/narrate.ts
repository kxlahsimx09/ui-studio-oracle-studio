// Gemini "narrate" for the message Reader's "เล่าเรื่อง" button: retell the whole
// message as a natural, spoken podcast-style narration (NOT verbatim) that's then
// fed to TTS. Server-side so the Google AI key never reaches the browser. Reuses
// the same key + model resolution as the summariser. Model: GEMINI_MODEL.
import { geminiKey } from './summarize';

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

export async function narrate(text: string): Promise<{ narration?: string; error?: string }> {
  const key = geminiKey();
  if (!key) return { error: 'no Google AI key — put it in ~/.fleet-town/gemini.key (one line) or set GEMINI_API_KEY' };
  const t = (text || '').slice(0, 30000).trim();
  if (!t) return { error: 'nothing to narrate' };
  // Output language follows the source (any Thai → Thai), so the narration matches
  // what the operator wants read aloud.
  const lang = /[฀-๿]/.test(t) ? 'Thai (ภาษาไทย)' : 'English';
  const prompt = [
    `You are a friendly tech-podcast host. Retell the message below as a natural, flowing spoken NARRATION — like telling the story to a developer friend, from the start.`,
    `Do NOT read it back word-for-word: explain what's going on, weave the details into a smooth narrative, and make it pleasant to listen to.`,
    `Keep the real technical substance (what was done, what broke, what's next) but in a conversational voice.`,
    `Respond in ${lang}. It will be read aloud by a TTS voice, so use plain spoken words, no markdown, no headings, no bullet points, no emoji.`,
    `Keep it under ~1500 characters (about a 1–2 minute listen). Output ONLY the narration.`,
    `\n---\n${t}`,
  ].join('\n');
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          // thinkingBudget 0 → no hidden "thinking" tokens eating the output budget.
          generationConfig: { temperature: 0.7, maxOutputTokens: 1500, thinkingConfig: { thinkingBudget: 0 } },
        }),
      },
    );
    const j = await res.json().catch(() => ({})) as {
      error?: { message?: string };
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    if (!res.ok) return { error: j?.error?.message || `gemini ${res.status}` };
    const out = (j?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
    return out ? { narration: out } : { error: 'Gemini returned no narration (content filtered?)' };
  } catch (e) { return { error: (e as Error).message }; }
}
