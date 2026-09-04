// server/ai/copilotQuestions.js
//
// The Q&A question bank + selection. The co-pilot occasionally asks the commander a
// tappable question and stores the answer (copilotMemory.qa.*), building a model of them
// for richer banter + callbacks. Persona-shaped: Wren personal/human/curious; Tycho warm
// calibration (ties to his dial + teacher role); K2 blunt/probing/assessing. DURABLE
// answers are asked ONCE EVER; SESSION answers reset each game-load. The cockpit UI auto-
// adds "It's complicated" (a real logged non-answer) + "not now" (dismiss) to every one.
//
// Shape: { id, persona:'wash'|'tars'|'k2'|'any', layer:'durable'|'session'|'goal',
//          learnKey, text, options:[{label,value}], trigger:'session-start'|'quiet-cruise'|'any' }

export const QUESTIONS = [
  // --- session intent (asked once per session, on the first quiet cruise) ---
  // skipWhenHauling: an ACTIVE HAUL SESSION already answers these — asking "what are we doing
  // today?" mid-haul is state-blind and reads as dumb ("what the fuck do you think?").
  {
    id: 'q-session-intent', persona: 'any', layer: 'session', learnKey: 'sessionIntent',
    text: 'Before we really get rolling — what are we doing today?',
    options: [{ label: 'Hauling', value: 'hauling' }, { label: 'Exploring', value: 'exploring' }, { label: 'Knocking about', value: 'knocking-about' }],
    trigger: 'quiet-cruise', skipWhenHauling: true,
  },
  {
    id: 'q-pace-tonight', persona: 'any', layer: 'session', learnKey: 'paceTonight',
    text: 'What kind of night is it — scenic, or efficient?',
    options: [{ label: 'Scenic', value: 'scenic' }, { label: 'Efficient', value: 'efficient' }],
    trigger: 'quiet-cruise', skipWhenHauling: true,
  },

  // --- Wren: personal, human, curious (durable) ---
  {
    id: 'q-savor-beauty', persona: 'wash', layer: 'durable', learnKey: 'savorBeauty',
    text: 'Real question — when we find a beautiful system, do you stop and look, or log it and move on?',
    options: [{ label: 'Stop and look', value: 'savor' }, { label: 'Log and move on', value: 'efficient' }],
    trigger: 'quiet-cruise',
  },
  {
    id: 'q-why-fly', persona: 'wash', layer: 'durable', learnKey: 'whyFly',
    text: 'What pulled you out here, really — the freedom, the credits, or the view?',
    options: [{ label: 'Freedom', value: 'freedom' }, { label: 'Credits', value: 'credits' }, { label: 'The view', value: 'view' }],
    trigger: 'quiet-cruise',
  },
  {
    id: 'q-favorite-part', persona: 'wash', layer: 'durable', learnKey: 'favoritePart',
    text: 'Favorite part of a run — the launch, the jump, or pulling into port?',
    options: [{ label: 'The launch', value: 'launch' }, { label: 'The jump', value: 'jump' }, { label: 'The port', value: 'port' }],
    trigger: 'quiet-cruise',
  },

  // --- Tycho: warm calibration, ties to his dial + teacher role (durable) ---
  {
    id: 'q-honesty-pref', persona: 'tars', layer: 'durable', learnKey: 'honestyPref',
    text: 'Quick calibration: when the news is bad, do you want it straight, or softened? I have a setting for both.',
    options: [{ label: 'Straight', value: 'straight' }, { label: 'Softened', value: 'softened' }],
    trigger: 'quiet-cruise',
  },
  {
    id: 'q-risk-pref', persona: 'tars', layer: 'durable', learnKey: 'riskPref',
    text: 'For my models: when the math is tight, do you push it, or play it safe?',
    options: [{ label: 'Push it', value: 'push' }, { label: 'Play it safe', value: 'safe' }],
    trigger: 'quiet-cruise',
  },
  {
    id: 'q-wants-teaching', persona: 'tars', layer: 'durable', learnKey: 'wantsTeaching',
    text: 'Be honest — do you actually want the space trivia, or am I lecturing into the void?',
    options: [{ label: 'Give me more', value: 'more' }, { label: 'Ease off', value: 'less' }],
    trigger: 'quiet-cruise',
  },

  // --- K2: blunt, probing, assessing (durable) ---
  {
    id: 'q-fight-flight', persona: 'k2', layer: 'durable', learnKey: 'fightOrFlight',
    text: 'A blunt one. If this goes wrong in a fight — do you run, or swing back?',
    options: [{ label: 'Run', value: 'run' }, { label: 'Swing back', value: 'fight' }],
    trigger: 'quiet-cruise',
  },
  {
    id: 'q-trust', persona: 'k2', layer: 'durable', learnKey: 'trustsK2',
    text: 'Do you trust me? You should. But I am asking.',
    options: [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }],
    trigger: 'quiet-cruise',
  },
  {
    id: 'q-fear', persona: 'k2', layer: 'durable', learnKey: 'biggestFear',
    text: 'What do you fear more out here — pirates, or running dry in the deep black?',
    options: [{ label: 'Pirates', value: 'pirates' }, { label: 'The deep black', value: 'the-black' }],
    trigger: 'quiet-cruise',
  },
];

/** Pick an eligible, not-yet-answered question for this persona + trigger, or null.
 *  Durable = asked once ever; session = asked once this session (cleared on game-load). */
export function pickQuestion({ persona, trigger, answeredDurable, answeredSession, hauling }) {
  const elig = QUESTIONS.filter((q) => {
    if (!q || !q.id || !Array.isArray(q.options) || q.options.length < 2) return false;
    if (q.skipWhenHauling && hauling) return false; // the state already answers it — never ask
    if (q.persona && q.persona !== 'any' && q.persona !== persona) return false;
    if (trigger && q.trigger && q.trigger !== 'any' && q.trigger !== trigger) return false;
    if (q.layer === 'durable' && answeredDurable && answeredDurable[q.learnKey] != null) return false;
    if (q.layer === 'session' && answeredSession && answeredSession[q.learnKey] != null) return false;
    return true;
  });
  return elig.length ? elig[Math.floor(Math.random() * elig.length)] : null;
}
