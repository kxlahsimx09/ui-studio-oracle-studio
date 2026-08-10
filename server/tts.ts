// Gemini text-to-speech for the Reader's "read aloud" — natural neural voices,
// much better than the browser's robotic speech. Server-side so the key stays
// hidden. Returns base64 PCM (audio/L16 24kHz mono) + sample rate; the client
// wraps it in a WAV header and plays it. Model/voice overridable via env.
import { geminiKey } from './summarize';

const MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts';
// Curated natural-sounding prebuilt voices (the panel offers these).
export const TTS_VOICES = ['Kore', 'Puck', 'Zephyr', 'Charon', 'Aoede', 'Leda', 'Orus', 'Fenrir', 'Algieba', 'Sulafat'];

export async function tts(text: string, voice = 'Kore'): Promise<{ audio?: string; mime?: string; rate?: number; error?: string }> {
  const key = geminiKey();
  if (!key) return { error: 'no Google AI key — put it in ~/.fleet-town/gemini.key or set GEMINI_API_KEY' };
  const t = (text || '').trim();
  if (!t) return { error: 'nothing to read' };
  // TTS has a tight input budget; cap so a huge message degrades to the browser
  // voice on the client rather than erroring.
  if (t.length > 5000) return { error: 'too long for TTS (5000 chars)' };
  const v = TTS_VOICES.includes(voice) ? voice : 'Kore';
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          // A directive prefix forces audio-only — without it the TTS model
          // sometimes "tries to generate text" and errors. It speaks only the
          // transcript after the colon, not the directive.
          contents: [{ parts: [{ text: `Read aloud verbatim, in a natural voice: ${t}` }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: v } } },
          },
        }),
      },
    );
    const j = await res.json().catch(() => ({})) as {
      error?: { message?: string };
      candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[];
    };
    if (!res.ok) return { error: j?.error?.message || `gemini-tts ${res.status}` };
    const inline = (j?.candidates?.[0]?.content?.parts || []).map((p) => p.inlineData).find(Boolean);
    if (!inline?.data) return { error: 'no audio returned' };
    const rate = Number((inline.mimeType || '').match(/rate=(\d+)/)?.[1]) || 24000;
    return { audio: inline.data, mime: inline.mimeType, rate };
  } catch (e) { return { error: (e as Error).message }; }
}
