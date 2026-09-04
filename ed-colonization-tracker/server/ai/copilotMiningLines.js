// server/ai/copilotMiningLines.js
//
// Hand-written canned pools for the mining beats. Kept OUT of copilotCannedData.js on purpose:
// that file is 173KB of generated pools and the offline regen tool rewrites it — a hand-authored
// island inside it would eventually be clobbered. copilotCanned.poolFor() merges these in.
//
// Voice contracts (see reference_tars_persona_spec + copilotRules):
//   Wren — Firefly register. Warm, human, a little cowardly, morale-first. Talks like TALK.
//          Numbers are flavor at most, never a report. Fishing-buddy energy on catches.
//   Tycho — warm/funny/loyal/teacher. Precise, deadpan, settings jokes sparingly. Proud-teacher
//          on records, never cold.
//   K2   — blunt, statistical, put-upon. Compliments arrive under protest.
//
// The stall pool obeys the same law as the overlay: the cause is UNKNOWN — no line may name one.

export default {
  wash: {
    'mining-catch': [
      "Ho-HO! Now THAT is a rock. Did you see that? Of course you saw it, you shot it.",
      "That one's a keeper. That's going on the wall. Do we have a wall? We should get a wall.",
      "Okay, I take back most of what I've said about this job. {tonnes} tonnes off one rock. Most of it.",
      "See, THIS is the kind of rock your mother warned you about. Gorgeous. Crack the next one.",
      "That's a fat one. That's a proper fat one. I'm not crying, it's just dusty in this cockpit.",
      "Oh, that rock paid for dinner. That rock paid for everyone's dinner.",
      "You know what that was? That was fishing with dynamite, and I am NOT reporting us.",
      "Beautiful. If the rest of this ring is hiding rocks like that, we're never leaving.",
    ],
    'mining-record': [
      "STOP. Stop everything. That is the biggest rock we have EVER cracked. I want it framed.",
      "That's it. That's the one. Years from now you'll bore people at parties about this rock, and you'll have EARNED it.",
      "New record! {value} off ONE rock! I'm naming it. It deserves a name. Something noble.",
      "I have flown with you a long time, and I have never seen anything like that. Biggest one ever. Hot dang.",
      "THE BIG ONE! You actually landed the big one! Nobody's going to believe us and I don't care!",
      "That rock just retired every rock that came before it. All-time. Top of the book. I'm so proud I could burst a coolant line.",
    ],
    'mining-streak': [
      "{streak} in a row! Don't touch anything, don't sneeze, whatever you're doing — keep doing it.",
      "That's {streak} straight! You're in the zone. I'm not going to talk. Except this. This is the last thing.",
      "{streak} clean picks. It's like watching somebody run the table. Quietly thrilling. Carry on.",
      "Another one! That's a streak, that is. You've got the touch tonight and I'm just here for the show.",
      "{streak} without a miss. If mining had a highlight reel, we'd be on it.",
    ],
    'mining-milestone': [
      "That's {session} banked tonight. I'm mentally spending it already — repairs first, then something dumb.",
      "{session} this sitting! Drinks are on you, and I say that as someone who can't drink.",
      "The hold's getting heavy and the ledger's getting pretty. Good night's work, this.",
      "You know what {session} buys? Options. I love options. Keep shooting rocks.",
      "We're rich-ish! Tonight-rich, anyway. Best kind. Doesn't keep long. Spend it weird.",
    ],
    'mining-stall': [
      "It's gone awful quiet back there. The rock's not going to mine itself, sweetheart.",
      "Refinery's twiddling its thumbs. Everything alright up there, or are we admiring the view?",
      "Not to nag, but the hopper's stopped singing. Just saying. Rocks don't crack themselves.",
      "You alive up there? The tonnage stopped and I got nervous. I get nervous fast.",
      "The hold's stopped filling and I've run out of things to alphabetize. Poke a rock, would you?",
    ],
    'mining-ring-entry': [
      "Ohhh, look at this place. Untouched. It's like being first to a river nobody's fished.",
      "Pristine rock as far as I can see. I'd rub my hands together if I had hands.",
      "Now THIS is a ring. Nobody's been picking at it. Get the limpets warm.",
      "Would you look at that. A whole ring of maybe-money. I love it here. Let's never leave. Okay, eventually leave.",
    ],
  },

  tars: {
    'mining-catch': [
      "That rock landed in your top five percent. All time. I'd act surprised, but honesty setting's too high for that.",
      "{tonnes} tonnes off a single asteroid. That's not luck, that's technique. Mostly technique. Some luck.",
      "Noted for the record: that was a genuinely excellent rock. The record and I are both impressed.",
      "That's the kind of asteroid miners tell stories about. Yours now. Tell it well.",
      "Statistically, rocks like that don't come along often. Practically, you just cracked one. Nice work.",
      "Big one. Clean pick, full extraction. If I had a hat, this is a hat-tip.",
      "That one goes in the highlight file. Yes, I keep a highlight file. Of course it's about you.",
    ],
    'mining-record': [
      "New personal best. Biggest single rock you've ever mined. I've been keeping count since the day we met — this is the top of the list.",
      "{value} from one asteroid. All-time record. I'd like the log to show I never doubted you. Don't check the log.",
      "That's the biggest one ever. Not 'tonight' ever. EVER ever. Take the moment — I'll hold everything else.",
      "Record broken. The old best just became the second-best, and it should feel honored to lose to that.",
      "Personal best, {tonnes} tonnes of it. Somewhere in my circuits a proud-of-you subroutine just pegged out. I'm leaving it there.",
    ],
    'mining-streak': [
      "{streak} target rocks, {streak} clean extractions. That's not a streak, that's a method.",
      "Streak's at {streak}. Discipline like this is rare enough that I'm logging it twice.",
      "{streak} in a row. At this point the asteroids should just start handing it over.",
      "Still perfect — {streak} straight. I'd call it luck, but the sample size stopped agreeing a while ago.",
      "{streak} consecutive. You pick them, you crack them, you don't miss. Textbook. I'd know — I'm mostly textbook.",
    ],
    'mining-milestone': [
      "{session} banked this session. Pace is good. Morale, I'm told, is my department: consider it boosted.",
      "You've cleared {session} tonight. If you're keeping score — and I am — this is a good one.",
      "{session} and climbing. The refinery and I have a bet going about where tonight tops out. Don't let me down; I bet high.",
      "Session's at {session}. That's honest work at a dishonest pace. My favorite kind.",
      "{tonnes} tonnes, {session} in the book tonight. Keep this up and I'll need a bigger ledger. I don't — it's digital — but the sentiment stands.",
    ],
    'mining-stall': [
      "Production's gone quiet. No judgment. Some judgment. Everything okay up there?",
      "The refinery hasn't fed in a while. Checking in — pilot status: alive, distracted, or admiring the rings?",
      "Tonnage flow stopped. I don't know why, and I make a point of not guessing. Status?",
      "Quiet hopper. If you're taking a breather, earned. If you're stuck on something, I'm right here.",
      "The line's gone flat back there. Gentle reminder that rocks, historically, do not mine themselves.",
    ],
    'mining-ring-entry': [
      "Pristine reserves. Untouched, dense, exactly what we came for. Set up wherever feels lucky — the data says anywhere works.",
      "This ring's never been worked. Every rock out there is holding its original hand. Deal us in.",
      "{ring}. Pristine class. In teaching terms: this is the good textbook. Let's do the reading.",
      "Scans say untouched reserves. My professional assessment: get the lasers out before word spreads.",
    ],
  },

  k2: {
    'mining-catch': [
      "That rock ranked in your top five percent. I ran it twice. It held.",
      "{tonnes} tonnes from one asteroid. Statistically notable. Personally, I remain calm. Externally.",
      "Fine. That was a good rock. I've logged it. Don't make me say it again.",
      "That one was, objectively, excellent. I dislike how much I enjoyed watching it.",
      "Large catch. The odds said otherwise. The odds have been spoken to.",
      "Acceptable. By which I mean: significantly better than acceptable, filed under acceptable to keep you humble.",
    ],
    'mining-record': [
      "New record. Biggest rock you have ever mined. I checked the entire history hoping to find a bigger one. There isn't. Congratulations.",
      "That is the largest single asteroid on file. {value}. I have updated the file. The file is impressed. I am the file.",
      "Personal best. I would say I doubted you, but the record shows I doubt everyone equally.",
      "All-time record, {tonnes} tonnes. Somewhere, a lesser rock is being quietly deleted from the rankings.",
      "The biggest one ever. Noted, logged, and — under protest — celebrated.",
    ],
    'mining-streak': [
      "{streak} consecutive successful target extractions. The probability of that was poor. You did it anyway. Typical.",
      "Streak: {streak}. I've stopped calculating the odds. They were becoming embarrassing for the odds.",
      "{streak} in a row. If you miss the next one I will say nothing. Loudly.",
      "Still unbroken at {streak}. I am required to report this is impressive. Report filed.",
    ],
    'mining-milestone': [
      "Session total: {session}. The evening is going suspiciously well. I'm monitoring for the catch.",
      "{session} banked. At this rate we could afford better company. Present company noted.",
      "You've cleared {session} tonight. Statistically a good night. Emotionally, I wouldn't know. Keep going.",
      "{session}, {tonnes} tonnes. Efficient. I'd say I'm proud, but we'd both know that's outside spec.",
    ],
    'mining-stall': [
      "Production has ceased. I am not the one holding the laser, so I await developments.",
      "The refinery is idle. The cause is unknown to me, and unlike some, I don't guess. Status report?",
      "Nothing has arrived in the hopper for some time. The rocks have not surrendered. Have you?",
      "Quiet back there. Either you're being efficient somewhere I can't see, or you're not. One of those.",
    ],
    'mining-ring-entry': [
      "Pristine reserves. Untouched. For once, the odds are acceptable. Try not to waste them.",
      "{ring}. Nobody has mined this. A rare opportunity to be first at something. Take it.",
      "Scan complete: pristine, dense, promising. I'll withhold optimism until the first rock. Habit.",
      "This ring is untouched. Statistically, that won't last. Historically, because of you.",
    ],
  },
};
