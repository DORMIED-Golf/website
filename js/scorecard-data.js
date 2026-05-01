/* ─────────────────────────────────────────────────────────────────────────
   scorecard-data.js  —  DORMIED Scorecard Content Source of Truth
   ─────────────────────────────────────────────────────────────────────────
   HOW TO PUBLISH A NEW ISSUE
   ─────────────────────────────────────────────────────────────────────────
   1. Add a new object to the TOP of the `issues` array (newest first).
   2. Set slug, title, subtitle, date, dateISO, monthLabel.
   3. Add images: hero path and/or strip array.
   4. Write sections: each section has id, heading (null for intro), body (HTML string).
   5. Add brandMentions: array of brand IDs from data.js to auto-link in body text.
   6. Add indexSnapshot: the ranking table data for this issue.
   7. Add any images to /images/scorecard/[slug]/ and deploy.
   ─────────────────────────────────────────────────────────────────────────
   The homepage card, archive page, and article page all update automatically.
   No edits to other files needed.
   ───────────────────────────────────────────────────────────────────────── */

window.DORMIED_SCORECARD_DATA = {

  issues: [

    /* ── APRIL 2026 ────────────────────────────────────────────────────── */
    {
      slug:        "april-2026",
      title:       "The Scorecard | April 2026",
      subtitle:    "A brand built by a group chat of college friends is now dressing a man teeing it up at the Masters.",
      date:        "Apr 8, 2026",
      dateISO:     "2026-04-08",
      monthLabel:  "April 2026",

      images: {
        hero: null,
        strip: [
          { src: "/images/scorecard/april-2026/sugar-loaf-students-golf.jpg", label: "Sugar Loaf Social Club" },
          { src: "/images/scorecard/april-2026/krank-bryson.jpg",             label: "Krank Golf"            },
          { src: "/images/scorecard/april-2026/malbon-shanghai.jpg",          label: "Malbon"                },
        ],
      },

      toc: [
        { id: "at-the-top",       label: "At The Top"      },
        { id: "the-biggest-move", label: "The Biggest Move" },
        { id: "the-field",        label: "The Field"        },
        { id: "the-drop-zone",    label: "The Drop Zone"    },
        { id: "global-dispatch",  label: "Global Dispatch"  },
        { id: "closing",          label: "Closing"          },
      ],

      sections: [
        {
          id:      "intro",
          heading: null,
          body: `<p>March was the month golf woke up. The index rose 25.2% globally, with every market except Australia posting gains. China surged 52.7%. Germany jumped 32.1%. Cameron Young's Players Championship win, Bryson DeChambeau's back-to-back LIV victories, and the annual pre-Masters merch frenzy all left fingerprints on the data.</p>
<p>But the brands that moved most were not the ones with the biggest marketing budgets. They were the ones close enough to a moment to get swept up in it.</p>`,
        },
        {
          id:      "at-the-top",
          heading: "AT THE TOP",
          body: `<p>Titleist holds the top position for the third consecutive month. That level of consistency is not exciting to write about, which is probably the point. The brand does not need a moment. It is the moment.</p>
<p>TaylorMade slipped to 66.8, continuing a gradual drift that has been building since the start of the year. TravisMathew holds at 54.8. Callaway and Sun Day Red are tied at 44.9 — a Tiger-adjacent brand matching one of the game's most established equipment makers in a single month is its own kind of story.</p>`,
        },
        {
          id:      "the-biggest-move",
          heading: "THE BIGGEST MOVE",
          body: `<p>Sugar Loaf Social Club jumped 125% in March, climbing 15 spots in the index to reach a DI of 3.3. That number sounds small until you consider where this brand was twelve months ago.</p>
<p>The catalyst was a collision of events that would have been impossible to engineer deliberately. Sugar Loaf released a 17-piece collaboration with Students Golf — covered by Boardroom, Skratch, and every gear forum that matters, ranging from $60 tees to an $875 MacKenzie bag. They dropped a Players Championship co-branded collection. And then Brandon Holtz — the U.S. Mid-Amateur champion — received his Masters invitation and was confirmed wearing Sugar Loaf at Augusta. His retired State Farm agent father on the bag. A brand built over a group chat among college friends was suddenly dressing someone teeing it up at Augusta National.</p>
<p>You cannot buy that. You can only be in position for it when it happens. Sugar Loaf is a subsidiary of Pro Shop Holdings, which also owns Skratch — so when the moment arrived, the distribution infrastructure was already in place.</p>`,
        },
        {
          id:      "the-field",
          heading: "THE FIELD",
          body: `<p>Rhoback climbed 86.2% to 1.8. The annual Azalea Collection does real work, and a No Laying Up "First Major" capsule collab during Players week gave it the distribution it needed. The brand knows its moment and prepares for it a year in advance.</p>
<p>Krank Golf was up 51.7% following Bryson DeChambeau's back-to-back LIV victories in Singapore and South Africa using their Formula Fire drivers. Tour success still moves the needle for equipment brands in a way that apparel rarely replicates. When a recognizable player wins with a product back-to-back, the search interest is immediate and measurable.</p>`,
        },
        {
          id:      "the-drop-zone",
          heading: "THE DROP ZONE",
          body: `<p>L.A.B. Golf dropped 33.3%, falling 17 spots to a DI of 4.9. This is not a story about a brand losing momentum — it is arithmetic. February's 174% surge was exceptional. March's correction was inevitable. The brand launched the LINK 2.1 and 2.2 mid-month and landed on Fast Company's Most Innovative Companies list. It is still well above where it was six months ago.</p>
<p>Vuori declined 18.8%. The brand had been building quietly on the back of Tommy Fleetwood's visibility, and then Blackstone signed Fleetwood on March 31st. The deal moves him into a different tier of brand partnership. The Vuori chapter appears to be closed — and the customer complaints about fabric quality and a production shift to Cambodia that surfaced in the same window did not help.</p>`,
        },
        {
          id:      "global-dispatch",
          heading: "GLOBAL DISPATCH",
          body: `<p>China surged 52.7% in March, the strongest single-market month we have seen from that region this year. The catalyst was Malbon opening its first mainland flagship store at Jing'an Kerry Centre in Shanghai. A physical retail presence in mainland China signals a level of commitment that search data reflects almost immediately. The question is whether that interest sustains or follows the pattern of launch spikes that fade over the following two months.</p>`,
        },
        {
          id:      "closing",
          heading: "CLOSING",
          body: `<p>Sugar Loaf dressed a Mid-Am champion heading into Augusta. Krank made noise through one player's two wins. Rhoback turned Augusta week into a product calendar tentpole with zero official affiliation.</p>
<p>The old playbook was tour contracts and print ads. The new one is cultural proximity. The brands that are not positioned for the moment when it arrives will not get a second shot at it.</p>
<p><em>— Adam and Travis, DORMIED</em></p>`,
        },
      ],

      indexSnapshot: [
        { rank: 1, id: "titleist",      name: "Titleist",      di: 100.0, mom:   0.0,  category: "Clubs & Balls"      },
        { rank: 2, id: "taylormade",    name: "TaylorMade",    di:  66.8, mom: -17.9,  category: "Clubs & Balls"      },
        { rank: 3, id: "travismathew", name: "TravisMathew", di:  54.8, mom:   0.2,  category: "Apparel & Footwear" },
        { rank: 4, id: "callaway",      name: "Callaway",      di:  44.9, mom: -17.9,  category: "Clubs & Balls"      },
        { rank: 4, id: "sun-day-red",   name: "Sun Day Red",   di:  44.9, mom: -17.9,  category: "Apparel & Footwear" },
      ],

      brandMentions: [
        "titleist", "taylormade", "travismathew", "callaway", "sun-day-red",
        "sugar-loaf-social-club", "students-golf", "rhoback", "krank-golf",
        "lab-golf", "vuori", "malbon",
      ],
    },

    /* ── MARCH 2026 ─────────────────────────────────────────────────────── */
    {
      slug:        "march-2026",
      title:       "The Scorecard | March 2026",
      subtitle:    "Tommy Fleetwood moved the needle for three different brands in a single month just by getting dressed in the morning. Also, L.A.B. Golf jumped 174% in February.",
      date:        "Mar 24, 2026",
      dateISO:     "2026-03-24",
      monthLabel:  "March 2026",

      images: {
        hero: null,
        strip: [
          { src: "/images/scorecard/march-2026/tommy-fleetwood-brands.jpg", label: "Tommy Fleetwood" },
          { src: "/images/scorecard/march-2026/lab-golf-putter.jpg",        label: "L.A.B. Golf"    },
        ],
      },

      toc: [
        { id: "at-the-top",       label: "At The Top"      },
        { id: "the-biggest-move", label: "The Biggest Move" },
        { id: "the-field",        label: "The Field"        },
        { id: "the-long-game",    label: "The Long Game"    },
        { id: "the-drop-zone",    label: "The Drop Zone"    },
        { id: "global-dispatch",  label: "Global Dispatch"  },
        { id: "closing",          label: "Closing"          },
      ],

      sections: [
        {
          id:      "intro",
          heading: null,
          body: `<p>Tommy Fleetwood spent February as the most interesting free agent in golf. After ending his 16-year partnership with Nike, he wore Students Golf at TGL, Sun Day Red cashmere at the Genesis Invitational, and practiced in borrowed Malbon. Austin Smotherman opened the Cognizant Classic with a 62, led for three days with a L.A.B. Golf putter, and finished T2 behind Nico Echavarria.</p>
<p>February was a quiet month on the surface and a chaotic one underneath. The Florida swing had not yet started. The Masters was still six weeks away. And yet the index registered some of the most dramatic single-brand moves we have tracked.</p>`,
        },
        {
          id:      "at-the-top",
          heading: "AT THE TOP",
          body: `<p>Titleist holds at 100.0. TaylorMade at 82.1. TravisMathew and Callaway are tied at 54.7 — though TravisMathew's three-month trend is down 45%, worth watching. Sun Day Red surged 48.6% to complete the top five, driven by Fleetwood's Genesis sighting plus the Pioneer Willow golf shoe launch on February 26th and the Presidio spikeless on February 17th.</p>
<p>The top of the index is remarkably stable. The same five brands have occupied these positions for consecutive months, which tells you something about how concentrated attention is at the top of the game. The action is in the middle of the field.</p>`,
        },
        {
          id:      "the-biggest-move",
          heading: "THE BIGGEST MOVE",
          body: `<p>L.A.B. Golf jumped 174.1% in February. That is the single largest move we have recorded in the index since we began tracking. The brand climbed 35 spots to reach a DI of 11.0 — a number that would have seemed impossible twelve months ago for a putter-focused brand with no major tour presence.</p>
<p>Three things converged: Austin Smotherman's wire-to-wire Cognizant Classic contention (he made 132 feet of putts in the opening round), JJ Spaun's major championship win using a L.A.B. putter, and the announcement that L Catterton had paid north of $200M to acquire the brand — more than Callaway paid for Odyssey in 1997. A 174% spike with no way to capture demand is noise. This one had somewhere to go.</p>`,
        },
        {
          id:      "the-field",
          heading: "THE FIELD",
          body: `<p>Students Golf climbed 50% to 2.7, jumping 15 spots in the index. The TGL broadcasts put the brand in front of a primetime audience that does not typically follow equipment coverage — and the brand had product ready when interest arrived. Their Course Studies collection at the PGA Show gave it distribution legs. Founded in 2022, they are executing like a brand that has been doing this for a decade.</p>
<p>Sun Day Red's 48.6% jump completes a pattern: proximity to Fleetwood moved search for every brand he wore, but Sun Day Red had the biggest infrastructure to capture it.</p>`,
        },
        {
          id:      "the-long-game",
          heading: "THE LONG GAME",
          body: `<p>Tommy Fleetwood's post-Nike visibility window is closing. Every brand he has been seen wearing in the last 60 days — Malbon, Sun Day Red, Students Golf — registered it in the data. The partnership that does get announced will be visible in the numbers before anyone publishes a press release.</p>
<p>Students Golf probably cannot match adidas money. Sun Day Red is a Tiger vehicle. Malbon is building something different. Whoever signs him is getting a player the internet is watching closely, in a sport that is growing, at the exact moment when brand-athlete alignment matters more than it has in twenty years.</p>`,
        },
        {
          id:      "the-drop-zone",
          heading: "THE DROP ZONE",
          body: `<p>EP NY collapsed 80.8%. The brand — founded in 1995, rebranded from EP Pro in 2017 — is now at 167th in the index. Its six-month trend is down 89.6%. That is not a correction. That is a brand that has lost the audience it once had with no visible path to recovery.</p>
<p>HackMotion fell 45.5%, dropping 25 spots to a DI of 1.2. Training aid brands live and die by content cycles, and February was a quiet one for the category. No viral moment, no tour story, no product drop that found an audience. The three-month trend is down 75.8%.</p>`,
        },
        {
          id:      "global-dispatch",
          heading: "GLOBAL DISPATCH",
          body: `<p>PXG's South Korea DI is 100.0 against a global average of 30.1. That gap illustrates something the index rarely makes this visible: a brand's global rank tells you very little about its position in any specific market. PXG is not a top-ten brand globally. In South Korea it is the benchmark — operating as a premium lifestyle brand in a market where that positioning has stuck. Regional strategy and global strategy are different documents, and most brands are only writing one of them.</p>`,
        },
        {
          id:      "closing",
          heading: "CLOSING",
          body: `<p>The most valuable thing a brand can have right now is not a product launch or a tour win — it is proximity to a player the internet is watching. Tommy Fleetwood moved the needle for three different brands in a single month just by getting dressed in the morning.</p>
<p>March data will reflect the Florida swing and the first tremors of Masters season. The brands that are not positioned for the moment when it arrives will not get a second shot at it.</p>
<p><em>— Adam and Travis, DORMIED</em></p>`,
        },
      ],

      indexSnapshot: [
        { rank: 1, id: "titleist",      name: "Titleist",      di: 100.0, mom:   0.0,  category: "Clubs & Balls"      },
        { rank: 2, id: "taylormade",    name: "TaylorMade",    di:  82.1, mom: -12.6,  category: "Clubs & Balls"      },
        { rank: 3, id: "travismathew", name: "TravisMathew", di:  54.7, mom:   0.0,  category: "Apparel & Footwear" },
        { rank: 3, id: "callaway",      name: "Callaway",      di:  54.7, mom:   0.0,  category: "Clubs & Balls"      },
        { rank: 5, id: "sun-day-red",   name: "Sun Day Red",   di:  54.7, mom:  48.6,  category: "Apparel & Footwear" },
      ],

      brandMentions: [
        "titleist", "taylormade", "travismathew", "callaway", "sun-day-red",
        "lab-golf", "students-golf", "ep-ny", "hackmotion", "pxg",
        "malbon", "vuori", "rhoback",
      ],
    },

  ], /* end issues */

}; /* end DORMIED_SCORECARD_DATA */
