// server/ai/copilotSurfaceLines.js
//
// Hand-written canned pools for the surface-mining beats. Kept OUT of copilotCannedData.js on
// purpose, same island pattern as copilotMiningLines.js: that file is generated and the regen
// tool rewrites it. copilotCanned.poolFor() merges these in.
//
// THE RULE (the commander's, 2026-09-04): a line may reference ONLY what the data carries —
//   • the driving band, as a quality of the ground the co-pilot can see right now
//   • the signal number ({site}) and body ({body}), sparingly
//   • hold-near when the app knows where she is (deploy point / unmanned touchdown / where a recall
//     brought her) and the SRV is within reach; hold-far otherwise. A far line prompts a recall or
//     a drive back and never says where she is or that she will move on her own.
//   • surface-recall ONLY on the recall tell (an SAASignalsFound burst seen from the SRV or on foot
//     with no unmanned Liftoff after it): she IS coming, so "on my way" is true — but never "land",
//     "set down" or "hover": which one she does depends on where the commander is standing.
//   • surface-foot-* keyed by the body's surface temperature ON FILE; the unknown pool claims nothing.
// Nothing else exists. No compass directions, no "last time", no "you rated", no terrain feature
// the app never recorded, and never a number read back. Present tense, radio from overhead.
//
// Voice contracts (see copilotMiningLines.js / reference_tars_persona_spec):
//   Wren  — Firefly register. Warm, human, a little cowardly, morale-first. Talks like TALK.
//   Tycho — warm/funny/loyal/teacher. Precise, deadpan. Never cold.
//   K2    — blunt, statistical, put-upon. Compliments arrive under protest.

export default {
  wash: {
    'surface-arrive-flat': [
      'Flat as anything down there. Try not to get bored.',
      "Easy ground on this one. Enjoy it — they're not all like this.",
      "Smooth run by the look of it. I'll keep the kettle warm.",
      'Nothing to trip over at Signal {site}. Go on.',
    ],
    'surface-arrive-bumpy': [
      'Bumpy in places. Watch the rocks.',
      'Rough patches down there — ease off over them.',
      'Bit lumpy. Keep your speed honest.',
      "Rocks on this one. Nothing you can't handle, just… handle them.",
    ],
    'surface-arrive-broken': [
      'Broken ground most of the way. Take it steady.',
      "That's rough all over. No heroics.",
      "Ugly surface. I'll be up here wincing.",
      'Not a smooth one. Mind yourself.',
    ],
    'surface-arrive-valleys': [
      'Good luck out there. I mean that.',
      'Valleys. Big ones. Radio if you go quiet.',
      "That's the hard one. I'll keep her close.",
      "Deep ground down there. Don't do anything I'd do.",
    ],
    'surface-arrive-brutal': [
      "Worse than the valleys. I'd say don't, but you will.",
      "That surface is a crime. I'll be right overhead.",
      "If you're going down there, I'm not looking away.",
      'This is the one you complain about later. Fair warning.',
    ],
    'surface-arrive-unrated': [
      'No notes on this one. First time?',
      "New ground. I'm watching.",
      "Nothing on file for Signal {site}. Tell me what it's like.",
      'Blank card down there. Go easy till you know it.',
    ],
    'surface-hold-near': [
      "Filling up — I'll hold her steady for the transfer.",
      "Getting heavy down there. I'm right here, door's open.",
      "Nearly full. I'm parked, come on back.",
      "Telemetry says you're loaded. She's not going anywhere.",
    ],
    'surface-hold-far': [
      "Telemetry says you're filling up. Bring it in when you're ready — recall me if I'm not with you.",
      "Getting heavy down there. Time to bring it back; recall me if you need me closer.",
      "You're nearly full. Recall when you're ready and I'll hold steady for the transfer.",
      "Hold's filling. Whenever you're ready, bring it in.",
    ],
    'surface-target': [
      'Still looking for that {commodity} at Signal {site}, eh?',
      "The {commodity}'s around here somewhere. Keep at it.",
      "No {commodity} yet? It's on the card for this one.",
      'Card says {commodity}. Ground says not yet.',
    ],
    'surface-ship-away': [
      "I'll be hanging out in orbit. Shout when you want me.",
      "Taking her up. I'm right overhead if you need me.",
      'Lifting off — not going far. Wave.',
      "She's up. I'll circle till you're done.",
    ],
    'surface-recall': [
      'Heard. On my way.',
      "Coming to you. Hold there.",
      "Got the call — on my way now. Don't wander off.",
      "On my way. Won't be long.",
    ],
    'surface-foot-cold': [
      "Out of the Rhino, are we? It's cold out there — keep moving.",
      "Bitter cold on that surface. Don't dawdle.",
      "You're on foot and it's freezing down there. Quick as you can.",
      "Cold one. I'd keep the walk short.",
    ],
    'surface-foot-hot': [
      "Out of the Rhino? It's hot out there — mind the suit.",
      "That surface is baking. Don't linger.",
      'On foot in that heat. Rather you than me.',
      'Hot ground. Keep it brief.',
    ],
    'surface-foot-mild': [
      'Out for a walk? Not the worst place for it.',
      'On foot. Surface looks tolerable, as these go.',
      "Stretching your legs. Fair enough — it's mild out there.",
      'Out of the Rhino. Decent enough weather, for a rock.',
    ],
    'surface-foot-unknown': [
      "Out of the Rhino? I've nothing on this surface — watch yourself.",
      'On foot. No readings on this one; take it careful.',
      "Stretching your legs on ground I can't vouch for.",
      "Out for a walk. Tell me what it's like down there.",
    ],
  },
  tars: {
    'surface-arrive-flat': [
      "Flat as a table. I'll have the kettle on.",
      'Level ground the whole way. Textbook.',
      "Easy surface. Don't get complacent — that's when it bites.",
      "Smooth run at Signal {site}. I'll narrate if it gets exciting. So, silence.",
    ],
    'surface-arrive-bumpy': [
      'Bumpy segments. Ease off over them.',
      'Uneven in patches. Keep the wheels on the ground.',
      'Some rough stretches. Nothing structural.',
      'Lumpy here and there. Speed is the enemy.',
    ],
    'surface-arrive-broken': [
      'Broken ground throughout. Slow is fast.',
      'Rough the whole way. Pick your line and commit.',
      "That surface will punish haste. So don't.",
      "Difficult ground. I'm watching every metre.",
    ],
    'surface-arrive-valleys': [
      'The valleys. Radio if you go quiet.',
      'Deep terrain. Take the long way when there is one.',
      "This is the hard one. I've got eyes on you.",
      'Big relief down there. Respect it.',
    ],
    'surface-arrive-brutal': [
      "Beyond the valleys. I'd file a complaint if there were anyone to file it with.",
      "Worst ground on the list. I'll stay low.",
      "That's not terrain, that's an argument. Go carefully.",
      'Brutal surface. Every metre counts, so count them.',
    ],
    'surface-arrive-unrated': [
      'No rating on this one. Fresh ground.',
      "Nothing on file. I'll learn it with you.",
      "Unrated signal. Treat it as hard until it isn't.",
      'New surface at Signal {site}. First impressions welcome.',
    ],
    'surface-hold-near': [
      "Nearly full. I'm right here, door's open.",
      "Hold's heavy. I'm landed and holding — bring it over.",
      "You're loaded. I'm not moving; make your way back.",
      "Full soon. I've got the ramp down.",
    ],
    'surface-hold-far': [
      "Hold's getting heavy. Recall me if I'm not with you and I'll hold position for the transfer.",
      "You're nearly full. Bring it in when you're ready — a recall gets me to you.",
      'Telemetry shows a full hold coming. Recall me when you want the transfer.',
      'Getting full. Drive it back, or recall — both work.',
    ],
    'surface-target': [
      "Still looking for that {commodity}, eh? It's logged for Signal {site}.",
      'The card for this signal says {commodity}. Patience.',
      "No {commodity} on the refinery yet. It's here somewhere.",
      'This site is on file for {commodity}. Keep looking.',
    ],
    'surface-ship-away': [
      "Taking her up. I'll hold orbit directly over you.",
      "Lifting off — I'm not leaving, just hovering.",
      "She's airborne. Say the word and I'm on my way back.",
      'Up we go. Eyes on you the whole time.',
    ],
    'surface-recall': [
      'Recall received. On my way.',
      'Coming to you now. Stay where you are.',
      'Heard you. On my way across.',
      "On my way — I'll be with you shortly.",
    ],
    'surface-foot-cold': [
      "You're out of the Rhino. It is very cold out there; keep the walk short.",
      "On foot, and the surface is frigid. The suit is doing all the work — don't ask too much of it.",
      "Cold ground. I'd make this quick.",
      'Out on foot in the cold. Efficient, please.',
    ],
    'surface-foot-hot': [
      "You're on foot and that surface is hot. Keep it short.",
      "Out of the Rhino into the heat. Mind the suit's limits.",
      'Hot ground out there. Brisk walk, not a stroll.',
      "On foot. It's scorching — don't linger.",
    ],
    'surface-foot-mild': [
      'Out of the Rhino. Temperate, as rocks go.',
      'On foot. The surface is mild — a decent place for a walk.',
      'Stretching your legs. Temperature is fair.',
      "You're out walking. The readings are kind, for once.",
    ],
    'surface-foot-unknown': [
      "You're out of the Rhino. I have no surface readings here — careful.",
      'On foot on ground I have no data for. Take it slow.',
      'Out walking. Nothing on file for this surface; tell me about it.',
      "On foot. No readings this time — I'm watching anyway.",
    ],
  },
  k2: {
    'surface-arrive-flat': [
      "Nothing to hit. Somehow you'll manage.",
      'Flat. Statistically your easiest drive. Try to enjoy it.',
      "Easy ground. I'll withhold praise until it's earned.",
      'Level surface. Boring. Boring is good.',
    ],
    'surface-arrive-bumpy': [
      "Rocks. You've met.",
      'Bumpy. Speed kills — mostly wheels.',
      'Rough patches. Drive like you mean it. Slowly.',
      "Uneven. I'd say be careful, but you'll be careful anyway. Probably.",
    ],
    'surface-arrive-broken': [
      'Broken ground. Lower your expectations and your speed.',
      "Rough throughout. I'm not fixing the wheels.",
      'Ugly. All of it. Proceed.',
      'Difficult surface. Difficult is my whole job.',
    ],
    'surface-arrive-valleys': [
      'Ah. This one.',
      "The valleys. I'll pretend not to watch.",
      'Deep terrain. Try to come back with the same number of wheels.',
      'This ground has opinions. Strong ones.',
    ],
    'surface-arrive-brutal': [
      'Worse than the valleys. I have no comfort to offer.',
      "That surface is hostile. So am I, but I'm on your side.",
      'Brutal. Every rig here is earned twice.',
      "If this goes badly I'll say I told you. I'm telling you.",
    ],
    'surface-arrive-unrated': [
      'Blank card. Impress me.',
      'No rating. Unknown ground. Assume the worst.',
      'Nothing on file. Learn fast.',
      'New signal, no notes. Your problem.',
    ],
    'surface-hold-near': [
      "Full soon. I'm not going anywhere. Obviously.",
      "Hold's heavy. I'm parked. Walk it over.",
      "Nearly full. I'm right here, and I'm staying right here.",
      'Loaded. Come back before you break something.',
    ],
    'surface-hold-far': [
      "You're nearly full. Recall me, or walk. I know which I'd pick.",
      "Hold's heavy. Recall me if I'm not there. If I am, stop reading and come aboard.",
      "Nearly full. A recall would fix that. So would driving. Your knees.",
      "Getting full. I'm available — on request. Reluctantly.",
    ],
    'surface-target': [
      'Still looking for that {commodity}, eh?',
      'Signal {site} is logged for {commodity}. Not seeing any. Yet.',
      'The {commodity} exists. Somewhere. Allegedly.',
      'No {commodity}. The card says otherwise. One of you is wrong.',
    ],
    'surface-ship-away': [
      "Lifting off. I'll be in orbit, judging.",
      'Taking her up. Try not to need me.',
      "She's up. I'm overhead. Don't get comfortable.",
      "Airborne. I'll come back. Probably.",
    ],
    'surface-recall': [
      'Recall acknowledged. Coming.',
      'On my way. Try not to move.',
      'Inbound. Again.',
      'Heard. Inbound.',
    ],
    'surface-foot-cold': [
      'Out of the Rhino. It is cold. This was your decision.',
      'On foot in the cold. Your suit disagrees with this plan.',
      'Freezing surface. Walk faster.',
      'You have left the heated vehicle for the cold ground. Noted.',
    ],
    'surface-foot-hot': [
      'Out of the Rhino. It is hot. Also your decision.',
      'On foot in the heat. The suit will complain before you do.',
      'Scorching ground. Make it brief.',
      'You left the cooled vehicle for the hot ground. Noted.',
    ],
    'surface-foot-mild': [
      'Out of the Rhino. Conditions are tolerable. Rare.',
      'On foot. The surface is mild. I have no complaint. Yet.',
      'A walk. Temperature is acceptable. Enjoy the novelty.',
      'Out walking on a rock that is neither one extreme nor the other. Fortunate.',
    ],
    'surface-foot-unknown': [
      'Out of the Rhino. I have no readings for this surface. Proceed accordingly.',
      'On foot. Data on this ground: none. Confidence: low.',
      'You are walking on something I cannot characterise. Careful.',
      'Out on foot. No file on this surface. I am watching regardless.',
    ],
  },
};
