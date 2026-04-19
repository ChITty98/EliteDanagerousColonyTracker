import { useState } from 'react';

interface FaqItem {
  question: string;
  answer: React.ReactNode;
  category: string;
}

const faqItems: FaqItem[] = [
  // --- About ---
  {
    category: 'About',
    question: 'What is ED Colony Tracker?',
    answer: (
      <>
        <p>
          ED Colony Tracker is a companion app for Elite Dangerous focused on
          colonization, expansion scouting, and hauling logistics. It runs entirely
          on your local machine &mdash; a single executable that serves a web UI
          you open in your browser.
        </p>
        <p className="mt-2"><strong>Core features:</strong></p>
        <ul className="list-disc ml-5 mt-1 space-y-1">
          <li><strong>Colonization dashboard</strong> &mdash; Track all your colony projects, stations, tier advancement, and commodity progress in one place.</li>
          <li><strong>Hauling sessions</strong> &mdash; Start a session, and the app tracks every contribution, calculates what you still need to buy, and shows load lists.</li>
          <li><strong>Expansion scouting</strong> &mdash; Search for nearby systems, score them for colonization potential, and compare candidates side-by-side.</li>
          <li><strong>In-game overlay</strong> &mdash; Real-time overlay messages via EDMC showing scores, commodity needs, load lists, and discovery callouts.</li>
          <li><strong>Chat commands</strong> &mdash; Type <code>!colony</code> commands in any in-game chat to trigger overlay responses on demand.</li>
          <li><strong>Market sourcing</strong> &mdash; Find where to buy commodities using local market snapshots and live Ardent Insight data.</li>
          <li><strong>Journal history</strong> &mdash; Analyze years of gameplay across all your journal files &mdash; systems visited, distance travelled, discoveries, combat, trade, and more.</li>
          <li><strong>Gallery</strong> &mdash; Screenshot gallery for your colonies and installations.</li>
        </ul>
      </>
    ),
  },
  {
    category: 'About',
    question: 'What is the design philosophy?',
    answer: (
      <>
        <p>
          <strong>Standalone-first, API-augmented, game-integrated.</strong>
        </p>
        <ul className="list-disc ml-5 mt-2 space-y-2">
          <li>
            <strong>Standalone-first</strong> &mdash; The app works entirely from
            local files. Your Elite Dangerous journal files are the primary data
            source. All project data, settings, scouted systems, and market snapshots
            are stored locally in your browser (IndexedDB). No account, no login,
            no cloud dependency.
          </li>
          <li>
            <strong>API-augmented</strong> &mdash; External APIs enrich the experience
            but are never required. Spansh provides body data for systems you haven&rsquo;t
            personally scanned. Ardent Insight provides live market prices. If these
            services are down, everything still works from your local data.
          </li>
          <li>
            <strong>Game-integrated</strong> &mdash; The in-game overlay (via EDMC)
            and chat commands (<code>!colony</code>) let you interact with the app
            without alt-tabbing. The journal watcher processes events in near-real-time
            so the overlay reacts within 2&ndash;3 seconds of in-game actions.
          </li>
        </ul>
      </>
    ),
  },

  // --- Getting Started ---
  {
    category: 'Getting Started',
    question: 'How does this app read my journal data?',
    answer: (
      <>
        <p>
          The app uses the <strong>File System Access API</strong> built into
          Chromium-based browsers (Chrome, Edge, Brave). When you click
          &quot;Select Folder&quot; on the Settings page or &quot;Import from
          Journal&quot; on the Dashboard, you grant read-only access to your
          Elite Dangerous journal folder.
        </p>
        <p className="mt-2">
          <strong>Initial sync</strong> reads every Journal.*.log file in the
          folder, parsing Docked, FSDJump, ColonisationContribution, Market,
          Location, Scan and other events to build a complete picture of your
          colonization progress, scouted systems, carrier cargo, etc.
        </p>
        <p className="mt-2">
          <strong>Live watcher</strong> then polls the active journal file every
          2 seconds. When Elite Dangerous writes new events, the app reads only
          the new bytes (incremental read), parses them, and updates the UI and
          overlay in near-real-time with a 500ms debounce.
        </p>
        <p className="mt-2 text-muted-foreground text-xs">
          Journal folder is usually at: C:\Users\YourName\Saved Games\Frontier
          Developments\Elite Dangerous
        </p>
      </>
    ),
  },
  {
    category: 'Getting Started',
    question: 'Do I need to re-sync every time I open the app?',
    answer: (
      <>
        <p>
          All project data, settings, scouted systems, and gallery images are
          persisted in your browser&rsquo;s local storage (IndexedDB). You do
          <strong> not</strong> lose data between sessions.
        </p>
        <p className="mt-2">
          However, the journal folder permission is not persisted across browser
          restarts in all configurations. If the app says &quot;No folder
          selected&quot; on the Settings page, click &quot;Select Folder&quot;
          again to re-grant access. A quick sync from the Dashboard will catch
          up on any events that happened while the app was closed.
        </p>
      </>
    ),
  },
  {
    category: 'Getting Started',
    question: 'What happens if I have very old journal files in the folder?',
    answer: (
      <p>
        The app handles mixed journal file formats correctly. Elite Dangerous
        changed its journal filename format from <code>Journal.YYMMDD...</code>{' '}
        to <code>Journal.YYYY-MM-DDTHH...</code> over the years. Files are
        sorted by modification date (not filename) so the correct &quot;latest&quot;
        file is always identified, regardless of naming format. Old files are
        still read during initial sync for historical data.
      </p>
    ),
  },

  // --- Journal Sync & History ---
  {
    category: 'Journal Sync & History',
    question: 'What does the journal sync actually extract?',
    answer: (
      <>
        <p>
          The initial sync reads <strong>every</strong> journal file in your folder &mdash;
          potentially hundreds of files spanning years of gameplay. It extracts:
        </p>
        <ul className="list-disc ml-5 mt-2 space-y-1">
          <li><strong>Colonization data</strong> &mdash; Construction depots, contribution events, system claims, beacon placements, and completed projects.</li>
          <li><strong>Station &amp; system knowledge</strong> &mdash; Every system you&rsquo;ve visited and every station you&rsquo;ve docked at, with coordinates, population, station types, and market IDs.</li>
          <li><strong>Fleet Carrier data</strong> &mdash; Carrier buy events, callsigns, market IDs, and cargo transfer history.</li>
          <li><strong>Exploration data</strong> &mdash; Body scans, FSS discoveries, and FSSAllBodiesFound events used for expansion scoring.</li>
          <li><strong>Market snapshots</strong> &mdash; Full commodity listings from Market.json captures at stations and carriers.</li>
        </ul>
        <p className="mt-2">
          This means the app knows about hundreds or thousands of systems and stations
          from your personal history, which powers features like the expansion scouting
          (marking systems you&rsquo;ve already visited) and the &ldquo;Sources&rdquo; page
          (finding commodity sellers from stations you&rsquo;ve docked at).
        </p>
      </>
    ),
  },
  {
    category: 'Journal Sync & History',
    question: 'What is the Journal History page?',
    answer: (
      <>
        <p>
          The Journal History page (accessible from the navigation) performs a deep scan
          of <strong>all</strong> your journal files and compiles lifetime statistics:
        </p>
        <ul className="list-disc ml-5 mt-2 space-y-1">
          <li><strong>Travel</strong> &mdash; Total jumps, distance travelled, unique systems visited, stations docked at, most-visited systems with dates.</li>
          <li><strong>Exploration</strong> &mdash; Systems honked, bodies scanned, surfaces mapped, first discoveries (Earth-likes, water worlds, ammonia worlds), planet landings, exploration earnings.</li>
          <li><strong>Combat</strong> &mdash; Bounties collected, combat bonds, deaths, interdictions and escapes.</li>
          <li><strong>Trade</strong> &mdash; Tons bought/sold, credits spent/earned, missions completed, top traded commodities, colonization contributions.</li>
          <li><strong>Game stats</strong> &mdash; Time played, current wealth, farthest distance from Sol, engineers used.</li>
        </ul>
        <p className="mt-2">
          It also includes a <strong>system search</strong> so you can look up any system
          and see how many times you visited it and when. The scan processes all files
          from scratch each time (data is not persisted between sessions yet).
        </p>
      </>
    ),
  },

  // --- Expansion Scouting & Scoring ---
  {
    category: 'Expansion Scouting',
    question: 'How does the colonization scoring system work?',
    answer: (
      <>
        <p>
          Each system is scored on how suitable it is for colonization. The score is
          a sum of category points, with a theoretical maximum around 160+:
        </p>
        <table className="mt-2 text-xs w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-1 pr-4">Category</th>
              <th className="text-left py-1 pr-4">Points</th>
              <th className="text-left py-1">Details</th>
            </tr>
          </thead>
          <tbody className="text-muted-foreground">
            <tr className="border-b border-border/30">
              <td className="py-1 pr-4 text-foreground">Star Type</td>
              <td className="py-1 pr-4">up to 60</td>
              <td className="py-1">Black Hole/Neutron: 20, O-type: 18, Wolf-Rayet: 15 (hazardous), White Dwarf: 12, B-type: 8, Carbon: 6, A-type: 4</td>
            </tr>
            <tr className="border-b border-border/30">
              <td className="py-1 pr-4 text-foreground">Atmospheres</td>
              <td className="py-1 pr-4">diminishing</td>
              <td className="py-1">1st: 15, 2nd: 12, 3rd: 9, each additional: 5. Icy atmospheric worlds get half points. Distance decay applies for primary star bodies.</td>
            </tr>
            <tr className="border-b border-border/30">
              <td className="py-1 pr-4 text-foreground">Oxygen Bonus</td>
              <td className="py-1 pr-4">up to 20</td>
              <td className="py-1">First oxygen atmosphere: +10, each additional: +5</td>
            </tr>
            <tr className="border-b border-border/30">
              <td className="py-1 pr-4 text-foreground">Rings</td>
              <td className="py-1 pr-4">up to 30</td>
              <td className="py-1">+15 per ringed landable body</td>
            </tr>
            <tr className="border-b border-border/30">
              <td className="py-1 pr-4 text-foreground">Proximity</td>
              <td className="py-1 pr-4">up to 20</td>
              <td className="py-1">+3 per pair of qualifying bodies within 100 Ls of each other</td>
            </tr>
            <tr className="border-b border-border/30">
              <td className="py-1 pr-4 text-foreground">Economy Diversity</td>
              <td className="py-1 pr-4">up to 15</td>
              <td className="py-1">+5 per unique non-Refinery economy type (Extraction, Industrial, Agriculture, High Tech, Tourism, Military)</td>
            </tr>
            <tr>
              <td className="py-1 pr-4 text-foreground">Body Count</td>
              <td className="py-1 pr-4">up to 15</td>
              <td className="py-1">+2 per qualifying body (landable, non-icy unless atmospheric, under 2.5 Earth masses)</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-3 text-muted-foreground text-xs">
          <strong>Distance decay:</strong> Bodies orbiting the primary star lose points
          based on distance &mdash; full value under 4,000 Ls, 70% at 4&ndash;10K Ls,
          40% at 10&ndash;20K Ls, 15% beyond 20K Ls. Secondary star bodies are not penalized.
        </p>
      </>
    ),
  },
  {
    category: 'Expansion Scouting',
    question: 'What bodies qualify for scoring?',
    answer: (
      <>
        <p>A body must meet all of these criteria to be counted as a qualifying colonization body:</p>
        <ul className="list-disc ml-5 mt-2 space-y-1">
          <li><strong>Must be a planet</strong> (not a star or belt cluster)</li>
          <li><strong>Must be landable</strong></li>
          <li><strong>Must be under 2.5 Earth masses</strong></li>
          <li><strong>Must not be an icy body</strong> &mdash; unless it has an atmosphere (atmospheric icy worlds are valid colonization targets)</li>
        </ul>
        <p className="mt-2">
          Economy classification is derived from body properties: subtype (High Metal Content
          = Extraction, Rocky Ice = Industrial + Refinery), parent star type (Neutron/Black Hole
          = High Tech + Tourism, Brown Dwarf = Military), rings (Extraction), and biological/geological
          signals (Agriculture/Extraction).
        </p>
      </>
    ),
  },
  {
    category: 'Expansion Scouting',
    question: 'Where does the scoring data come from &mdash; Spansh or journal?',
    answer: (
      <>
        <p>Scoring uses a <strong>two-step process</strong>:</p>
        <ol className="list-decimal ml-5 mt-2 space-y-2">
          <li>
            <strong>&ldquo;Scan Journals&rdquo;</strong> &mdash; Extracts and caches exploration
            data (honks, FSS scans, body details) from your game logs. This does <em>not</em> score
            anything &mdash; it just prepares the data for use when scouting.
          </li>
          <li>
            <strong>&ldquo;Scout&rdquo; button</strong> &mdash; Scores an individual system. When
            you click Scout, the app checks your journal cache first, then queries Spansh. It picks
            whichever source has better data:
            <ul className="list-disc ml-5 mt-1 space-y-1">
              <li><strong>Spansh preferred</strong> when it has the same or more bodies (richer multi-commander data)</li>
              <li><strong>Journal preferred</strong> when you scanned strictly more bodies than Spansh has</li>
            </ul>
          </li>
        </ol>
        <p className="mt-2 text-muted-foreground text-xs">
          Systems with cached journal data show a {'\u{1F4D3}'} icon next to the Scout button. You can
          also use &ldquo;Scout All&rdquo; to batch-score all visible systems. The &ldquo;Rescore&rdquo;
          button re-fetches from Spansh for updated data.
        </p>
      </>
    ),
  },

  // --- In-Game Overlay ---
  {
    category: 'In-Game Overlay',
    question: 'What do I need for the in-game overlay to work?',
    answer: (
      <>
        <p>The overlay requires three things:</p>
        <ol className="list-decimal ml-5 mt-2 space-y-1">
          <li>
            <strong>EDMC (Elite Dangerous Market Connector)</strong> must be
            running. Running it as administrator seems to improve reliability.
          </li>
          <li>
            <strong>EDMCModernOverlay plugin</strong> must be installed and
            enabled in EDMC. Install it from:{' '}
            <a
              href="https://github.com/KaivnD/EDMCModernOverlay"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              github.com/KaivnD/EDMCModernOverlay
            </a>
          </li>
          <li>
            The &quot;Enable overlay notifications&quot; checkbox must be
            checked on the Settings page of this app.
          </li>
        </ol>
        <p className="mt-2">
          The app connects to EDMCModernOverlay&rsquo;s legacy TCP server on
          port 5010. You&rsquo;ll see{' '}
          <code>[Overlay] Connected to EDMCModernOverlay</code> in the app&rsquo;s
          server window when the connection is established.
        </p>
      </>
    ),
  },
  {
    category: 'In-Game Overlay',
    question: 'The overlay is connected but I don\'t see anything in-game',
    answer: (
      <>
        <p>
          <strong>Display mode matters.</strong> EDMCModernOverlay works most
          reliably in <strong>Borderless Windowed</strong> or{' '}
          <strong>Windowed</strong> mode. Fullscreen (exclusive) mode does not
          always work &mdash; the overlay window may not render on top of the
          game.
        </p>
        <p className="mt-2">
          If you switched from Fullscreen to Borderless, you may need to restart
          both Elite Dangerous and EDMC for the overlay to initialize correctly.
        </p>
        <p className="mt-2">
          Also check the EDMCModernOverlay settings in EDMC &mdash; the overlay
          window dimensions need to be large enough for your monitor resolution.
          On high-resolution or ultrawide displays, the default overlay window
          may be too small, causing text to render outside the visible area.
        </p>
      </>
    ),
  },
  {
    category: 'In-Game Overlay',
    question: 'What triggers overlay messages?',
    answer: (
      <>
        <p>
          Overlay messages are triggered by specific journal events detected by
          the live watcher. You must have an <strong>active hauling session</strong>{' '}
          for market-related messages to appear. Current triggers:
        </p>
        <ul className="list-disc ml-5 mt-2 space-y-2">
          <li>
            <strong>FSD Jump into a system</strong> &mdash; Shows the scouting
            score if the system has been scored. If the system has stations with
            market data relevant to your active project, shows which commodities
            you still need to buy. Also flags missing gallery images in
            colonized systems.
          </li>
          <li>
            <strong>Docked at your Fleet Carrier</strong> &mdash; Shows what to
            load from the carrier for your active project (quantities matched to
            remaining needs).
          </li>
          <li>
            <strong>Docked at a station</strong> &mdash; Shows which commodities
            available at this station you still need to buy. Only commodities
            where &quot;need to buy&quot; is greater than zero are shown (already
            subtracts what&rsquo;s on your FC and in your ship hold).
          </li>
          <li>
            <strong>Body scan (in unscored systems)</strong> &mdash; Highlights
            noteworthy bodies: ringed landables, oxygen atmospheres, nitrogen
            atmospheres.
          </li>
          <li>
            <strong>FSS All Bodies Found</strong> &mdash; Triggers automatic
            system scoring via Spansh data.
          </li>
        </ul>
        <p className="mt-2 text-muted-foreground text-xs">
          Overlay messages appear for ~10 seconds. The &quot;need to buy&quot;
          calculation is: required &minus; provided &minus; myFcStock &minus; shipStock.
          Only your FC cargo counts, not squadron carriers.
        </p>
      </>
    ),
  },
  {
    category: 'In-Game Overlay',
    question: 'Do I need an active hauling session for overlay messages?',
    answer: (
      <>
        <p>
          <strong>Not for all messages.</strong> Overlay messages fall into two categories:
        </p>
        <ul className="list-disc ml-5 mt-2 space-y-2">
          <li>
            <strong>Always active</strong> (no session needed):
            <ul className="list-disc ml-5 mt-1 space-y-0.5 text-muted-foreground">
              <li>System scouting scores on FSD jump</li>
              <li>Body scan highlights (ringed landables, oxygen/nitrogen atmospheres)</li>
              <li>First footfall notifications for unvisited landable bodies</li>
              <li>FSS All Bodies Found scoring</li>
              <li>Missing gallery image reminders</li>
              <li>Colony welcome messages</li>
            </ul>
          </li>
          <li>
            <strong>Requires active session</strong>:
            <ul className="list-disc ml-5 mt-1 space-y-0.5 text-muted-foreground">
              <li>&ldquo;Buy here&rdquo; commodity suggestions when docking at stations</li>
              <li>FC load list when docking at your Fleet Carrier</li>
              <li>&ldquo;Need:&rdquo; commodity list when jumping into a system with known markets</li>
              <li>Project progress updates on contributions</li>
            </ul>
          </li>
        </ul>
        <p className="mt-2 text-muted-foreground text-xs">
          Start a hauling session from the Dashboard by selecting a project and clicking
          &ldquo;Start Session&rdquo;. The session tracks your contributions and enables
          the market-related overlay messages.
        </p>
      </>
    ),
  },
  {
    category: 'In-Game Overlay',
    question: 'Can I trigger overlay messages on demand from in-game chat?',
    answer: (
      <>
        <p>
          Yes! Type commands in any in-game chat channel (local, system, etc.)
          using the <code>!colony</code> prefix. The app detects SendText journal
          events and responds with overlay messages.
        </p>
        <p className="mt-2 font-medium">Available commands:</p>
        <ul className="list-disc ml-5 mt-2 space-y-1">
          <li>
            <code>!colony needs</code> &mdash; Shows your active project&rsquo;s
            progress and top commodities you still need to buy (subtracts FC and
            ship cargo).
          </li>
          <li>
            <code>!colony haul</code> &mdash; Shows project needs summary plus
            what to load from your Fleet Carrier. Same as docking at your FC.
          </li>
          <li>
            <code>!colony score</code> &mdash; Shows the scouting score for the
            system you&rsquo;re currently in.
          </li>
          <li>
            <code>!colony status</code> &mdash; Shows overall project status
            and active session info.
          </li>
          <li>
            <code>!colony help</code> &mdash; Shows a quick reminder of
            available commands in the overlay.
          </li>
        </ul>
        <p className="mt-2 text-muted-foreground text-xs">
          Commands are case-insensitive. You must have the journal watcher
          running (live connection to your journal folder). Other players
          cannot see the overlay &mdash; only you.
        </p>
      </>
    ),
  },

  // --- Journal Watcher ---
  {
    category: 'Journal Watcher',
    question: 'How quickly does the app detect in-game events?',
    answer: (
      <>
        <p>
          The live journal watcher polls the active journal file every{' '}
          <strong>2 seconds</strong>. When new data is detected, there is an
          additional <strong>500ms debounce</strong> to batch rapid event bursts
          (Elite Dangerous often writes several events at once, e.g. Docked +
          Music + LoadGame).
        </p>
        <p className="mt-2">
          In practice, expect overlay messages to appear <strong>2&ndash;3
          seconds</strong> after the in-game event.
        </p>
        <p className="mt-2">
          <strong>Companion files</strong> are polled independently every{' '}
          <strong>5 seconds</strong>, regardless of journal activity:
        </p>
        <ul className="list-disc ml-5 mt-1 space-y-1">
          <li>
            <strong>Cargo.json</strong> &mdash; Updated by the game when your
            ship cargo changes (buying, selling, transferring, collecting). Keeps
            the ship cargo display and overlay calculations current automatically.
          </li>
          <li>
            <strong>Market.json</strong> &mdash; Updated by the game when you
            open the commodities market screen at a station. Captures a market
            snapshot so the station appears as an acquisition source and the
            overlay can show &quot;Buy here&quot; on future visits.
          </li>
        </ul>
      </>
    ),
  },
  {
    category: 'Journal Watcher',
    question: 'The watcher seems to miss events or watch the wrong file',
    answer: (
      <>
        <p>
          The watcher selects the most recently modified journal file as the
          &quot;active&quot; file. If the wrong file is selected, try:
        </p>
        <ol className="list-decimal ml-5 mt-2 space-y-1">
          <li>
            Make sure Elite Dangerous is running and has written at least one
            event (e.g. enter the galaxy map briefly).
          </li>
          <li>
            Re-sync from the Dashboard &mdash; this re-initializes the watcher
            and picks up the correct file.
          </li>
        </ol>
        <p className="mt-2">
          The watcher starts reading from the <strong>end</strong> of the active
          file after sync, so only new events are processed. Events that
          happened before the sync are captured during the initial sync itself.
        </p>
      </>
    ),
  },

  // --- Projects & Data ---
  {
    category: 'Projects & Data',
    question: 'How is "need to buy" calculated?',
    answer: (
      <>
        <p>For each commodity in a colonization project:</p>
        <pre className="mt-2 bg-muted rounded p-3 text-xs overflow-x-auto">
          remaining = requiredQuantity - providedQuantity{'\n'}
          needToBuy = max(0, remaining - myFcStock - shipStock)
        </pre>
        <ul className="list-disc ml-5 mt-2 space-y-1">
          <li>
            <strong>requiredQuantity</strong> &mdash; total tons needed by the
            construction site (from ColonisationConstructionDepot journal event).
          </li>
          <li>
            <strong>providedQuantity</strong> &mdash; tons already delivered
            (from ColonisationContribution events).
          </li>
          <li>
            <strong>myFcStock</strong> &mdash; tons of this commodity currently
            on your Fleet Carrier (from Market.json when docked at your FC, or
            estimated from CargoTransfer events).
          </li>
          <li>
            <strong>shipStock</strong> &mdash; tons currently in your ship hold
            (from Cargo.json).
          </li>
        </ul>
        <p className="mt-2 text-muted-foreground text-xs">
          Squadron carrier cargo is tracked separately and does not reduce your
          &quot;need to buy&quot; figure.
        </p>
      </>
    ),
  },
  {
    category: 'Projects & Data',
    question: 'Why do station types sometimes reset after syncing?',
    answer: (
      <p>
        Station types (e.g. &quot;Agricultural Settlement: Large&quot;) are read
        from journal events. If you manually set a station type in the UI but a
        later journal sync processes an older event with a different type, it may
        overwrite your manual selection. The app preserves manual overrides when
        the journal event uses a generic type like &quot;Settle&quot;, but more
        specific journal types take precedence. If this happens repeatedly, try
        setting the type after the final sync.
      </p>
    ),
  },
  {
    category: 'Projects & Data',
    question: 'Can I assign bodies to stations/installations?',
    answer: (
      <p>
        Body assignment requires the system&rsquo;s body data to be available.
        If the body picker is empty or disabled, the system hasn&rsquo;t been
        scanned or scored yet. Visit the system page and either perform an FSS
        scan in-game (the app picks up Scan events), or click &quot;Fetch from
        Spansh&quot; to pull body data from the online database. Once bodies are
        loaded, the assignment dropdown will populate.
      </p>
    ),
  },

  // --- Fleet Carrier ---
  {
    category: 'Fleet Carrier',
    question: 'How does the app track my Fleet Carrier cargo?',
    answer: (
      <>
        <p>Two methods, in order of accuracy:</p>
        <ol className="list-decimal ml-5 mt-2 space-y-1">
          <li>
            <strong>Market.json snapshot</strong> (most accurate) &mdash; When
            you dock at your Fleet Carrier, Elite writes a Market.json file. The
            app reads this to get exact cargo counts. This is marked as
            &quot;exact&quot; in the UI.
          </li>
          <li>
            <strong>CargoTransfer estimation</strong> (fallback) &mdash; The app
            tracks CargoTransfer journal events (loading/unloading at a carrier)
            and accumulates them to estimate what&rsquo;s on board. This is
            marked as &quot;estimate&quot; and may drift over time.
          </li>
        </ol>
        <p className="mt-2">
          For the most accurate readings, dock at your FC periodically during
          hauling sessions. The Market.json snapshot resets the estimate.
        </p>
      </>
    ),
  },

  {
    category: 'Fleet Carrier',
    question: 'How is "Free Cargo" on the Companion page calculated?',
    answer: (
      <>
        <p>
          The Companion page shows live free space on your Fleet Carrier as:
        </p>
        <p className="mt-2 font-mono text-sm bg-muted/50 px-3 py-2 rounded">
          Free = 25,000 &minus; Modules &minus; Current Cargo
        </p>
        <ul className="list-disc ml-5 mt-3 space-y-1">
          <li>
            <strong>25,000t</strong> &mdash; the fixed Frontier max for Fleet
            Carriers. Hardcoded. (Squadron carriers have a different cap and
            aren&rsquo;t supported here yet.)
          </li>
          <li>
            <strong>Modules</strong> &mdash; tons consumed by installed services
            (refinery, shipyard, etc.). Set this once in{' '}
            <strong>Settings &rarr; Fleet Carrier &rarr; FC Capacity</strong>.
            You can read the value off Carrier Management &rarr; Cargo tab in
            game.
          </li>
          <li>
            <strong>Current Cargo</strong> &mdash; the sum of everything in your
            FC market, tracked from Market.json reads when you dock. The
            timestamp under the number tells you how fresh that snapshot is.
          </li>
        </ul>
        <p className="mt-2">
          The number turns yellow under 5,000t and red under 1,000t. If you
          haven&rsquo;t set Modules yet you&rsquo;ll see a warning &mdash; until
          then the math assumes 0t of services.
        </p>
      </>
    ),
  },

  // --- Station Dossier / Visit Tracking ---
  {
    category: 'Station Dossier',
    question: 'What is the dock welcome overlay? When does it fire?',
    answer: (
      <>
        <p>
          On DockingGranted (during approach &mdash; not after touchdown), the
          overlay fires a personal welcome for the station. It shows:
        </p>
        <ul className="list-disc ml-5 mt-2 space-y-1">
          <li>The visit number you&rsquo;re about to complete (e.g. &ldquo;180th visit&rdquo;)</li>
          <li>A rank badge when the station is in your top 20 most-visited (&ldquo;#3 most-visited&rdquo;)</li>
          <li>How long you&rsquo;ve been visiting this station (&ldquo;4 months of history&rdquo;)</li>
          <li>Faction-change alert if the controlling faction changed since your last visit</li>
          <li>Current faction state &mdash; Boom / Bust / War / Expansion / Election etc.</li>
          <li>Milestone bursts at 10, 25, 50, 100, 250, 500 visits</li>
          <li>Month and year anniversaries of your first dock</li>
        </ul>
        <p className="mt-2">
          Fleet carriers, colonisation ships, Trailblazer NPCs, and construction
          sites are excluded &mdash; they&rsquo;re not &ldquo;places&rdquo; for
          dossier purposes.
        </p>
      </>
    ),
  },
  {
    category: 'Station Dossier',
    question: 'Why does the visit count sometimes look wrong?',
    answer: (
      <>
        <p>
          Visit count is keyed by MarketID. Frontier reuses the same MarketID
          across a station&rsquo;s full lifecycle: construction depot &rarr;
          colonisation ship &rarr; finished station. So your &ldquo;180 docks at
          Ma Gateway&rdquo; count includes every dock at that MarketID, including
          the ones that happened while it was still called &ldquo;Planetary
          Construction Site: Vidal Cultivations&rdquo;.
        </p>
        <p className="mt-2">
          The station name shown is always the most recent one &mdash; if you
          renamed a station, or the construction site completed and became a
          real station, the dossier updates to the new name automatically after
          the next Sync All.
        </p>
      </>
    ),
  },

  // --- Target Alerts / Position ---
  {
    category: 'Target Alerts & Position',
    question: 'How does the Companion target alert work?',
    answer: (
      <>
        <p>
          When you target a system in the galaxy map (FSDTarget event), the
          Companion page banner updates with:
        </p>
        <ul className="list-disc ml-5 mt-2 space-y-1">
          <li><strong>Visited</strong> &mdash; whether you&rsquo;ve jumped to this system before (from knownSystems)</li>
          <li><strong>Spansh</strong> &mdash; whether Spansh has body data for it (body count shown if yes)</li>
          <li><strong>Score</strong> &mdash; the cached scouting score if you&rsquo;ve scored it before</li>
          <li><strong>Colonised</strong> &mdash; if the system is flagged as colonised</li>
          <li><strong>Body string</strong> &mdash; highlights from the scoring run if available</li>
        </ul>
        <p className="mt-2">
          Route plotted via NavRoute? The banner summarises the whole route
          (hop count, destination, how many stops you&rsquo;ve visited, how many
          Spansh has).
        </p>
      </>
    ),
  },
  {
    category: 'Target Alerts & Position',
    question: 'What does the &ldquo;via&rdquo; tag next to Current System mean?',
    answer: (
      <>
        <p>
          Every time your location is updated, it&rsquo;s tagged with how the
          app figured it out:
        </p>
        <ul className="list-disc ml-5 mt-2 space-y-1">
          <li><code>FSDJump</code> &mdash; supercruise jump to the system</li>
          <li><code>CarrierJump</code> &mdash; fleet carrier jump</li>
          <li><code>Location</code> &mdash; on game load / spawn</li>
          <li><code>Docked</code> &mdash; self-heal from a dock event</li>
          <li><code>SupercruiseExit</code> &mdash; self-heal from supercruise drop</li>
          <li><code>Journal Read</code> &mdash; manual System View &ldquo;Check journal&rdquo; button</li>
          <li><code>Server</code> &mdash; SSE update from another device</li>
        </ul>
        <p className="mt-2">
          This is diagnostic. If you see an old source and a recent timestamp,
          something unusual is going on &mdash; useful evidence when reporting
          issues.
        </p>
      </>
    ),
  },
  {
    category: 'Target Alerts & Position',
    question: 'What is the NPC threat alert?',
    answer: (
      <>
        <p>
          When a pirate or interdictor NPC sends threatening chatter (events
          matching <code>$Pirate_*</code>, <code>$InterdictorNPC_*</code>, or
          known attack/demand phrases), the app fires:
        </p>
        <ul className="list-disc ml-5 mt-2 space-y-1">
          <li>A red overlay message in-game (10 second TTL)</li>
          <li>A flashing red banner at the top of the Companion page (auto-dismiss after 15s)</li>
          <li>A feed entry with 🚨 icon</li>
        </ul>
      </>
    ),
  },

  // --- APIs & External Services ---
  {
    category: 'APIs & External Services',
    question: 'What external APIs and services does this app use?',
    answer: (
      <>
        <p>The app connects to the following external services:</p>
        <ul className="list-disc ml-5 mt-2 space-y-2">
          <li>
            <strong>Spansh API</strong> (<code>spansh.co.uk/api</code>) &mdash;
            System and body data for scouting scores. Used for system lookups by
            name, fetching full system dumps (body details, ring types,
            atmosphere types), and auto-completing system names. Proxied through
            the local server to avoid CORS. Rate-limited to 1 request/second.
            <br />
            <span className="text-muted-foreground text-xs">
              Spansh does <strong>not</strong> provide live market/commodity data.
            </span>
          </li>
          <li>
            <strong>EDMCModernOverlay</strong> (TCP <code>127.0.0.1:5010</code>) &mdash;
            In-game overlay display. The app&rsquo;s server connects to the
            overlay&rsquo;s legacy TCP socket and sends JSON messages for rendering
            on top of the game window. Requires EDMC + the EDMCModernOverlay plugin.
          </li>
          <li>
            <strong>Elite Dangerous Journal Files</strong> (local filesystem) &mdash;
            All player activity data comes from journal files, Market.json, and
            Cargo.json written by the game. Read via the browser&rsquo;s File System
            Access API. No data is sent to any remote server.
          </li>
          <li>
            <strong>Ardent Insight API</strong> (<code>api.ardent-insight.com</code>) &mdash;
            Live market and commodity pricing data sourced from EDDN (Elite
            Dangerous Data Network). Provides commodity prices, station
            import/export listings, and supply/demand data. No authentication
            required, no enforced rate limits (but be respectful).
            <br />
            <span className="text-muted-foreground text-xs">
              Ardent excludes Fleet Carrier markets by default. Data freshness
              defaults to last 30 days. See{' '}
              <a
                href="https://ardent-insight.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                ardent-insight.com
              </a>{' '}
              and{' '}
              <a
                href="https://github.com/iaincollins/ardent-api"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                GitHub
              </a>.
            </span>
          </li>
        </ul>
        <p className="mt-2 text-muted-foreground text-xs">
          All API calls are made from the local server process and proxied to the
          browser. No authentication or API keys are required for Spansh or Ardent.
        </p>
      </>
    ),
  },

  // --- Network Access ---
  {
    category: 'Network Access',
    question: 'Can I access the app from my iPad, phone, or another PC?',
    answer: (
      <>
        <p>
          Yes! The app is accessible from any device on your local network. When
          the server starts, the console window shows a <strong>Network URL</strong>{' '}
          with an access token:
        </p>
        <pre className="mt-2 bg-muted rounded p-3 text-xs overflow-x-auto">
          Network URL (for other devices):{'\n'}
          http://yourpc:5173?token=a3f8c2e1d4b7...
        </pre>
        <p className="mt-2">
          Copy this full URL (including the <code>?token=</code> part) and open
          it on your other device. The token is required for security &mdash; it
          prevents unauthorized access on your network.
        </p>
        <p className="mt-2">
          <strong>All devices share the same data.</strong> Changes made on one
          device are saved to <code>colony-data.json</code> on the PC running
          the server. Refresh any other connected device to see updates.
        </p>
        <p className="mt-2 text-muted-foreground text-xs">
          <strong>Note:</strong> Journal folder access (for live watcher and
          journal sync) only works from the PC running the server, since the
          File System Access API requires a local browser. Other devices can view
          data and manage projects but cannot trigger journal scans.
        </p>
      </>
    ),
  },
  {
    category: 'Network Access',
    question: 'Where is my data stored?',
    answer: (
      <>
        <p>
          All app data is stored in <code>colony-data.json</code> in the same
          folder as the executable. This is a plain JSON file that you can back
          up, copy, or inspect. The token is stored in{' '}
          <code>colony-token.txt</code> alongside it.
        </p>
        <p className="mt-2">
          <strong>Previously</strong>, data was stored in the browser&rsquo;s
          IndexedDB (tied to a single browser). If you&rsquo;re upgrading from
          an older version, existing data is automatically migrated to the server
          file on first launch.
        </p>
      </>
    ),
  },

  {
    category: 'Network Access',
    question: 'What works on network devices vs. the host PC?',
    answer: (
      <>
        <p>
          Some features require the host PC&rsquo;s browser (Chrome) because they
          depend on the <strong>File System Access API</strong> to read Elite
          Dangerous journal files. Here&rsquo;s the breakdown:
        </p>
        <table className="mt-2 text-xs w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-1 pr-4">Feature</th>
              <th className="text-left py-1 pr-4">Host PC</th>
              <th className="text-left py-1">iPad / Phone</th>
            </tr>
          </thead>
          <tbody className="text-muted-foreground">
            <tr className="border-b border-border/30">
              <td className="py-1 pr-4 text-foreground">View dashboard &amp; projects</td>
              <td className="py-1 pr-4">{'\u2705'}</td>
              <td className="py-1">{'\u2705'}</td>
            </tr>
            <tr className="border-b border-border/30">
              <td className="py-1 pr-4 text-foreground">Expansion scouting &amp; scoring</td>
              <td className="py-1 pr-4">{'\u2705'}</td>
              <td className="py-1">{'\u2705'}</td>
            </tr>
            <tr className="border-b border-border/30">
              <td className="py-1 pr-4 text-foreground">Colony chain planner</td>
              <td className="py-1 pr-4">{'\u2705'}</td>
              <td className="py-1">{'\u2705'}</td>
            </tr>
            <tr className="border-b border-border/30">
              <td className="py-1 pr-4 text-foreground">Gallery &amp; image upload</td>
              <td className="py-1 pr-4">{'\u2705'}</td>
              <td className="py-1">{'\u2705'} Take photos directly!</td>
            </tr>
            <tr className="border-b border-border/30">
              <td className="py-1 pr-4 text-foreground">Edit projects &amp; settings</td>
              <td className="py-1 pr-4">{'\u2705'}</td>
              <td className="py-1">{'\u2705'}</td>
            </tr>
            <tr className="border-b border-border/30">
              <td className="py-1 pr-4 text-foreground">Journal sync &amp; live watcher</td>
              <td className="py-1 pr-4">{'\u2705'}</td>
              <td className="py-1">{'\u274C'} Requires local filesystem</td>
            </tr>
            <tr className="border-b border-border/30">
              <td className="py-1 pr-4 text-foreground">Start/stop hauling sessions</td>
              <td className="py-1 pr-4">{'\u2705'}</td>
              <td className="py-1">{'\u274C'} Needs journal watcher</td>
            </tr>
            <tr className="border-b border-border/30">
              <td className="py-1 pr-4 text-foreground">Journal history stats</td>
              <td className="py-1 pr-4">{'\u2705'}</td>
              <td className="py-1">{'\u274C'} Reads journal files directly</td>
            </tr>
            <tr>
              <td className="py-1 pr-4 text-foreground">In-game overlay</td>
              <td className="py-1 pr-4">{'\u2705'}</td>
              <td className="py-1">N/A (runs on game PC)</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2 text-muted-foreground text-xs">
          Sync journals from the host PC first, then all devices see the
          resulting data (projects, scores, markets). Network devices are ideal
          for browsing data, managing projects, uploading photos, and using the
          planner while away from the PC.
        </p>
      </>
    ),
  },

  // --- Troubleshooting ---
  {
    category: 'Troubleshooting',
    question: 'I see "A listener indicated an asynchronous response" errors in the console',
    answer: (
      <p>
        This is a Chrome extension error, not from this app. It typically comes
        from other browser extensions (ad blockers, etc.) interfering with
        message channels. It is harmless and can be safely ignored.
      </p>
    ),
  },
  {
    category: 'Troubleshooting',
    question: 'The app is running but nothing appears when I sync',
    answer: (
      <>
        <p>Check these common issues:</p>
        <ol className="list-decimal ml-5 mt-2 space-y-1">
          <li>
            Make sure you selected the correct journal folder (should contain
            files like <code>Journal.2026-03-16T...</code>).
          </li>
          <li>
            The browser must be Chromium-based (Chrome, Edge, Brave). Firefox
            and Safari do not support the File System Access API.
          </li>
          <li>
            If using the standalone .exe, the browser connects to{' '}
            <code>localhost:5173</code> &mdash; make sure nothing else is using
            that port.
          </li>
        </ol>
      </>
    ),
  },
  {
    category: 'Troubleshooting',
    question: 'Can I back up or transfer my data?',
    answer: (
      <p>
        Yes. Go to Settings and use <strong>Export Backup</strong> to save all
        your data (projects, systems, installations, settings) as a JSON file.
        Use <strong>Import Backup</strong> on another machine or browser to
        restore it. You can also directly copy the <code>colony-data.json</code>{' '}
        file from the server folder. Gallery images are stored separately and
        are not included in either backup method.
      </p>
    ),
  },
];

// Group FAQ items by category
function groupByCategory(items: FaqItem[]) {
  const groups: { category: string; items: FaqItem[] }[] = [];
  for (const item of items) {
    const existing = groups.find((g) => g.category === item.category);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.push({ category: item.category, items: [item] });
    }
  }
  return groups;
}

function FaqAccordion({ item, isOpen, onToggle }: { item: FaqItem; isOpen: boolean; onToggle: () => void }) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/50 transition-colors"
      >
        <span className="text-sm font-medium text-foreground">{item.question}</span>
        <span className={`text-muted-foreground transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>
          &#x25BE;
        </span>
      </button>
      {isOpen && (
        <div className="px-4 pb-4 text-sm text-muted-foreground leading-relaxed border-t border-border pt-3">
          {item.answer}
        </div>
      )}
    </div>
  );
}

export function FaqPage() {
  const [openItems, setOpenItems] = useState<Set<number>>(new Set());
  const groups = groupByCategory(faqItems);

  const toggleItem = (index: number) => {
    setOpenItems((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const expandAll = () => {
    setOpenItems(new Set(faqItems.map((_, i) => i)));
  };

  const collapseAll = () => {
    setOpenItems(new Set());
  };

  let globalIndex = 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">FAQ &amp; Help</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Frequently asked questions about ED Colony Tracker
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={expandAll}
            className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border hover:bg-muted/50 transition-colors"
          >
            Expand all
          </button>
          <button
            onClick={collapseAll}
            className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border hover:bg-muted/50 transition-colors"
          >
            Collapse all
          </button>
        </div>
      </div>

      <div className="space-y-8">
        {groups.map((group) => {
          const groupItems = group.items.map((item) => {
            const idx = globalIndex++;
            return (
              <FaqAccordion
                key={idx}
                item={item}
                isOpen={openItems.has(idx)}
                onToggle={() => toggleItem(idx)}
              />
            );
          });

          return (
            <div key={group.category}>
              <h3 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
                {group.category === 'About' && '🛰️'}
                {group.category === 'Getting Started' && '🚀'}
                {group.category === 'Journal Sync & History' && '📖'}
                {group.category === 'Expansion Scouting' && '🔭'}
                {group.category === 'In-Game Overlay' && '🖥️'}
                {group.category === 'Journal Watcher' && '📋'}
                {group.category === 'Projects & Data' && '📊'}
                {group.category === 'Fleet Carrier' && '⚓'}
                {group.category === 'APIs & External Services' && '🔌'}
                {group.category === 'Network Access' && '📱'}
                {group.category === 'Troubleshooting' && '🔧'}
                {group.category}
              </h3>
              <div className="space-y-2">{groupItems}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
