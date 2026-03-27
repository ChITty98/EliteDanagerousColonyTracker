# Battlefield Trivia — 1942 & Vietnam

A web-based trivia game testing your knowledge of **Battlefield 1942** and **Battlefield Vietnam**.

![Questions](https://img.shields.io/badge/Questions-95%2B-gold) ![Categories](https://img.shields.io/badge/Categories-11-green) ![Map Images](https://img.shields.io/badge/Map%20Images-43-blue)

## How to Play

1. Clone the repo
   ```bash
   git clone https://github.com/ChITty98/OriginalBattlefieldTrivia.git
   cd OriginalBattlefieldTrivia/bf-trivia
   ```
2. Run the server:
   ```bash
   node serve.js
   ```
3. Open **http://localhost:3333** in your browser

No dependencies required — just Node.js.

## Categories

### Battlefield 1942
| Category | Questions | Description |
|----------|-----------|-------------|
| Vehicles & Hardware | 15 | Tanks, planes, ships — which spawns where? |
| Maps & Factions | 14 | Battles, theaters, and who fought whom |
| Gameplay & Tactics | 12 | Kits, mechanics, mods, and meta knowledge |
| Screenshots | 22 | Identify maps from in-game images |

### Battlefield Vietnam
| Category | Questions | Description |
|----------|-----------|-------------|
| Vehicles & Hardware | 12 | Hueys, Phantoms, patrol boats & more |
| Maps & Factions | 11 | Jungles, cities, and operations |
| Gameplay & Features | 13 | Music, mechanics, and innovations |
| Screenshots | 8 | Identify maps from in-game images |

### Challenge Modes
| Mode | Description |
|------|-------------|
| Both Games Mixed | All screenshot questions from both games shuffled together |
| Everything | All text-based questions from both games |
| Veteran Difficulty | Only the hardest questions |

## Features

- **Timed questions** — 20 seconds for text, 30 seconds for image questions
- **Score streaks** — consecutive correct answers earn bonus points
- **Fun facts** — learn something new after every question
- **High scores** — personal bests saved per category (localStorage)
- **Shuffled answers** — answer order randomized every time
- **Themed UI** — gold accent for 1942, green for Vietnam

## Question Types

- **Vehicle spawns** — What tanks/planes/helicopters appear on which maps?
- **Faction matchups** — Which factions fight on each map?
- **Map identification** — Name the map from screenshots and gameplay images
- **Gameplay knowledge** — Classes, weapons, mechanics, game modes
- **Historical context** — Real battles and operations behind the maps
- **General trivia** — Release dates, expansions, mods, features

## Map Images

43 map images sourced from the [Battlefield Wiki](https://battlefield.fandom.com/) including:
- Map thumbnail/overview images for both games
- In-game gameplay screenshots (Wake Island, Omaha Beach, Kursk, El Alamein, Guadalcanal, Iwo Jima, Midway)
- All images stored locally — no external dependencies

## Tech

Single HTML file with embedded CSS and JavaScript. No frameworks, no build step, no dependencies beyond Node.js for the simple static file server.

## License

Map images are from the [Battlefield Wiki](https://battlefield.fandom.com/) (CC-BY-SA). Game content is property of EA/DICE.
