// Distraction-free reader for an agent's messages. Opens on the LATEST message
// (the live pane scrolls long replies away) rendered as clean, wide, readable
// text; ← steps backward to earlier messages, → forward. Parses the session
// transcript, which delimits turns with "──────── 🤖 opus ────────" headers.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { fetchTranscript } from '../../lib/fleet';

// Natural Gemini TTS voices (mirror server TTS_VOICES). Persisted choice.
const VOICES = ['Kore', 'Puck', 'Zephyr', 'Charon', 'Aoede', 'Leda', 'Orus', 'Fenrir', 'Algieba', 'Sulafat'];
const VOICE_KEY = 'town:tts-voice';

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
// Wrap raw 16-bit mono PCM in a WAV header so an <audio> element can play it.
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

interface Msg { who: string; text: string }

function parseMessages(transcript: string): Msg[] {
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

// Clickable URLs in an otherwise plain, pre-wrapped message.
const URL_RE = /(https?:\/\/[^\s<>"'`)\]}]+)/g;
function linkify(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0, i = 0, m: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(s)) !== null) {
    if (m.index > last) out.push(s.slice(last, m.index));
    let url = m[0], trail = '';
    const tm = url.match(/[.,;:!?)\]]+$/);
    if (tm) { trail = tm[0]; url = url.slice(0, -trail.length); }
    out.push(<a key={i++} href={url} target="_blank" rel="noreferrer" style={{ color: '#7dd3fc', textDecoration: 'underline' }}>{url}</a>);
    if (trail) out.push(trail);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

// Strip markdown / code / links / emoji / box-drawing so a TTS voice reads cleanly
// (these special characters otherwise get spelled out or mangled).
function cleanForSpeech(s: string): string {
  return (s || '')
    .replace(/```[\s\S]*?```/g, ' โค้ด. ')            // fenced code → a short spoken marker
    .replace(/`([^`]+)`/g, '$1')                       // inline code → its text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')             // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')           // links → link text
    .replace(/https?:\/\/\S+/g, ' ลิงก์ ')             // bare URLs → "link"
    .replace(/[#>*_~`|]+/g, ' ')                       // markdown punctuation
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{2500}-\u{257F}]/gu, ' ') // emoji / arrows / box-drawing
    .replace(/[\uFE0F\u200D]/g, '')                    // variation selectors / zero-width joiner
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '. ')
    .trim();
}

export function MessageReader({ paneId, title, onClose }: { paneId: string; title: string; onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [voice, setVoice] = useState(() => { try { return localStorage.getItem(VOICE_KEY) || 'Kore'; } catch { return 'Kore'; } });
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stopSpeak = () => {
    try { audioRef.current?.pause(); audioRef.current = null; } catch { /* */ }
    try { window.speechSynthesis?.cancel(); } catch { /* */ } setSpeaking(false); setLoadingAudio(false);
  };
  const browserSpeak = (clean: string) => {
    const synth = window.speechSynthesis;
    if (!synth) { setSpeaking(false); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(clean.slice(0, 32000));
    u.lang = /[฀-๿]/.test(clean) ? 'th-TH' : 'en-US';
    u.onend = () => setSpeaking(false); u.onerror = () => setSpeaking(false);
    setSpeaking(true); synth.speak(u);
  };
  // Read aloud: natural Gemini TTS first; on quota/length/error → browser voice.
  const speak = async (raw: string) => {
    stopSpeak();
    const clean = cleanForSpeech(raw);
    if (!clean) return;
    setSpeaking(true);
    if (clean.length <= 5000) {
      setLoadingAudio(true);
      try {
        const res = await fetch('/__fleet/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: clean, voice }) });
        const j = await res.json().catch(() => ({})) as { audio?: string; rate?: number; error?: string };
        setLoadingAudio(false);
        if (j.audio) {
          const url = URL.createObjectURL(pcmToWav(base64ToBytes(j.audio), j.rate || 24000));
          const a = new Audio(url); audioRef.current = a;
          a.onended = () => { setSpeaking(false); URL.revokeObjectURL(url); };
          a.onerror = () => { browserSpeak(clean); URL.revokeObjectURL(url); };
          await a.play(); return;
        }
      } catch { setLoadingAudio(false); }
    }
    browserSpeak(clean); // fallback (quota, too long, or no key)
  };
  useEffect(() => () => { stopSpeak(); }, []); // stop on unmount

  useEffect(() => {
    let alive = true;
    fetchTranscript(paneId)
      .then((t) => { if (!alive) return; const ms = parseMessages(t); setMsgs(ms); setIdx(Math.max(0, ms.length - 1)); })
      .catch((e) => { if (alive) setErr((e as Error).message); });
    return () => { alive = false; };
  }, [paneId]);

  const total = msgs?.length ?? 0;
  const cur = msgs && total ? msgs[idx] : null;
  // changing message → drop the old summary + stop any speech.
  const goto = (n: number) => { stopSpeak(); setSummary(null); setIdx(Math.min(total - 1, Math.max(0, n))); };
  const go = (d: number) => goto(idx + d);

  // Summarise the current message via Gemini (server-side key), then read it aloud.
  const doSummary = async () => {
    if (!cur || summarizing) return;
    setSummarizing(true); setErr(null); setSummary(null); stopSpeak();
    try {
      const res = await fetch('/__fleet/summarize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: cur.text }) });
      const j = await res.json().catch(() => ({ error: `summarize ${res.status}` })) as { summary?: string; error?: string };
      if (j.error || !j.summary) setErr(j.error || 'no summary');
      else { setSummary(j.summary); speak(j.summary); }
    } catch (e) { setErr((e as Error).message); }
    finally { setSummarizing(false); }
  };
  // ← = backward (older), → = forward (newer)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [total]); // eslint-disable-line react-hooks/exhaustive-deps
  const body = useMemo<ReactNode>(() => (cur ? linkify(cur.text) : null), [cur]);

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/80 p-3 sm:p-6" onClick={onClose}>
      <div className="flex flex-col w-[min(860px,96vw)] h-[90vh] rounded-xl border border-white/15 bg-[#0d0d13]" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center gap-2 px-4 py-2.5 border-b border-white/10">
          <span className="font-semibold text-[13px] text-white/90">📖 {title}</span>
          {cur && <span className="text-[12px] text-white/45">{cur.who}</span>}
          <span className="ml-auto text-[11px] text-white/40 font-mono">{total ? `${idx + 1} / ${total}` : '—'}</span>
          <button onClick={onClose} className="ml-2 text-white/50 hover:text-white/90 text-sm" title="close (Esc)">✕</button>
        </header>

        {cur && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10 flex-wrap">
            <button onClick={() => speak(cur.text)} disabled={loadingAudio}
              className="px-3 py-1.5 rounded-lg text-[12px] disabled:opacity-50"
              style={{ background: '#22c55e22', color: '#86efac', border: '1px solid #22c55e55' }}
              title="read the whole message aloud (Gemini TTS)">{loadingAudio ? '🔊 …' : '🔊 Full read'}</button>
            <button onClick={doSummary} disabled={summarizing}
              className="px-3 py-1.5 rounded-lg text-[12px] disabled:opacity-40"
              style={{ background: '#a78bfa22', color: '#c4b5fd', border: '1px solid #a78bfa55' }}
              title="Gemini summary of this message, read aloud">{summarizing ? '📝 summarising…' : '📝 Summary'}</button>
            {speaking && <button onClick={stopSpeak} className="px-3 py-1.5 rounded-lg text-[12px]"
              style={{ background: '#f8717122', color: '#fca5a5', border: '1px solid #f8717155' }}>■ Stop</button>}
            <span className="flex-1" />
            <label className="text-[11px] text-white/45 flex items-center gap-1" title="Gemini TTS voice — pick the most natural to your ear">
              🎙
              <select value={voice} onChange={(e) => { setVoice(e.target.value); try { localStorage.setItem(VOICE_KEY, e.target.value); } catch { /* */ } }}
                className="bg-white/10 rounded px-1 py-0.5 text-white/80">
                {VOICES.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
          </div>
        )}
        {summary && <div className="px-4 py-2 text-[12px] text-violet-200/90 border-b border-white/10" style={{ background: '#a78bfa12' }}>📝 {summary}</div>}

        {err && <p className="px-4 py-3 text-[12px] text-red-300">⚠ {err}</p>}
        {!err && msgs == null && <p className="px-4 py-3 text-[12px] text-white/40">loading transcript…</p>}
        {!err && msgs != null && total === 0 && <p className="px-4 py-3 text-[12px] text-white/40">no messages found in this session.</p>}

        {cur && (
          <article
            key={idx}
            className="flex-1 overflow-auto px-5 sm:px-8 py-5 whitespace-pre-wrap break-words"
            style={{ color: '#e7e9ee', fontSize: 15, lineHeight: 1.75, maxWidth: '74ch', marginInline: 'auto', fontFamily: 'ui-sans-serif,system-ui,sans-serif' }}
          >
            {body}
          </article>
        )}

        <footer className="flex items-center gap-2 px-4 py-2.5 border-t border-white/10">
          <button onClick={() => go(-1)} disabled={idx <= 0}
            className="px-3 py-1.5 rounded-lg text-[12px] disabled:opacity-30"
            style={{ background: '#ffffff10', color: '#cbd5e1', border: '1px solid #ffffff20' }}
            title="previous (older) message · ←">← backward</button>
          <button onClick={() => go(1)} disabled={idx >= total - 1}
            className="px-3 py-1.5 rounded-lg text-[12px] disabled:opacity-30"
            style={{ background: '#ffffff10', color: '#cbd5e1', border: '1px solid #ffffff20' }}
            title="next (newer) message · →">forward →</button>
          <span className="flex-1" />
          <button onClick={() => goto(total - 1)} disabled={idx >= total - 1}
            className="px-3 py-1.5 rounded-lg text-[12px] disabled:opacity-30"
            style={{ background: '#38bdf822', color: '#7dd3fc', border: '1px solid #38bdf855' }}
            title="jump to the latest message">⤓ latest</button>
        </footer>
      </div>
    </div>
  );
}
