import { useState, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useAppStore } from '@/store';
import type { AppSettings } from '@/store/types';
import { sseSubscribe } from '@/services/sseBus';

// Attach the LAN token to co-pilot action endpoints so the Cockpit works from network devices
// (iPad). On localhost there's no stored token and the server bypasses auth for loopback anyway.
const withTok = (p: string): string => {
  try { const t = sessionStorage.getItem('colony-token'); return t ? `${p}?token=${t}` : p; }
  catch { return p; }
};

interface CopilotLine {
  id?: string;
  line: string;
  mood?: string;
  beat?: string;
  ts: string;
  live?: boolean; // true = paid live generation (worth rating → feeds the free pool); false = free canned/promoted
  question?: { id: string; layer: string; learnKey: string; options: { label: string; value: string }[] };
}
interface Pack {
  id: string;
  name: string;
}

const PERSONALITIES = [
  { key: 'wash', label: 'Wash' },
  { key: 'tars', label: 'TARS' },
  { key: 'k2', label: 'K2' },
] as const;

const CHATTINESS = [
  { label: 'Chatty', sec: 60 },
  { label: 'Normal', sec: 120 },
  { label: 'Quiet', sec: 240 },
] as const;

// Why a line got a 👎 — feeds the promote/prune engine with more than a bare score.
const DOWN_REASONS = [
  { key: 'repeated', label: 'Repeated' },
  { key: 'no-info', label: 'No info' },
  { key: 'unclear', label: "Didn't get it" },
  { key: 'irrelevant', label: 'Not relevant' },
  { key: 'off-character', label: 'Off-character' },
] as const;

// Mood → accent (placeholder tint + the new-line flash colour).
const MOOD_ACCENT: Record<string, string> = {
  calm: '#2dd4bf', panic: '#f87171', brace: '#fb923c', relief: '#4ade80',
  awe: '#38bdf8', hyped: '#fbbf24', proud: '#a78bfa', somber: '#94a3b8', wave: '#5eead4',
};

// TARS's trivia host reactions (deadpan-warm), indexed by question so they stay stable.
const TRIVIA_RIGHT = ['Correct. I am almost proud.', 'Right. Logged, with approval.', 'Correct — you were paying attention after all.', 'Affirmative. Pleasingly so.'];
const TRIVIA_WRONG = ['Incorrect. The answer is highlighted; commit it to memory.', 'Wrong. Confidently wrong, which I respect.', 'No. A bold no, but a no.', 'Incorrect. I would flash the cue light, but you would still be wrong.'];
function triviaSignoff(score: number, total: number) {
  const pct = total ? score / total : 0;
  if (pct >= 0.8) return 'Genuinely impressive. I am revising my expectations of you upward.';
  if (pct >= 0.5) return 'Respectable. We will make a scholar of you yet.';
  return 'We have work to do. I have allocated the time. You are welcome.';
}

// New-line attention cues: an edge-glow flash (catchable from the corner of your
// eye — panic flashes red) + the line sliding in. Restarted by bumping the key.
const COPILOT_ANIM_CSS = `
.copilot-flash { position:absolute; inset:0; pointer-events:none; border-radius:0.75rem;
  box-shadow: inset 0 0 60px 10px var(--accent), inset 0 0 0 3px var(--accent);
  animation: copilotFlash 1s ease-out forwards; }
@keyframes copilotFlash { 0%{opacity:0} 12%{opacity:1} 100%{opacity:0} }
.copilot-line-in { animation: copilotLineIn 0.45s ease-out; }
@keyframes copilotLineIn { 0%{opacity:0; transform:translateY(12px)} 100%{opacity:1; transform:translateY(0)} }
`;

// A soft two-note chime so a new line registers without looking over.
// Browsers suspend any AudioContext not started by a user gesture, so we keep ONE context
// and resume it on the Sound-toggle click (a real gesture) — then chimes on SSE lines play.
let audioCtx: AudioContext | null = null;
function ensureAudio(): AudioContext | null {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    return audioCtx;
  } catch { return null; }
}
function playChime() {
  const ctx = ensureAudio();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    [660, 880].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = 'sine';
      o.frequency.value = freq;
      const t = now + i * 0.12;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.start(t); o.stop(t + 0.2);
    });
  } catch { /* */ }
}

function moodFace(mood: string) {
  switch (mood) {
    case 'panic': return { eye: 'wide', mouth: 'o' };
    case 'awe': return { eye: 'wide', mouth: 'o' };
    case 'brace': return { eye: 'narrow', mouth: 'flat' };
    case 'somber': return { eye: 'down', mouth: 'frown' };
    case 'hyped': return { eye: 'happy', mouth: 'grin' };
    case 'proud': return { eye: 'happy', mouth: 'smile' };
    case 'relief': return { eye: 'soft', mouth: 'smile' };
    case 'wave': return { eye: 'happy', mouth: 'smile' };
    default: return { eye: 'soft', mouth: 'smile' };
  }
}

// Placeholder character — a flat, seated companion in a simple cockpit. Stands
// in until a real image pack is selected.
function PlaceholderStage({ mood }: { mood: string }) {
  const accent = MOOD_ACCENT[mood] || MOOD_ACCENT.calm;
  const { eye, mouth } = moodFace(mood);
  const lean = mood === 'panic' || mood === 'brace';
  return (
    <svg viewBox="0 0 800 450" className="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid slice" role="img" aria-label={`Co-pilot, ${mood}`}>
      <rect x="0" y="0" width="800" height="450" fill="#0a1016" />
      <path d="M0 120 q400 -120 800 0 V0 H0 Z" fill="#060b12" />
      <g fill="#cbd5e1">
        <circle cx="140" cy="60" r="1.4" opacity="0.6" /><circle cx="300" cy="40" r="1" opacity="0.5" />
        <circle cx="470" cy="56" r="1.5" opacity="0.7" /><circle cx="640" cy="44" r="1" opacity="0.5" />
      </g>
      <rect x="270" y="150" width="260" height="280" rx="36" fill="#11202b" />
      <rect x="296" y="176" width="208" height="240" rx="28" fill="#16303d" />
      <g transform={lean ? 'rotate(-3 400 320)' : undefined}>
        <ellipse cx="400" cy="350" rx="120" ry="100" fill="#2a3a44" />
        <ellipse cx="400" cy="350" rx="120" ry="100" fill={accent} opacity="0.10" />
        <ellipse cx="400" cy="235" rx="74" ry="80" fill="#33454f" />
        <ellipse cx="400" cy="235" rx="74" ry="80" fill={accent} opacity="0.10" />
        {eye === 'wide' && (
          <g><ellipse cx="372" cy="228" rx="14" ry="18" fill="#e6f6ff" /><ellipse cx="428" cy="228" rx="14" ry="18" fill="#e6f6ff" />
            <circle cx="372" cy="230" r="6" fill="#0a1016" /><circle cx="428" cy="230" r="6" fill="#0a1016" /></g>
        )}
        {eye === 'soft' && (<g fill="#0a1016"><ellipse cx="372" cy="230" rx="9" ry="11" /><ellipse cx="428" cy="230" rx="9" ry="11" /></g>)}
        {eye === 'happy' && (<g stroke="#0a1016" strokeWidth="5" fill="none" strokeLinecap="round"><path d="M360 232 q12 -14 24 0" /><path d="M416 232 q12 -14 24 0" /></g>)}
        {eye === 'narrow' && (<g stroke="#0a1016" strokeWidth="6" strokeLinecap="round"><line x1="360" y1="230" x2="384" y2="232" /><line x1="416" y1="232" x2="440" y2="230" /></g>)}
        {eye === 'down' && (<g stroke="#0a1016" strokeWidth="5" fill="none" strokeLinecap="round"><path d="M360 228 q12 12 24 0" /><path d="M416 228 q12 12 24 0" /></g>)}
        {mouth === 'smile' && <path d="M376 270 q24 22 48 0" stroke="#0a1016" strokeWidth="5" fill="none" strokeLinecap="round" />}
        {mouth === 'grin' && <path d="M372 266 q28 30 56 0 q-28 10 -56 0 Z" fill="#0a1016" />}
        {mouth === 'o' && <ellipse cx="400" cy="276" rx="14" ry="18" fill="#0a1016" />}
        {mouth === 'flat' && <line x1="378" y1="274" x2="422" y2="274" stroke="#0a1016" strokeWidth="5" strokeLinecap="round" />}
        {mouth === 'frown' && <path d="M376 280 q24 -20 48 0" stroke="#0a1016" strokeWidth="5" fill="none" strokeLinecap="round" />}
      </g>
      <rect x="0" y="404" width="800" height="46" fill="#0c1822" />
      <rect x="0" y="404" width="800" height="3" fill={accent} opacity="0.6" />
    </svg>
  );
}

export function CopilotPage() {
  const enabled = useAppStore((s) => s.settings.copilotEnabled ?? false);
  const personality = useAppStore((s) => s.settings.copilotPersonality ?? 'wash');
  const idleGap = useAppStore((s) => s.settings.copilotIdleGapSec ?? 240);
  const sound = useAppStore((s) => s.settings.copilotSound ?? false);
  const humor = useAppStore((s) => s.settings.copilotTarsHumor ?? 60);
  const honesty = useAppStore((s) => s.settings.copilotTarsHonesty ?? 80);
  const [lines, setLines] = useState<CopilotLine[]>([]);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [flashKey, setFlashKey] = useState(0);
  const [usage, setUsage] = useState({ lines: 0, tokens: 0, cost: 0, lastMs: 0, lastCost: 0 });
  const [rated, setRated] = useState<Record<string, 1 | -1>>({});
  const [pendingDown, setPendingDown] = useState<string | null>(null);
  const [expandedLine, setExpandedLine] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});
  const [thinking, setThinking] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = sseSubscribe('copilot_line', (ev) => {
      const e = ev as { id?: string; line?: string; mood?: string; beat?: string; timestamp?: string; usage?: { in?: number; out?: number; costUsd?: number; ms?: number; canned?: boolean }; question?: CopilotLine['question'] };
      if (!e.line) return;
      const isLive = !(e.usage && e.usage.canned); // canned/promoted set usage.canned; live generation doesn't
      setLines((prev) => [
        { id: e.id, line: e.line as string, mood: e.mood, beat: e.beat, ts: e.timestamp || new Date().toISOString(), live: isLive, question: e.question },
        ...prev,
      ].slice(0, 30));
      setFlashKey((k) => k + 1); // trigger the flash + line animation
      if (e.beat === 'whats-on-your-mind' || e.beat === 'news') setThinking(false); // the on-demand line landed
      if (e.usage) {
        const u = e.usage;
        setUsage((prev) => ({
          lines: prev.lines + 1,
          tokens: prev.tokens + (u.in || 0) + (u.out || 0),
          cost: prev.cost + (u.costUsd || 0),
          lastMs: u.ms || 0,
          lastCost: u.costUsd || 0,
        }));
      }
      if (useAppStore.getState().settings.copilotSound) playChime();
    });
    return unsub;
  }, []);

  useEffect(() => {
    fetch('/copilot-characters')
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Pack[]) => { if (Array.isArray(list)) setPacks(list); })
      .catch(() => { /* none installed — placeholder only */ });
  }, []);

  const update = (partial: Partial<AppSettings>) => useAppStore.getState().updateSettings(partial);
  const [answeredQ, setAnsweredQ] = useState<Record<string, string>>({});
  const answerQuestion = (q: NonNullable<CopilotLine['question']>, label: string, value: string, questionText: string) => {
    if (!q || answeredQ[q.id]) return;
    setAnsweredQ((p) => ({ ...p, [q.id]: label }));
    if (value === '__dismiss__') return; // "not now" — store nothing, don't re-ask immediately
    void fetch(withTok('/copilot-answer'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layer: q.layer, learnKey: q.learnKey, value, label, question: questionText }),
    }).catch(() => {});
  };
  const [trivia, setTrivia] = useState<{ id: string; text: string; options: string[]; correctIndex: number; fact: string }[] | null>(null);
  const [triviaIdx, setTriviaIdx] = useState(0);
  const [triviaScore, setTriviaScore] = useState(0);
  const [triviaPicked, setTriviaPicked] = useState<number | null>(null);
  const [triviaDone, setTriviaDone] = useState(false);
  const [triviaHistory, setTriviaHistory] = useState<{ at: string; score: number; total: number }[]>([]);
  const [triviaLoading, setTriviaLoading] = useState(false);
  const startTrivia = () => {
    if (triviaLoading) return;
    setTriviaLoading(true);
    void fetch(withTok('/copilot-trivia')).then((r) => r.json()).then((d) => {
      const qs = Array.isArray(d?.questions) ? d.questions : [];
      if (Array.isArray(d?.history)) setTriviaHistory(d.history);
      if (qs.length) { setTrivia(qs); setTriviaIdx(0); setTriviaScore(0); setTriviaPicked(null); setTriviaDone(false); }
    }).catch(() => {}).finally(() => setTriviaLoading(false));
  };
  const pickTrivia = (i: number) => {
    if (triviaPicked !== null || !trivia) return;
    setTriviaPicked(i);
    if (i === trivia[triviaIdx].correctIndex) setTriviaScore((s) => s + 1);
  };
  const nextTrivia = () => {
    if (!trivia) return;
    if (triviaIdx + 1 >= trivia.length) {
      setTriviaDone(true);
      // Persist the finished round + pull back the updated history for the comparison strip.
      void fetch(withTok('/copilot-trivia-result'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score: triviaScore, total: trivia.length }),
      }).then((r) => r.json()).then((d) => { if (Array.isArray(d?.history)) setTriviaHistory(d.history); }).catch(() => {});
      return;
    }
    setTriviaIdx((x) => x + 1); setTriviaPicked(null);
  };
  const rateLine = (id: string | undefined, rating: 1 | -1, reason?: string, comment?: string) => {
    if (!id || rated[id]) return;
    setRated((prev) => ({ ...prev, [id]: rating }));
    setPendingDown(null);
    void fetch(withTok('/copilot-rate'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, rating, reason, comment }),
    }).catch(() => {});
  };
  const submitComment = (id?: string) => {
    if (!id) return;
    const c = (commentDraft[id] || '').trim();
    if (c) rateLine(id, -1, undefined, c);
  };
  // One feedback control, used for the latest line (dark stage) AND any line clicked
  // in the running log. Dark-friendly styling reads on both. A render fn, not a child
  // component, so the textarea doesn't remount and lose focus on each keystroke.
  const renderFeedback = (id?: string) => {
    if (!id) return null;
    if (rated[id]) return <span className="text-xs text-white/40">noted ✓</span>;
    const showWhy = pendingDown === id;
    return (
      <div className="flex flex-col gap-1.5 mt-1.5 max-w-xl">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={() => rateLine(id, 1)} title="Good line" className="px-2 py-0.5 rounded text-sm bg-green-500/20 text-green-300 hover:bg-green-500/40 transition-colors">👍</button>
          <button onClick={() => setPendingDown(showWhy ? null : id)} title="Weak line" className="px-2 py-0.5 rounded text-sm bg-red-500/20 text-red-300 hover:bg-red-500/40 transition-colors">👎</button>
          {showWhy && DOWN_REASONS.map((r) => (
            <button key={r.key} onClick={() => rateLine(id, -1, r.key)} className="px-2 py-0.5 rounded text-xs bg-red-500/15 text-red-200 hover:bg-red-500/30 transition-colors">{r.label}</button>
          ))}
        </div>
        {showWhy && (
          <div className="flex items-start gap-1.5">
            <textarea
              value={commentDraft[id] || ''}
              onChange={(e) => setCommentDraft((d) => ({ ...d, [id]: e.target.value }))}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submitComment(id); }}
              placeholder="…or write the full reason (Ctrl/Cmd+Enter to send)"
              rows={2}
              className="flex-1 text-xs rounded bg-black/30 border border-white/15 px-2 py-1 text-white placeholder-white/30 resize-none focus:outline-none focus:border-white/40"
            />
            <button onClick={() => submitComment(id)} disabled={!(commentDraft[id] || '').trim()} className="px-2 py-1 rounded text-xs bg-sky-500/30 text-sky-200 hover:bg-sky-500/50 transition-colors disabled:opacity-30">Send</button>
          </div>
        )}
      </div>
    );
  };
  // A Q&A question on the current line → tappable answer buttons (+ "It's complicated" as a
  // real logged non-answer, "not now" as a store-nothing dismiss). Latest line only.
  const renderQuestion = (l: CopilotLine) => {
    const q = l.question;
    if (!q) return null;
    if (answeredQ[q.id]) return <span className="text-xs text-white/40">{answeredQ[q.id] === '__notnow__' ? 'maybe later' : `you said: ${answeredQ[q.id]} ✓`}</span>;
    return (
      <div className="flex items-center gap-1.5 flex-wrap mt-2">
        {q.options.map((o) => (
          <button key={o.value} onClick={() => answerQuestion(q, o.label, o.value, l.line)} className="px-3 py-1 rounded text-sm bg-sky-500/25 text-sky-100 hover:bg-sky-500/45 transition-colors">{o.label}</button>
        ))}
        <button onClick={() => answerQuestion(q, "It's complicated", 'complicated', l.line)} className="px-2 py-1 rounded text-xs bg-white/10 text-white/70 hover:bg-white/20 transition-colors">It&apos;s complicated</button>
        <button onClick={() => answerQuestion(q, '__notnow__', '__dismiss__', l.line)} className="px-2 py-1 rounded text-xs text-white/40 hover:text-white/70 transition-colors">not now</button>
      </div>
    );
  };
  const latest = lines[0];
  const mood = latest?.mood || 'calm';
  // The image follows the persona — a pack folder named for the persona id (wash/k2)
  // shows its portrait; otherwise the placeholder. One choice = face + voice.
  const usingPack = packs.some((p) => p.id === personality);

  const goFullscreen = () => { void stageRef.current?.requestFullscreen?.().catch(() => {}); };

  return (
    <div className="max-w-4xl mx-auto">
      <style>{COPILOT_ANIM_CSS}</style>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h2 className="text-2xl font-bold">Cockpit</h2>
          <p className="text-sm text-muted-foreground mt-1">Your co-pilot's seat.</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={enabled} onChange={(e) => update({ copilotEnabled: e.target.checked })} /> Enabled
          </label>
          <button
            onClick={() => { ensureAudio(); update({ copilotSound: !sound }); }}
            className={`px-2 py-1 rounded border text-xs ${sound ? 'border-primary text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
          >
            {sound ? '🔔 Sound' : '🔕 Sound'}
          </button>
          <button onClick={goFullscreen} className="px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground text-xs">
            ⛶ Fullscreen
          </button>
          <button
            onClick={() => { if (thinking) return; setThinking(true); void fetch(withTok('/copilot-ask'), { method: 'POST' }).catch(() => setThinking(false)); window.setTimeout(() => setThinking(false), 30000); }}
            disabled={!enabled || thinking}
            title="Ask the co-pilot for a comment right now"
            className="px-2 py-1 rounded border border-primary/60 text-primary hover:bg-primary/10 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {thinking ? '💭 Thinking…' : "💭 What's on your mind?"}
          </button>
          <button
            onClick={() => { if (thinking) return; setThinking(true); void fetch(withTok('/copilot-news'), { method: 'POST' }).catch(() => setThinking(false)); window.setTimeout(() => setThinking(false), 30000); }}
            disabled={!enabled || thinking}
            title="The co-pilot's take on the latest GalNet news"
            className="px-2 py-1 rounded border border-primary/60 text-primary hover:bg-primary/10 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {thinking ? '📰 …' : '📰 News'}
          </button>
          <button
            onClick={startTrivia}
            disabled={!enabled || triviaLoading || !!trivia}
            title="Play TARS's trivia — the galaxy, and your own play"
            className="px-2 py-1 rounded border border-primary/60 text-primary hover:bg-primary/10 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {triviaLoading ? '🧠 …' : '🧠 Trivia'}
          </button>
        </div>
      </div>

      {/* the stage — character in the seat + his line */}
      <div ref={stageRef} className="relative aspect-video w-full rounded-xl overflow-hidden border border-border bg-black">
        {usingPack ? (
          <>
            {/* blurred fill so the full portrait can show without black side bars */}
            <img
              src={`/copilot-art/${personality}/${mood}.png`}
              aria-hidden
              className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-40"
              onError={(e) => { const img = e.currentTarget as HTMLImageElement; if (!img.src.endsWith('/calm.png')) img.src = `/copilot-art/${personality}/calm.png`; }}
            />
            <img
              src={`/copilot-art/${personality}/${mood}.png`}
              alt="co-pilot"
              className="absolute inset-0 w-full h-full object-contain"
              onError={(e) => { const img = e.currentTarget as HTMLImageElement; if (!img.src.endsWith('/calm.png')) img.src = `/copilot-art/${personality}/calm.png`; }}
            />
          </>
        ) : (
          <PlaceholderStage mood={mood} />
        )}

        {flashKey > 0 && (
          <div
            key={flashKey}
            className="copilot-flash"
            style={{ '--accent': MOOD_ACCENT[mood] || MOOD_ACCENT.calm } as CSSProperties}
          />
        )}

        <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/85 to-transparent">
          {latest ? (
            <div key={flashKey} className="copilot-line-in max-w-3xl">
              {latest.live && <div style={{ color: '#f5b945' }} className="text-[10px] font-bold tracking-widest mb-1">{'●'} LIVE — worth rating</div>}
              <div className="text-lg md:text-2xl text-white leading-snug">{latest.line}</div>
              {latest.question ? renderQuestion(latest) : renderFeedback(latest.id)}
            </div>
          ) : (
            <div className="text-sm text-white/60">
              {enabled ? "Standing by — fly, scan, dock, get interdicted… he'll chime in." : 'Enable the co-pilot to hear from him.'}
            </div>
          )}
        </div>

        {trivia && (
          <div className="absolute inset-0 z-10 flex flex-col bg-black/88 p-4 md:p-6">
            {!triviaDone ? (
              <div className="flex flex-col h-full max-w-2xl mx-auto w-full">
                <div className="flex items-center justify-between text-[11px] text-white/50 mb-2">
                  <span className="tracking-widest">TARS TRIVIA · Q{triviaIdx + 1}/{trivia.length}</span>
                  <span>Score {triviaScore}<button onClick={() => setTrivia(null)} className="ml-3 text-white/40 hover:text-white/80">✕ close</button></span>
                </div>
                <div className="text-lg md:text-xl text-white leading-snug mb-3">{trivia[triviaIdx].text}</div>
                <div className="flex flex-col gap-2">
                  {trivia[triviaIdx].options.map((o, i) => {
                    const revealed = triviaPicked !== null;
                    const correct = i === trivia[triviaIdx].correctIndex;
                    const picked = triviaPicked === i;
                    const cls = revealed
                      ? correct ? 'bg-green-500/30 border-green-400/60 text-green-100'
                        : picked ? 'bg-red-500/25 border-red-400/50 text-red-100' : 'border-white/10 text-white/40'
                      : 'border-white/20 text-white hover:bg-white/10';
                    return <button key={i} disabled={revealed} onClick={() => pickTrivia(i)} className={`text-left px-3 py-2 rounded border text-sm transition-colors ${cls}`}>{o}</button>;
                  })}
                </div>
                {triviaPicked !== null && (
                  <div className="mt-3">
                    <div className="text-sm text-amber-200/90">{triviaPicked === trivia[triviaIdx].correctIndex ? TRIVIA_RIGHT[triviaIdx % TRIVIA_RIGHT.length] : TRIVIA_WRONG[triviaIdx % TRIVIA_WRONG.length]}</div>
                    <div className="text-xs text-white/60 mt-1">{trivia[triviaIdx].fact}</div>
                    <button onClick={nextTrivia} className="mt-3 px-4 py-1.5 rounded bg-sky-500/30 text-sky-100 hover:bg-sky-500/50 text-sm">{triviaIdx + 1 >= trivia.length ? 'See score →' : 'Next →'}</button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center max-w-md mx-auto">
                <div className="text-[11px] text-white/50 mb-1 tracking-widest">TARS TRIVIA · COMPLETE</div>
                <div className="text-3xl font-bold text-white mb-2">{triviaScore} / {trivia.length}</div>
                <div className="text-sm text-amber-200/90 mb-4">{triviaSignoff(triviaScore, trivia.length)}</div>
                {triviaHistory.length > 1 && (
                  <div className="text-[11px] text-white/50 mb-4 w-full">
                    <div className="tracking-widest mb-1">YOUR RECENT RUNS</div>
                    <div className="flex gap-1.5 flex-wrap justify-center">
                      {triviaHistory.slice(-8).map((h, i, arr) => (
                        <span key={h.at} className={`px-1.5 py-0.5 rounded ${i === arr.length - 1 ? 'bg-amber-400/25 text-amber-100' : 'bg-white/10 text-white/60'}`}>{h.score}/{h.total}</span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={startTrivia} className="px-4 py-1.5 rounded bg-sky-500/30 text-sky-100 hover:bg-sky-500/50 text-sm">Play again</button>
                  <button onClick={() => setTrivia(null)} className="px-4 py-1.5 rounded border border-white/20 text-white/70 hover:bg-white/10 text-sm">Close</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* tuning */}
      <div className="flex items-center gap-4 mt-3 flex-wrap text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Co-pilot:</span>
          {PERSONALITIES.map((p) => (
            <button key={p.key} onClick={() => update({ copilotPersonality: p.key, copilotCharacter: p.key })}
              className={`px-2 py-0.5 rounded border transition-colors ${personality === p.key ? 'border-primary text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}>
              {p.label}
            </button>
          ))}
        </div>
        {personality === 'tars' && (
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1 text-muted-foreground">Humour
              <input type="range" min={0} max={100} value={humor} onChange={(e) => update({ copilotTarsHumor: Number(e.target.value) })} className="w-16" />
              <span className="w-8 text-foreground">{humor}%</span>
            </label>
            <label className="flex items-center gap-1 text-muted-foreground">Honesty
              <input type="range" min={0} max={100} value={honesty} onChange={(e) => update({ copilotTarsHonesty: Number(e.target.value) })} className="w-16" />
              <span className="w-8 text-foreground">{honesty}%</span>
            </label>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Chatter:</span>
          {CHATTINESS.map((c) => (
            <button key={c.label} onClick={() => update({ copilotIdleGapSec: c.sec })}
              className={`px-2 py-0.5 rounded border transition-colors ${idleGap === c.sec ? 'border-primary text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {usage.lines > 0 && (
        <div className="text-[11px] text-muted-foreground mt-2">
          Session: {usage.lines} {usage.lines === 1 ? 'line' : 'lines'} · ~{usage.tokens.toLocaleString()} tok · ≈${usage.cost.toFixed(2)} (Max-sub equiv, not billed) · last {Math.round(usage.lastMs)}ms / ${usage.lastCost.toFixed(3)}
        </div>
      )}

      {!enabled && (
        <div className="rounded border border-border bg-muted/20 p-3 text-sm text-muted-foreground mt-3">
          The co-pilot is off. It needs the <code>claude</code> CLI signed into your Max subscription on the PC running this app —
          it generates lines there and broadcasts them here.
        </div>
      )}

      {lines.length > 1 && (
        <div className="space-y-1.5 mt-4">
          <div className="text-[11px] text-muted-foreground/70 mb-1">Click any line to rate it or leave a note.</div>
          {lines.slice(1, 8).map((l, i) => (
            <div key={`${l.ts}-${i}`} className="border-l-2 border-border/50 pl-3">
              <button
                onClick={() => setExpandedLine(expandedLine === l.id ? null : (l.id || null))}
                className={`text-sm text-left w-full transition-colors ${expandedLine === l.id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {l.live && <span style={{ color: '#f5b945' }} className="text-[10px] font-bold mr-1.5">{'●'} LIVE</span>}
                {l.line}
              </button>
              {expandedLine === l.id && renderFeedback(l.id)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
