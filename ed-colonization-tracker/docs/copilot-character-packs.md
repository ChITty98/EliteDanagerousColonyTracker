# Co-Pilot Character Packs

The cockpit (`/cockpit`) shows your co-pilot in the seat and swaps his image to
match the live **mood** of whatever he just reacted to. A "character pack" is a
folder of images — one per mood — that you can drop in and select from the
**Character** dropdown. Make as many as you want and trial them by switching.

## Where packs live

Next to the exe, in a `copilot-characters/` folder (created automatically):

```
copilot-characters/
  chewie/
    calm.png        ← required (fallback for any missing mood)
    panic.png
    relief.png
    brace.png
    awe.png
    hyped.png
    proud.png
    somber.png
    wave.png
    pack.json       ← optional ( { "name": "Chewie" } )
  tars/
    calm.png
    ...
```

The folder name is the pack **id**; it shows in the dropdown (or the `name` from
`pack.json` if present). No restart needed beyond reloading `/cockpit`.

## The images

- **One full scene per mood** — the character **seated in the ship's co-pilot
  seat, facing you** (like a video call), expressing that mood. The whole frame
  is the image; there's no compositing.
- **16:9**, e.g. **1920×1080** (1280×720 is fine). PNG (JPG/WebP also served).
- Keep the **camera, seat, framing, lighting, and character identical** across
  moods — only the **expression/pose** changes. Consistency is what sells it.
- `calm.png` is the **only required file** — any mood without its own image falls
  back to it. So a one-image pack works; add the rest as you go.

### The moods (and what he's feeling)

| File | When it shows | Expression direction |
|---|---|---|
| `calm.png` | default / cruising | relaxed, content, settled in the seat, easy look |
| `panic.png` | interdicted | alarmed, wide-eyed, leaning forward — "they've got us!" |
| `relief.png` | escaped the interdiction | exhaling, easing back, relieved grin |
| `brace.png` | taking damage / overheating | tense, gritted, braced against a hit |
| `awe.png` | scanned something special | wonder, wide eyes, looking out the canopy |
| `hyped.png` | big payout / first discovery | big grin, celebrating, high energy |
| `proud.png` | docking at a colony you built | warm, satisfied, chest up |
| `somber.png` | ship destroyed | subdued, quiet, downcast |
| `wave.png` | you disembark / dismiss the ship | friendly, waving you off — "don't be long" |

## Generating a pack (any image tool)

Write a **character bible** once, then reuse it for every mood prompt so the
character stays the same. Fill the brackets:

> **Character bible:** A [species / kind — e.g. "large, shaggy, friendly alien
> co-pilot, Chewbacca-like but original"], [build], [fur/skin + colour],
> [distinctive features], wearing [outfit]. Sitting in the **right-hand co-pilot
> seat of a starship cockpit**, **facing the camera** as if on a video call.
> Cockpit: [ship interior style — dark panels, glowing readouts, canopy with
> stars]. Cinematic, consistent lighting, chest-up framing, 16:9.

Then one prompt per mood = **bible + the expression direction** from the table:

> `<character bible>`, **wide-eyed and alarmed, leaning toward the controls, like
> the ship is being pulled out of supercruise** — *(this is `panic.png`)*

Tips for consistency:
- Generate `calm.png` first; lock the seed / reference image, then vary only the
  expression line for the others.
- Same crop and distance every time — he shouldn't jump around between moods.
- Tools with a "character reference" / consistent-character feature work best.

## `pack.json` (optional)

```json
{ "name": "Chewie" }
```

Just the display name for the dropdown for now. (The **voice** is set separately
in the cockpit's Voice control — Chewie pairs well with *Wingman*, TARS with
*Dry*, a stern human with *Military*.)

## Using it

`/cockpit` → **Character** dropdown → pick your pack. Hit **⛶ Fullscreen** to put
it on the second screen. Switching characters is instant.
