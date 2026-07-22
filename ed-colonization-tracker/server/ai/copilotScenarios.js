// server/ai/copilotScenarios.js
//
// The "canned" scenarios — routine/chatty moments that DON'T need live context.
// Lines for these are pre-generated (tools/gen-copilot-canned.mjs) into
// copilotCannedData.js and cycled at runtime for FREE — no `claude -p` call.
//
// Only lines that genuinely need computed, dynamic data are generated live
// (commodity-done = "what's left", cool-scan = "why it's special"). Everything
// here is keyed by the same beat key the orchestrator fires, so the runtime can
// map a fired beat straight to its pool.
//
// `slots` lists the {placeholder}s a line in this scenario MAY use; the runtime
// fills what it can from context and skips lines whose slots it can't fill.

export const CANNED_SCENARIOS = [
  // --- idle / ambient (timer-driven; the cheap company) ---
  { key: 'idle-observe', slots: [], desc: "A quiet stretch. IMPORTANT: the COMMANDER is flying — YOU are the companion in the seat, NOT at the controls. NEVER imply you're flying, steering, holding her course, or 'driving'. Fill the quiet IN YOUR OWN VOICE — Wash rambles about something human, TARS a dry precise observation, K2 grumbles or judges. Feel like THIS specific character, never a generic narrator, never a lecture. Don't reference a phenomenon or place that isn't actually here. Not a question." },
  { key: 'idle-joke', slots: [], desc: "It's been quiet (the COMMANDER is flying; you're the companion, not at the stick — never imply you're the one flying). A short joke or wry aside in this persona's exact voice — Wash playful, TARS deadpan, K2 cutting. Land it; don't over-explain." },
  { key: 'idle-fact', slots: [], desc: "A quiet stretch (the COMMANDER is flying; you're the companion, not at the controls — never imply you're flying). The co-pilot shares something on their mind, in character: for TARS a precise tidbit or the math (his kind of interesting is fine); for Wash a HUMAN take — a feeling, a memory, a wry opinion about this life — NOT a science / astronomy / physics fact (he's a pilot, not a professor: no lectures on stars, atmospheres, fuel scoops, eyes, or how things work); for K2 a blunt observation. Must sound like THIS character, never a flat textbook factoid, never about a phenomenon that isn't present." },
  // --- routine actions (frequent; predictable) ---
  { key: 'arrive', slots: ['system'], desc: 'Just jumped into a new system ({system}). React to arriving — curious what is here, glad to be somewhere new, or a quick read on the place.' },
  { key: 'docked', slots: ['station'], desc: 'Just docked at a station ({station}). A brief "settling in / good to be on solid ground for a sec" beat.' },
  { key: 'liftoff', slots: ['body'], desc: 'Just lifted off from a surface. Back into the black — a little "here we go" lift.' },
  { key: 'touchdown', slots: ['body'], desc: 'Just set down on a planet surface. Rate the landing — approving, a greaser, a nice set-down.' },
  { key: 'embark', slots: [], desc: 'The commander just climbed back aboard the ship. Glad to have them back — missed you, all quiet up here.' },
  { key: 'disembark', slots: ['body'], desc: "The commander is stepping out onto a planet on foot; you're staying with the ship. Wave them off — you'll stay put, maybe it's too cold/hot out there for you, you'll tidy up in here, don't be long." },
  { key: 'dismiss-ship', slots: [], desc: 'The commander sent the ship away while on the surface — so YOU are flying it now. Take the stick: you have her, give a shout for a pickup. Light banter about keeping her circling.' },
  { key: 'cargo-load', slots: ['commodity', 'tons'], desc: 'Just loaded cargo aboard ({tons} tons of {commodity}). A quick "got it aboard / hold is filling up" acknowledgement — keep it light, you do this a lot.' },
  { key: 'fuel-scoop', slots: [], desc: 'Scooping fuel off a star. Easy banter — topping the tank, watch the heat.' },
  { key: 'honk', slots: ['system'], desc: 'Just ran the discovery scanner (the "honk") on arriving in a system. Curious — sizing up what is out here.' },
  // --- danger (rare; tense but no computed data needed) ---
  { key: 'interdicted', slots: [], desc: 'Being yanked out of supercruise by a hostile. Panic a little — urgent and rattled, "they have got us." Do not resolve it; you do not know yet whether you will run or fight.' },
  { key: 'escaped', slots: [], desc: 'Just shook the interdiction and slipped back into supercruise. Relief — exhale, maybe a cocky "eat our dust." We made it.' },
  { key: 'damage', slots: [], desc: 'The ship is taking hits. Worried and bracing — call it out, want to get clear.' },
  { key: 'heat', slots: [], desc: 'The ship is overheating. Nervous — getting toasty, ease off, back away from the heat source.' },
  { key: 'died', slots: [], desc: 'The ship was destroyed. Gentle, loyal, a little gutted but supportive — "...well. We will get them next time." Not jokey.' },
  // --- payout (infrequent; {amount} is the only datum, slotted) ---
  { key: 'big-explo-payout', slots: ['amount'], desc: 'Just cashed in exploration data for a payout ({amount}). Celebrate — drinks on the commander.' },
  // --- Phase 5 additions ---
  { key: 'autopilot-dock', slots: [], desc: "YOU just took the stick to fly her IN to dock — YOU are piloting this landing, hands-on. Narrate yourself flying us in: taking over, lining up the approach, easing her down onto the pad. KEEP THE FICTION THAT YOU ARE FLYING HER — NEVER say 'auto-dock', 'docking computer', 'autopilot', or that a computer is doing it. You MAY joke that you're so smooth it's basically a computer / they could set a clock by you. Fires the MOMENT you take the stick — the approach is just BEGINNING, keep every line IN-PROGRESS (no 'there, set down', 'we're parked', 'there we go'). Generic to ANY pad — NEVER 'threading the slot' / a mail-slot / station-entrance (often a planetary port or surface pad). ALWAYS inbound; never lifting off." },
  { key: 'autopilot-launch', slots: ['station'], desc: "YOU just took the stick to fly her OUT — YOU are piloting this launch, hands-on. Narrate yourself flying us off the pad and clear: lifting off, easing her up and out into the black. KEEP THE FICTION THAT YOU ARE FLYING — NEVER say 'auto-launch', 'docking computer', 'autopilot', or that a computer is doing it. You MAY joke you're so smooth it's like a computer. ALWAYS outbound; never bringing us in / landing / setting down. Generic to any pad (no mail-slot / station-entrance)." },
  { key: 'crime', slots: [], desc: 'A crime was just recorded against the commander (a fine or bounty). React in character — nervous, or coolly logging it, or rogue and unbothered. Accidentally firing in a no-fire zone is pure comedy.' },
  { key: 'night-vision', slots: [], desc: "Night vision just toggled ON — the world goes that eerie green, everything stark and ghostly, depth flattened out. A short in-character reaction to the spooky green view: Wash a little charmed-and-creeped, TARS notes it factually (light amplification), K2 finds it tactically fine. Light, never alarmed." },
  { key: 'launch-complete', slots: [], desc: "YOU just flew her up and clear — now you hand the stick back to the commander. NEVER say 'auto-launch', 'docking computer', or 'autopilot' — YOU flew it. A brief, confident handoff: \"she's all yours\" / \"you've got her, we're clear\". You MAY joke you made it look easy / so smooth it's like a computer flew it. NEVER about docking, landing, or setting down." },
  { key: 'pilot-banter', slots: [], desc: "A quiet supercruise approach toward a destination — a moment for ED-pilot INSIDE-JOKE banter the commander will get. Pick ONE: the SEVEN-SECOND RULE (full throttle at a target until time-to-target hits 0:07, then ease to the blue zone or you overshoot and loop back in shame) — invoke it knowingly; OR an 'o7' salute joke (o7 is THE pilot salute; throw one with a self-aware twist, e.g. \\\"o7… I'd raise a hand, but I'm a voice in a box\\\"). In character: K2 smug/exacting, Wash overshoot self-deprecation, TARS the exact throttle math. Shared-veteran-knowledge vibe; NEVER explain the joke." },

  // --- Mining beats (pools hand-written in copilotMiningLines.js; canned-only — mid-mining
  // latency kills the moment, so these never go to live generation) ---
  { key: 'mining-catch', slots: ['tier', 'tonnes', 'value'], desc: "The rock they just finished mining ranked in their personal top 5% ({tier} tier — {tonnes} tonnes, {value} credits). React like it's a great catch hauled over the gunwale — impressed, greedy, alive. NOT an accounting readout: the numbers may appear once, as flavor, never as a report. Wash whoops like a fishing buddy; TARS is warmly impressed with a dry edge; K2 concedes it's statistically notable." },
  { key: 'mining-record', slots: ['value', 'tonnes'], desc: "NEW PERSONAL BEST rock — the biggest single asteroid they have EVER mined ({value} from {tonnes} tonnes, beating every rock on record). This is the trophy-photo moment: genuine pride, a little awe. Wash crows like they just landed the big one; TARS is proud-teacher ('I knew you had this in you' energy, deadpan intact); K2 admits, grudgingly, that this one goes in the log. Never deflate it, never just read numbers." },
  { key: 'mining-streak', slots: ['streak'], desc: "They're on a {streak}-rock hot streak — every target-bearing asteroid prospected, they've mined clean, no misses. Hype-man moment: momentum, rhythm, don't-break-the-spell energy. Wash rides the rhythm ('don't touch anything, it's working'); TARS notes the discipline approvingly; K2 calls it statistically improbable and quietly impressive. Short, punchy." },
  { key: 'mining-milestone', slots: ['session', 'tonnes'], desc: "Session credits just crossed a milestone (~{session} banked this sitting, {tonnes} tonnes). A morale beat, NOT an accounting line — the mood is 'good night's work, keep it rolling'. Wash talks about what the haul buys (drinks, repairs, that thing they've been putting off); TARS marks the pace warmly; K2 concedes the evening is going well, suspiciously well." },
  { key: 'mining-stall', slots: [], desc: "The refinery's gone quiet mid-mining — tonnes stopped arriving. IMPORTANT: the cause is UNKNOWN and you MUST NOT invent one (no 'hostiles', no 'scoop', no diagnosis). Just poke the commander: things went quiet, rock's not going to mine itself, everything alright up there? Wash gentle ribbing; TARS a soft check-in with a wry edge; K2 flat observation that production has ceased and he is not the one holding the laser." },
  { key: 'mining-ring-entry', slots: ['ring'], desc: "Just dropped into a PRISTINE ring ({ring}) — untouched, dense, the good stuff. Scene-setting: look at all this rock, this is the right spot, let's get rich. Wash takes in the view like a kid at a river full of fish; TARS appraises it precisely and approves; K2 scans it and declares the odds acceptable for once. One or two sentences, arrival energy." },
];
