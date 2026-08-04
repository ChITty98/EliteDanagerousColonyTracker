// server/ai/copilotRadarLines.js
//
// Hand-written canned pools for the radar beats — same island pattern as copilotMiningLines
// (the regen tool rewrites copilotCannedData wholesale, so hand-authored pools live apart).
//
// LOAD-BEARING PHRASING RULE: EDDN is anonymized and only tool-running commanders appear, so every
// line about other pilots keeps the "…that I've heard of" hedge and NEVER names or implies an
// identity. Activity, not people. Slots: {dist} light-years, {system}.

export default {
  wash: {
    'radar-build': [
      "Picking up construction chatter about {dist} light-years out — somebody else has the same idea we did.",
      "Someone's building near {system}. Out HERE. It's a big galaxy and they had to pick our corner of it.",
      "Construction activity on the scope, {dist} light-years. I'm not saying it's a race. I'm saying we should walk faster.",
      "Heads up — new build signals near {system}. The neighborhood's filling in. Property values, sweetheart.",
      "Somebody's pouring foundations {dist} light-years from here. Wave if you see them. Then beat them to the good spots.",
    ],
    'radar-lead': [
      "Ooh — somebody just charted a world near {system} with the good stuff. Might be worth a look before anyone else gets ideas.",
      "Fresh scan on the wire, {dist} light-years out, and it matches what you look for. Just saying. It's RIGHT there.",
      "Someone found something shiny near {system}. It's not ours. It COULD be ours. I'm just the radar guy.",
      "New chart {dist} light-years away with your kind of atmosphere on it. First one there gets to name the paperwork.",
    ],
    'radar-quiet': [
      "No traffic within two hundred light-years that I've heard of. Just us and the rocks. I like it.",
      "Scope's clear — nobody out here that I've heard of. The quiet kind of night.",
      "It's just us out here, far as I can hear. Cozy. Slightly ominous. Mostly cozy.",
    ],
  },

  tars: {
    'radar-build': [
      "New colonisation activity logged {dist} light-years out, near {system}. Worth noting — that's inside your operating area.",
      "Construction signals near {system}. Someone's expanding this way. I'd call it flattery if it weren't also competition.",
      "Build event on the stream, {dist} light-years. The frontier is moving. Recommend we keep moving faster.",
      "Somebody broke ground near {system}. Noted, logged, and — professionally speaking — worth a glance at the map.",
    ],
    'radar-lead': [
      "A freshly charted body {dist} light-years out matches your site criteria. Flagging it as a potential target — it's new enough that nobody's planned around it.",
      "New scan near {system} fits your atmosphere profile. This is the kind of lead that has a shelf life.",
      "Someone just charted a match for your criteria, {dist} light-years away. First-mover windows don't stay open. Teaching moment over.",
      "Live discovery near {system} — passes your site test. It wasn't in your data an hour ago. Now it's in your ear.",
    ],
    'radar-quiet': [
      "No commanders within two hundred light-years that I've heard of. Statistically restful.",
      "Scope's quiet — nothing on the stream from this neighborhood. Just us, working.",
      "All clear out here, as far as the stream tells it. I'll keep listening.",
    ],
  },

  k2: {
    'radar-build': [
      "Someone is building within two hundred light-years. I do not like surprises. Neither should you.",
      "Construction activity near {system}. Statistically, competition. Practically, hurry up.",
      "New build signals, {dist} light-years out. The frontier does not wait, and apparently neither do they.",
      "Somebody chose to colonise near {system}. Bold. Inconvenient. Monitoring.",
    ],
    'radar-lead': [
      "A body {dist} light-years out just matched your criteria. Freshly charted. Unclaimed, probably. Briefly.",
      "New scan near {system} passes your site test. The odds of it staying unnoticed are poor. Act accordingly.",
      "Live match on the stream, {dist} light-years away. I would call it luck, but someone else's scanner did the work.",
    ],
    'radar-quiet': [
      "No activity within two hundred light-years that I have heard of. Either we are alone, or everyone else is quieter than you.",
      "The scope is empty. As far as the stream knows, we are the only ones out here. Enjoy it. It will not last.",
      "Nothing nearby that I have heard of. I am choosing to find that reassuring.",
    ],
  },
};
