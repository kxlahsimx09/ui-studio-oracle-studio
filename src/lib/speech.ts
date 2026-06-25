// Shared speech helpers: parse transcript messages, Gemini summary, and natural
// Gemini TTS read-aloud (with a browser-voice fallback). Used by the message
// Reader and the agent window's outer Summary button.

export const VOICES = ['Kore', 'Puck', 'Zephyr', 'Charon', 'Aoede', 'Leda', 'Orus', 'Fenrir', 'Algieba', 'Sulafat'];
export const VOICE_KEY = 'town:tts-voice';
export const getVoice = () => { try { return localStorage.getItem(VOICE_KEY) || 'Kore'; } catch { return 'Kore'; } };

export interface Msg { who: string; text: string }

/** Split a rendered transcript on the "──────── 🤖 opus ────────" turn headers. */
export function parseMessages(transcript: string): Msg[] {
  const re = /──────── (.+?) ────────\n/g;
  const heads: { who: string; from: number; to: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(transcript)) !== null) heads.push({ who: m[1], from: m.index, to: re.lastIndex });
  const out: Msg[] = [];
  for (let i = 0; i < heads.length; i++) {
    const end = i + 1 < heads.length ? heads[i + 1].from : transcript.length;
    const text = transcript.slice(heads[i].to, end).trim();
    if (text) out.push({ who: heads[i].who, text });
  }
  return out;
}
export const latestMessage = (transcript: string): Msg | null => { const ms = parseMessages(transcript); return ms.length ? ms[ms.length - 1] : null; };

// Strip markdown / code / links / emoji / box-drawing so a voice reads cleanly.
export function cleanForSpeech(s: string): string {
  return (s || '')
    .replace(/```[\s\S]*?```/g, ' โค้ด. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ลิงก์ ')
    .replace(/[#>*_~`|]+/g, ' ')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{2500}-\u{257F}]/gu, ' ')
    .replace(/[️‍]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '. ')
    .trim();
}

export async function summarizeText(text: string): Promise<{ summary?: string; error?: string }> {
  const res = await fetch('/__fleet/summarize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
  return res.json().catch(() => ({ error: `summarize ${res.status}` }));
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function pcmToWav(pcm: Uint8Array, rate: number): Blob {
  const blockAlign = 2, byteRate = rate * blockAlign;
  const buf = new ArrayBuffer(44 + pcm.length);
  const dv = new DataView(buf);
  const ws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); dv.setUint32(4, 36 + pcm.length, true); ws(8, 'WAVE'); ws(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, byteRate, true); dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, 16, true); ws(36, 'data'); dv.setUint32(40, pcm.length, true);
  new Uint8Array(buf, 44).set(pcm);
  return new Blob([buf], { type: 'audio/wav' });
}

let currentAudio: HTMLAudioElement | null = null;
export function stopSpeech(): void {
  try { currentAudio?.pause(); currentAudio = null; } catch { /* */ }
  try { window.speechSynthesis?.cancel(); } catch { /* */ }
}

function browserSpeak(clean: string, onEnd?: () => void): void {
  const synth = window.speechSynthesis;
  if (!synth) { onEnd?.(); return; }
  synth.cancel();
  const u = new SpeechSynthesisUtterance(clean.slice(0, 32000));
  u.lang = /[฀-๿]/.test(clean) ? 'th-TH' : 'en-US';
  u.onend = () => onEnd?.(); u.onerror = () => onEnd?.();
  synth.speak(u);
}

/** Read text aloud — natural Gemini TTS, browser-voice fallback on quota/length/
 *  error. onStart fires when audio actually begins, onEnd when it finishes. */
export async function speakText(raw: string, voice: string, cb?: { onStart?: () => void; onEnd?: () => void }): Promise<void> {
  stopSpeech();
  const clean = cleanForSpeech(raw);
  if (!clean) { cb?.onEnd?.(); return; }
  if (clean.length <= 5000) {
    try {
      const res = await fetch('/__fleet/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: clean, voice }) });
      const j = await res.json().catch(() => ({})) as { audio?: string; rate?: number };
      if (j.audio) {
        const url = URL.createObjectURL(pcmToWav(base64ToBytes(j.audio), j.rate || 24000));
        const a = new Audio(url); currentAudio = a;
        a.onended = () => { URL.revokeObjectURL(url); currentAudio = null; cb?.onEnd?.(); };
        a.onerror = () => { URL.revokeObjectURL(url); browserSpeak(clean, cb?.onEnd); };
        cb?.onStart?.();
        await a.play();
        return;
      }
    } catch { /* fall through */ }
  }
  cb?.onStart?.();
  browserSpeak(clean, cb?.onEnd); // fallback
}
