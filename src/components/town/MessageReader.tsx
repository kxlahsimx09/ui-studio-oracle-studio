// Distraction-free reader for an agent's messages. Opens on the LATEST message
// (the live pane scrolls long replies away) rendered as clean, wide, readable
// text; ← steps backward to earlier messages, → forward. Parses the session
// transcript, which delimits turns with "──────── 🤖 opus ────────" headers.
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { fetchTranscript } from '../../lib/fleet';
import { speakText, stopSpeech, parseMessages, VOICES, VOICE_KEY, type Msg } from '../../lib/speech';

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

export function MessageReader({ paneId, title, onClose }: { paneId: string; title: string; onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [voice, setVoice] = useState(() => { try { return localStorage.getItem(VOICE_KEY) || 'Kore'; } catch { return 'Kore'; } });

  const stopSpeak = () => { stopSpeech(); setSpeaking(false); setLoadingAudio(false); };
  // Read aloud via the shared speech module (Gemini TTS, browser-voice fallback).
  // Passing { paneId, label } registers this agent in the global speaking registry
  // so the town floats a 🔊 over its head and can pause/stop the read from there.
  const speak = async (raw: string) => {
    setSpeaking(true); setLoadingAudio(true);
    await speakText(raw, voice, {
      onStart: () => setLoadingAudio(false),
      onEnd: () => { setSpeaking(false); setLoadingAudio(false); },
    }, { paneId, label: title });
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
