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

    /* ── JULY 2026 ─────────────────────────────────────────────────────── */
    {
      slug:       "july-2026",
      title:      "Shinnecock Paid Out in Strange Currency | The Scorecard | July 2026",
      subtitle:   "Wyndham Clark spent every day of U.S. Open week with a wrist trainer on the Shinnecock range. Plus, Fore All jumped 50% with a pink double-decker bus and 64.8 million earned media impressions.",
      date:       "Jul 13, 2026",
      dateISO:    "2026-07-13",
      monthLabel: "July 2026",
      images: {
        hero:  null,
        strip: [
          { src: "https://substackcdn.com/image/fetch/f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fc6555b0d-bb45-47a5-b915-359f53866532_1937x1292.webp", label: "Fore All Double-Decker Bus" },
          { src: "https://substackcdn.com/image/fetch/f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Febe2e4db-1303-4ea0-81eb-93c55fcd9546_1200x823.jpeg", label: "Wyndham Clark, 2026 U.S. Open" },
          { src: "https://substackcdn.com/image/fetch/f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fa28d65c0-14c3-4729-800c-0a24040a3b87_960x640.webp", label: "Bryson DeChambeau's driver switch" },
        ],
      },
      toc: [
        { id: "at-the-top",       label: "At The Top"       },
        { id: "the-biggest-move", label: "The Biggest Move" },
        { id: "the-field",        label: "The Field"        },
        { id: "the-drop-zone",    label: "The Drop Zone"    },
        { id: "the-long-game",    label: "The Long Game"    },
        { id: "global-dispatch",  label: "Global Dispatch"  },
        { id: "closing",          label: "Closing"          },
      ],
      sections: [
        {
          id:      "intro",
          heading: null,
          body:    "<p>Wyndham Clark won the U.S. Open wire-to-wire at Shinnecock Hills, his second national title, and the index spent the rest of June proving that attention does not follow trophies in a straight line. The training aid Clark used on the range all week jumped 81%. The shaft company inside his winning irons fell 33%. Bryson DeChambeau benched his driver at the year's biggest event and both brands involved in the breakup went up. A Barbie golf bag capped at 100 units out-earned most tour sponsorships in media impressions. June was a reminder that the index does not measure who won. It measures who got talked about, and in our game those are increasingly different lists. The winner's circle is one economy. The conversation is another. This month the two barely overlapped.</p>",
        },
        {
          id:      "at-the-top",
          heading: "At The Top: Ten Brands, Zero Movement, One Message",
          body:    "<p>For the first time in the index's history, the entire top ten held its exact rank from the previous month. Titleist leads at 100.0 for the sixth consecutive month, though its raw search volume slipped 18.3% in lockstep with TaylorMade at 81.7, the post-major season breather arriving on schedule. TravisMathew held flat and climbed to 67.1 on the relative scale as a result, quietly posting its strongest DI of the year without doing anything differently. Callaway sits fourth at 54.9 and FootJoy rounds out the five at 44.7. The frozen leaderboard is the calm before the reshuffle: LA Golf jumped eight spots to 11th and Vice Golf is sitting at ninth at a 52-week peak. Somebody in the top ten is getting passed this summer.</p>",
        },
        {
          id:      "the-biggest-move",
          heading: "The Biggest Move: The Training Aid That Won the U.S. Open",
          body:    "<p>ProSENDR rose 81.3%, climbing 19 spots, because Wyndham Clark spent every day of U.S. Open week with the wrist trainer on the Shinnecock range and then won the whole thing wire-to-wire. Golf Monthly and Yahoo Sports both ran pieces attributing his ball-striking turnaround directly to the ProSENDR system, and the Widener, the brand's early-April launch, caught a second wave of attention once cameras confirmed it at the top level of the sport. This is the second consecutive month Clark has functioned as a one-man brand catalyst. In May he won the CJ Cup with an ACCRA putter shaft and sent that brand up 131%. In June he did it for a training aid. No active player moves component and accessory brands the way Clark does right now, partly because his bag is full of unexpected names and partly because his wins keep coming with a visible practice-tool story attached. The contrast with last month is the lesson: Aaron Rai's PGA win crushed The Stack System because it undermined the speed narrative. Clark's win made ProSENDR because it confirmed the swing-mechanics narrative. Training aids do not sell products. They sell explanations, and Clark handed them a major-championship-sized one.</p>",
        },
        {
          id:      "the-field",
          heading: "The Field: Bryson's Breakup Was Good for Everyone's Business",
          body:    "<p>Krank Golf rose 50% in the month Bryson DeChambeau dropped its driver. That sentence should not work, but the mechanics make sense. Bryson switching to a TaylorMade prototype at Shinnecock generated massive equipment coverage, and every story about the switch named the club he was leaving. Krank leaned in rather than sulking, launching the Formula FIRE 2 Wood and a Mini Driver mid-month while its homepage celebrated the fairway woods still in his bag. Last month we noted the one-ambassador risk cuts both ways after his missed cut dragged Krank down 33%. June showed the third way: even the breakup is content.</p>\n<p>LA Golf rose 49.5% on the same story from the other side, its BAD Prototype Rebar shafts still in Bryson's wedges and irons while the driver-switch conversation put the brand's post-Bryson identity up for debate during peak WITB season. Fore All jumped 50% after the Barbie collaboration launched during U.S. Women's Open week with a Melrose pop-up, a wrapped pink double-decker bus running down Sunset to Riviera, and 64.8 million earned media impressions including an Access Hollywood segment. A women's golf brand generating entertainment-industry coverage during a major is precisely the crossover play the category has needed.</p>\n<p>And Vuori climbed 22.7% for its third consecutive monthly gain since the Tom Holland deal. June brought a GOLF.com review of the men's collection, a Wall Street Journal interview announcing 20 China stores by 2027, and a Bloomberg Businessweek feature on founder Joe Kudla and the $5.5 billion brand. When we made Vuori our Long Game call in May, the question was whether the Holland strategy would sustain. Three months of data have answered it.</p>",
        },
        {
          id:      "the-drop-zone",
          heading: "The Drop Zone: McLaren's Silence Says Everything",
          body:    "<p>McLaren Golf fell 80%, dropping 43 spots to a DI of 4.9. Two months ago it was tied for third on this index. The explanation database entry for June reads, in full, no identifiable catalyst. That is the point. There was no bad news, no viral criticism, no tour disaster. There was nothing at all, and nothing is fatal for a brand built entirely on launch spectacle. The arc is now complete enough to name: plus 307% in April, minus 63% in May, minus 80% in June. Justin Rose is still playing the irons. The clubs did not change. The conversation simply ended, and the index does not pay retainers. PXG survived this valley in 2015 by refusing to stop spending. McLaren's next move, whatever it is, now matters more than its first one did.</p>\n<p>True Temper fell 33.3% in the same month its Dynamic Gold X7 shafts won the U.S. Open in Clark's irons and its Project X Titan Yellow tour-launched into his winning driver setup. Read that against ProSENDR's 81% gain from the same player's bag and you have the purest natural experiment the index has produced: the incumbent gets nothing for winning because winning is what incumbents are supposed to do. Greg Norman Collection completed a round trip, giving back all of last month's 50% viral-post gain with no June catalyst. Primo Golf Apparel fell 33.3% in a difficult month: Golf Digest reported Phil Mickelson had been removed from his home club amid misconduct allegations, extending an absence that has left the brand's HyFlyers partnership invisible all season, and Primo's branding was notably absent from Grant Horvat's Your Golf Tour opener at Pursell Farms. And Public Drip dropped 32.3% after walking into the pro shop, a green-grass distribution push that landed badly with an audience that built around the brand specifically because it was not in the pro shop. Growth channels and brand identity are not always the same direction.</p>",
        },
        {
          id:      "the-long-game",
          heading: "The Long Game: LA Golf After Bryson",
          body:    "<p>LA Golf. The shaft maker sits at 11th, one spot from the top ten, at a DI of 30.1, and its most famous ambassador just benched the most visible club in the partnership. That sounds like a warning. It might be an opening. The driver-switch coverage proved the brand can generate attention independent of an active endorsement win, the Rebar shafts remain in Bryson's irons and wedges, and the WITB audience now watches LA Golf's tour presence with a curiosity it never had when the story was settled. The question for the next three months is whether LA Golf converts the breakup energy into a top-ten seat or fades back into the component-brand pack once the conversation moves on. If it cracks the top ten by September, it will be the first shaft company ever to do it, and the index will have caught a structural shift in what golfers pay attention to inside the bag.</p>",
        },
        {
          id:      "global-dispatch",
          heading: "Global Dispatch: The China Land Grab Has a Timeline Now",
          body:    "<p>Vuori's Wall Street Journal announcement of 20 China stores by 2027 put a number on something this index has been circling since March, when Malbon opened its Shanghai flagship and China led all markets at plus 52.7%. Golf apparel's growth thesis in China is no longer speculative. Two premium Western brands have now committed physical retail to it on the record, and they are approaching it from opposite ends: Malbon selling streetwear scarcity, Vuori selling wellness lifestyle at a $5.5 billion valuation. The Chinese golf consumer will decide which translation of American golf culture actually lands. The index will show the verdict before the earnings calls do.</p>",
        },
        {
          id:      "closing",
          heading: "The Closing Note: The Index Pays for Stories, Not Trophies",
          body:    "<p>Five issues in, June gave us the cleanest statement yet of what this index actually measures. True Temper won the U.S. Open and lost a third of its attention. ProSENDR won nothing and gained 81%. Krank got dumped on the biggest stage in golf and went up 50%. The lesson is not that winning does not matter. It is that winning only matters when it changes the story, and most winning does not. The brands that moved this month all had something happen to them that a golfer would retell at dinner. That is the whole game. The Open Championship is next, and links golf always produces at least one story nobody saw coming. See you in August.</p>\n<p class=\"scorecard-signature\">Adam and Travis, DORMIED</p>\n<p class=\"scorecard-substack-link\"><a href=\"https://dormiedgolf.substack.com/p/shinnecock-paid-out-in-strange-currency\" target=\"_blank\" rel=\"noopener\">Read on Substack <span aria-hidden=\"true\">&#x2192;</span></a></p>",
        },
      ],
      indexSnapshot: [
        { rank: 1, id: "titleist",    name: "Titleist",    di: 100,  mom: -18.3 },
        { rank: 2, id: "taylormade",  name: "TaylorMade",  di: 81.7, mom: -18.3 },
        { rank: 3, id: "travismathew", name: "TravisMathew", di: 67.1, mom: 0    },
        { rank: 4, id: "callaway",    name: "Callaway",    di: 54.9, mom: 0    },
        { rank: 5, id: "footjoy",     name: "FootJoy",     di: 44.7, mom: -18.5 },
      ],
      brandMentions: ["titleist","taylormade","travismathew","callaway","footjoy","la-golf","vice-golf","prosendr","krank-golf","true-temper","greg-norman-collection","primo-golf-apparel","public-drip","mclaren-golf","fore-all","vuori","malbon","the-stack-system","accra","pxg"],
    },

    /* ── JUNE 2026 ─────────────────────────────────────────────────────── */
    {
      slug:       "june-2026",
      title:      "The Quiet Man Won the Loud Major | The Scorecard | June 2026",
      subtitle:   "Aaron Rai won a major with a driver older than some TGL franchises and moved four brands doing it.",
      date:       "Jun 11, 2026",
      dateISO:    "2026-06-11",
      monthLabel: "June 2026",
      images: {
        hero:  null,
        strip: [
          { src: "https://substackcdn.com/image/fetch/f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fea7efba2-07ab-4bc7-be2e-d4e398c68727_960x640.jpeg", label: "Aaron Rai, 2026 PGA Championship" },
          { src: "https://substackcdn.com/image/fetch/f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fe6c3250f-8d67-4c69-bed2-93f9f678be79_1036x583.jpeg", label: "The Field" },
          { src: "https://substackcdn.com/image/fetch/f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fc2349fd3-d4fe-4a77-a493-82347df9e169_1200x799.jpeg", label: "The Drop Zone" },
        ],
      },
      toc: [
        { id: "at-the-top",       label: "At The Top"       },
        { id: "the-biggest-move", label: "The Biggest Move" },
        { id: "the-field",        label: "The Field"        },
        { id: "the-drop-zone",    label: "The Drop Zone"    },
        { id: "the-long-game",    label: "The Long Game"    },
        { id: "global-dispatch",  label: "Global Dispatch"  },
        { id: "closing",          label: "Closing"          },
      ],
      sections: [
        {
          id:      "intro",
          heading: null,
          body:    "<p>Golf spent the last decade convincing itself that speed is everything. Then Aaron Rai won the PGA Championship at Aronimink with a seven-year-old TaylorMade M6 driver, ranking among the shortest hitters in the field, hitting fairways while everyone around him chased ball speed. May's major did not just crown an unlikely champion. It quietly indicted half the industry's marketing. The training aids selling speed gains, the launch monitors measuring them, the $375 irons engineered like Formula 1 parts: all of it had a rough month on the index while the winner's bag told a story about precision, patience, and equipment old enough to be in second grade. Our game has a habit of humbling whatever it just finished hyping. May was that month, and the data caught nearly every casualty.</p>",
        },
        {
          id:      "at-the-top",
          heading: "At The Top",
          body:    "<p>Titleist holds the top spot for the fifth consecutive month, and it is sitting at a 52-week peak while doing it. TaylorMade is steady in second at 81.7, also at a 52-week high, with the M6 driver win at Aronimink providing the strangest possible marketing for a brand whose entire model depends on you replacing that club. TravisMathew holds third at 54.8 for the fourth straight month, the quietest sustained run in the top five. Callaway and FootJoy share fourth at 44.9, both giving back 18.2% but holding their ranks. The story beneath them is Takomo Golf at 11, knocking on the top-10 door after its 101 MKII beat Callaway, PING, and TaylorMade in MyGolfSpy's game-improvement iron test at $579 a set.</p>",
        },
        {
          id:      "the-biggest-move",
          heading: "The Biggest Move",
          body:    "<p>A month ago McLaren Golf posted the largest move in this index's history, up 307.4% on a launch timed to the Miami Grand Prix. We wrote that whether it could convert attention into sustained presence was the question the next six months would answer. It took one. McLaren fell 63.3% in May, dropping five spots to 12th. The launch coverage carried into early May, but then Justin Rose had to actually play the clubs. He finished T65 at the Cadillac Championship in the debut, added another poor week at the Truist, and MyGolfSpy noted he went from 16 under in his two starts before the switch to a combined one over in his first two with the new irons. A mid-May community sentiment piece cataloguing skepticism about the $375-per-club price kept the conversation alive for all the wrong reasons. None of this means McLaren is finished. A DI of 20.1 still puts a one-month-old brand ahead of names that have been in golf for decades. But the gap between launch attention and earned attention is where new equipment brands go to die, and McLaren is now standing in it. PXG survived this exact valley because Bob Parsons kept spending through it. McLaren's resolve gets tested next.</p>",
        },
        {
          id:      "the-field",
          heading: "The Field",
          body:    "<p>ACCRA posted the month's biggest gain, up 131.6% and 25 spots to a 52-week peak, after Wyndham Clark won the CJ Cup Byron Nelson with an ACCRA putter shaft in his L.A.B. Golf OZ.1i. A putter shaft brand cracking winning-bag coverage is rare. Two waves of it in one month, after a player running ACCRA woods shafts showed up in PGA Championship WITB coverage, is how a component brand has its best month ever.</p>\n<p>Aldila rose 23.1% because Rai's winning driver, ancient as the head was, carried a recently swapped Aldila Synergy Blue 70 TX. The shaft was newer than the club. Graphite Design climbed 22.2% after a first-weekend-of-May sweep put its shafts in winners' bags on the LPGA, PGA Tour Champions, and JGTO simultaneously. And KBS Golf rose 22.3% after Kristoffer Reitan won the Truist Championship with KBS Tour X shafts. Three shaft brands and a putter shaft specialist all moving on tour results in the same month tells you the WITB audience is reading deeper into the bag than the equipment giants would like.</p>\n<p>Elsewhere, the Greg Norman Collection jumped 50% to a 52-week peak after Norman's viral Instagram post congratulating Rai put the Shark back in golf's mainstream conversation, his first cultural moment since leaving LIV behind and returning full-time to his apparel company. Breezy Golf climbed 22.4% to 28th, a 52-week peak, on the back of Bob Does Sports' Shinnecock video and a sold-out U.S. Open collection. And Vuori made our Long Game call from last month look good, rising another 22.2% to its best rank ever as the second Tom Holland golf collection dropped May 12. Two consecutive months of gains on the Holland strategy. The template is working.</p>",
        },
        {
          id:      "the-drop-zone",
          heading: "The Drop Zone",
          body:    "<p>Malbon fell 33.3% in a month that tested how much cultural heat one brand can absorb. Jason Day's camo shorts at the PGA Championship went viral for the wrong reasons, with fans at Aronimink openly calling for him to drop the brand. A Tustin warehouse sale offering 70% off ran the same month, and discount channels are not where premium streetwear brands want their inventory moving. Malbon holds 6th on the index, so this is a correction from the Augusta-fueled April high rather than a collapse. But the backlash is worth watching because it is the first sign the brand's ubiquity is generating friction.</p>\n<p>Sun Day Red dropped 33% in the worst news month of the brand's short life. Tiger Woods confirmed he will miss all four majors in 2026, his DUI case kept the founder in a damaging news cycle, and the brand ran a 30% off Archive Sale that signals inventory pressure. The first women's collection launched into that headwind with no tour athlete to anchor it. A brand built entirely on one man's aura has no shock absorbers when the man is the problem.</p>\n<p>Peter Millar gave back 33.3% of last month's Cameron Young surge after a MyGolfSpy piece exposed the brand's inventory sitting behind TJ Maxx's \"Reveal Designer\" button. Over 500 women's pieces at off-price retail is a hard thing to square with pro shop pricing, and the search data suggests readers noticed. Krank Golf fell 33.3% as Bryson DeChambeau missed the cut at the PGA and withdrew from LIV Mexico City with a wrist injury. The one-ambassador risk cuts both ways. And The Stack System dropped 31.6% in the cruelest data point of the month: the year's second major was won by one of the shortest hitters on tour, swinging a seven-year-old driver, the week speed training was supposed to matter most.</p>\n<p>Nike Golf fell 33.1% despite launching the Pegasus 1 Golf on May 1. MyGolfSpy named the Roshe G among the most overrated shoes of 2026 on May 19, and Rai won the PGA in Eccos the same week Nike dropped its limited championship shoe pack at Aronimink. L.A.B. Golf slid another 18.2%, its fourth consecutive monthly decline, though Clark winning with a L.A.B. putter in his hands is the kind of result that has historically preceded the brand's surges. The floor may finally be in sight.</p>",
        },
        {
          id:      "the-long-game",
          heading: "The Long Game",
          body:    "<p>Tour Edge. The Batavia, Illinois brand has spent thirty years as golf's value afterthought, and May was the month the lab results stopped cooperating with that story. The Exotics CB topped MyGolfSpy's Most Wanted Players' Iron test in Strokes Gained against a 15-iron field that included every major OEM. The Zero T putter line launched at $199.99, claiming the value end of the zero-torque category before anyone else thought to. The Exotics Mini Driver debuted at 280cc with a MyGolfSpy first look. Three product news cycles in one month, a 52-week peak, and independent testing wins stacking up since April's driver results. The brand is up 22.7% and sitting at 49th. If the testing dominance continues through the summer equipment cycle, Tour Edge will not stay outside the top 40 for long. Watch it through August.</p>",
        },
        {
          id:      "global-dispatch",
          heading: "Global Dispatch",
          body:    "<p>While Malbon was taking its lumps in the American conversation, it was making a very different move in South Korea. The brand launched a Ballantine's collaboration in Seoul on May 28, a co-branded whisky and capsule apparel collection aimed at Korea's travel retail market. Korea has long been Malbon's strongest international story, with standalone retail and a customer base that treats golf apparel as a luxury category rather than sportswear. The timing is instructive: the same month US sentiment turned and inventory hit discount channels at home, the brand deepened its position in the market where premium golf streetwear still commands full price. Korea is not Malbon's hedge against an American correction. It might be the core business.</p>",
        },
        {
          id:      "closing",
          heading: "Closing",
          body:    "<p>Four issues in, May taught the clearest lesson yet. McLaren spent a fortune announcing itself and lost two-thirds of its attention in thirty days. Aaron Rai spent nothing, won a major with a driver older than some TGL franchises, and moved four brands in the process, including two shaft companies most golfers could not name. Attention that arrives through performance compounds. Attention that arrives through spectacle decays. Every brand on this index is somewhere on that spectrum, and every month the data tells us who is which. The U.S. Open at Shinnecock is three days away. Somebody's July number is about to be made.</p>\n<p class=\"scorecard-signature\">Adam and Travis, DORMIED</p>\n<p class=\"scorecard-substack-link\"><a href=\"https://dormiedgolf.substack.com/p/the-quiet-man-won-the-loud-major\" target=\"_blank\" rel=\"noopener\">Read on Substack <span aria-hidden=\"true\">→</span></a></p>",
        },
      ],
      indexSnapshot: [
        { rank: 1, id: "titleist",    name: "Titleist",    di: 100,  mom: 0    },
        { rank: 2, id: "taylormade",  name: "TaylorMade",  di: 81.7, mom: 0    },
        { rank: 3, id: "travismathew",name: "TravisMathew",di: 54.8, mom: 0    },
        { rank: 4, id: "callaway",    name: "Callaway",    di: 44.9, mom: -18.2 },
        { rank: 4, id: "footjoy",     name: "FootJoy",     di: 44.9, mom: -18.2 },
      ],
      brandMentions: [
        "titleist", "taylormade", "travismathew", "callaway", "footjoy",
        "takomo-golf", "mclaren-golf", "accra", "aldila", "graphite-design",
        "kbs-golf", "greg-norman-collection", "breezy-golf", "vuori",
        "malbon", "sun-day-red", "peter-millar", "krank-golf", "the-stack-system",
        "nike-golf", "l-a-b-golf", "tour-edge", "pxg",
      ],
    },

    /* ── MAY 2026 ──────────────────────────────────────────────────────── */
    {
      slug:       "may-2026",
      title:      "The Scorecard | May 2026",
      subtitle:   "McLaren did not tiptoe into our game. It kicked in the door at $375 a club with a world top-five player and a Formula 1 race happening down the road.",
      date:       "May 19, 2026",
      dateISO:    "2026-05-19",
      monthLabel: "May 2026",

      images: {
        hero: null,
        strip: [
          { src: "/images/scorecard/may-2026/mclaren-launch.jpg",  label: "McLaren Golf launch" },
          { src: "/images/scorecard/may-2026/mclaren-irons.jpg",   label: "McLaren Series 1 irons" },
          { src: "/images/scorecard/may-2026/the-field.jpg",       label: "The Field" },
        ],
      },

      toc: [
        { id: "at-the-top",        label: "At The Top"       },
        { id: "the-biggest-move",  label: "The Biggest Move" },
        { id: "the-field",         label: "The Field"        },
        { id: "the-drop-zone",     label: "The Drop Zone"    },
        { id: "the-long-game",     label: "The Long Game"    },
        { id: "global-dispatch",   label: "Global Dispatch"  },
        { id: "closing",           label: "Closing"          },
      ],

      sections: [
        {
          id:      "intro",
          heading: null,
          body: `<p>A Formula 1 team launched golf clubs in April. Not a licensing deal on a headcover. Not a co-branded polo. Actual irons, engineered from the ground up using metal injection moulding, debuted by a world top-five player at a PGA Tour Signature Event the same week as the Miami Grand Prix. McLaren Golf did not tiptoe into our game. It kicked in the door at $375 a club with Justin Rose, Michelle Wie West, and Ian Poulter signed on not just as ambassadors but as investors. The last time a new entrant made this much noise on arrival, Bob Parsons was writing checks for PXG in 2015. Whether McLaren follows that trajectory or flames out like every other luxury crossover that has tried golf remains the only question that matters. April's data suggests the market is at least paying attention.</p>`,
        },
        {
          id:      "at-the-top",
          heading: "At The Top",
          body: `<p>Titleist holds the top spot for the fourth consecutive month, as steady as the brand itself. TaylorMade sits second at 81.7, buoyed by Rory McIlroy's second consecutive Masters win with the Qi4D driver and 2026 TP5 ball. Only the fourth player in 90 years to go back-to-back at Augusta. TravisMathew, Callaway, and FootJoy share third at 54.8. FootJoy's arrival in the top five is the story here. The Aime Leon Dore collaboration, the Premiere Series relaunch, and Cameron Young winning The Players in FootJoy pushed the brand to heights it has not reached on the index before.</p>`,
        },
        {
          id:      "the-biggest-move",
          heading: "The Biggest Move",
          body: `<p>McLaren Golf surged 307.4% in April, climbing 18 spots to a DI of 54.8. That puts a brand that did not exist in the index three months ago in a tie for third place. The launch was orchestrated with the precision you would expect from a company that builds cars for a living. Rose, who leads the PGA Tour in greens in regulation this season and already won the Farmers Insurance Open wire-to-wire in January, debuted the Series 1 blades at the Cadillac Championship the same week Lando Norris was racing in Miami. CEO Neil Howie spent over 25 years at Callaway. The irons use metal injection moulding with an internal structural mesh and hidden tungsten weighting. Rose has been involved in development for nearly two years. The PXG comparison is inevitable: premium price, tour validation from day one, bold entry into a crowded market. The difference is McLaren already has a globally recognized brand worth billions behind it. Whether it can convert attention into sustained market presence is what the next six months will answer.</p>`,
        },
        {
          id:      "the-field",
          heading: "The Field",
          body: `<p>Vuori jumped 176.9% to a DI of 1.2, climbing 17 spots. Last month we reported the brand dropping 18.8% after the Fleetwood speculation ended. This month Tom Holland was announced as a global ambassador, creative partner, and financial investor, with the golf-centric "Play It as It Lies" campaign launching the same week as the Masters. Spider-Man playing golf in Portugal is a very different brand strategy than chasing a PGA Tour apparel deal, and the data says it worked.</p>
<p>Ben Hogan Golf climbed 172.5% to a DI of 20.1 on the strength of the GS53 golf ball launch, the brand's first entry into the ball category. Named after Hogan's legendary 1953 Triple Crown, the four-piece premium construction at $50 a dozen is pitched directly at the ProV1 buyer who wants to feel something when they read the name on the ball. Whether nostalgia converts to sustained purchase behavior is another question.</p>
<p>Peter Millar surged 124.2% after Cameron Young wore the brand during his Players Championship win in March. The quiet luxury play is working. Bettinardi rose 50% as Matt Fitzpatrick won twice in three weeks, the Valspar Championship and the Zurich Classic, becoming the only player this season winning with a blade putter. The BB 6.0 and BB 7.0 also swept first and second in MyGolfSpy's mallet test.</p>`,
        },
        {
          id:      "the-drop-zone",
          heading: "The Drop Zone",
          body: `<p>L.A.B. Golf fell another 18.2%, marking the third consecutive monthly decline since February's 174% spike. The LINK 2.1 and 2.2 launched in April. Rickie Fowler ditched his L.A.B. DF3 for a 14-year-old Scotty Cameron Golo. The brand is still meaningfully higher than where it sat six months ago, but the trajectory since the Cognizant Classic peak now looks like a classic spike-and-settle pattern. The floor has not been established yet.</p>
<p>UST Mamiya dropped 19.4% in the same month they signed Rickie Fowler, giving the shaft maker its biggest name in years. A signing alone does not move search volume. Product and results do. The Stack System and Perfect Practice both fell roughly 21%, suggesting the training aid category is cooling after a hot start to the season.</p>`,
        },
        {
          id:      "the-long-game",
          heading: "The Long Game",
          body: `<p>Vuori. The Tom Holland deal is not a one-off campaign. He is a creative partner and equity holder in a brand that just launched a dedicated golf collection with course-specific apparel, magnetic scorecard pockets, and a full cinematic campaign filmed in Portugal. Vuori raised $400 million from SoftBank at a $4 billion valuation in 2021. The golf play follows the same template On used with Zendaya to move from niche performance brand to global lifestyle company. If Vuori's May numbers hold or grow, it will confirm that the most valuable thing in golf apparel right now is not a tour contract but a famous person who actually plays the game.</p>`,
        },
        {
          id:      "global-dispatch",
          heading: "Global Dispatch",
          body: `<p>McLaren Golf launched simultaneously in North America, Europe, and South Korea through select custom-fitting retailers. That three-market launch is deliberate. South Korea is the most brand-conscious golf market in the world, where PXG already proved that premium positioning translates to outsized market share. McLaren's decision to include Korea from day one, rather than expanding later, signals the brand understands where the early adopter money lives. Watch the Korean DI number next month. If McLaren's global surge was disproportionately driven by one market, it will tell us whether this is a worldwide story or an Asian luxury play.</p>`,
        },
        {
          id:      "closing",
          heading: "Closing",
          body: `<p>Justin Rose drove a papaya McLaren GTS to the McLaren Technology Centre, walked past the set of a Brad Pitt movie, and sat down with engineers to finalize the irons he would play that week in Miami. Two years of development, one launch day timed to a Formula 1 race, and a 307% move on the index. Whether that translates to a real equipment business or an expensive vanity project is a story we will be telling for the rest of the year. But this much is already clear: the barrier to entry in golf equipment has never been lower and the cost of attention has never been higher. McLaren just paid both prices at once.</p>
<p class="scorecard-signature">Adam and Travis, DORMIED</p>
<p class="scorecard-substack-link"><a href="https://dormiedgolf.substack.com/p/the-scorecard-may-2026" target="_blank" rel="noopener">Read on Substack <span aria-hidden="true">→</span></a></p>`,
        },
      ],

      indexSnapshot: [
        { rank: 1, id: "titleist",     name: "Titleist",      di: 100.0, mom:   0.0 },
        { rank: 2, id: "taylormade",   name: "TaylorMade",    di:  81.7, mom:  22.4 },
        { rank: 3, id: "travismathew", name: "TravisMathew",  di:  54.8, mom:   0.0 },
        { rank: 3, id: "callaway",     name: "Callaway",      di:  54.8, mom:  22.2 },
        { rank: 3, id: "footjoy",      name: "FootJoy",       di:  54.8, mom:  22.2 },
        { rank: 3, id: "mclaren-golf", name: "McLaren Golf",  di:  54.8, mom: 307.4 },
      ],

      brandMentions: [
        "titleist", "taylormade", "travismathew", "callaway", "footjoy",
        "mclaren-golf", "pxg", "vuori", "ben-hogan-golf", "peter-millar",
        "bettinardi", "l-a-b-golf", "scotty-cameron", "ust-mamiya",
        "the-stack-system", "perfect-practice",
      ],
    },

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
          heading: "At The Top",
          body: `<p>Titleist holds the top position for the third consecutive month. That level of consistency is not exciting to write about, which is probably the point. The brand does not need a moment. It is the moment.</p>
<p>TaylorMade slipped to 66.8, continuing a gradual drift that has been building since the start of the year. TravisMathew holds at 54.8. Callaway and Sun Day Red are tied at 44.9. A Tiger-adjacent brand matching one of the game's most established equipment makers in a single month is its own kind of story.</p>`,
        },
        {
          id:      "the-biggest-move",
          heading: "The Biggest Move",
          body: `<p>Sugar Loaf Social Club jumped 125% in March, climbing 15 spots in the index to reach a DI of 3.3. That number sounds small until you consider where this brand was twelve months ago.</p>
<p>The catalyst was a collision of events that would have been impossible to engineer deliberately. Sugar Loaf released a 17-piece collaboration with Students Golf, covered by Boardroom, Skratch, and every gear forum that matters, ranging from $60 tees to an $875 MacKenzie bag. They dropped a Players Championship co-branded collection. And then Brandon Holtz, the U.S. Mid-Amateur champion, received his Masters invitation and was confirmed wearing Sugar Loaf at Augusta. His retired State Farm agent father on the bag. A brand built over a group chat among college friends was suddenly dressing someone teeing it up at Augusta National.</p>
<p>You cannot buy that. You can only be in position for it when it happens. Sugar Loaf is a subsidiary of Pro Shop Holdings, which also owns Skratch. When the moment arrived, the distribution infrastructure was already in place.</p>`,
        },
        {
          id:      "the-field",
          heading: "The Field",
          body: `<p>Rhoback climbed 86.2% to 1.8. The annual Azalea Collection does real work, and a No Laying Up "First Major" capsule collab during Players week gave it the distribution it needed. The brand knows its moment and prepares for it a year in advance.</p>
<p>Krank Golf was up 51.7% following Bryson DeChambeau's back-to-back LIV victories in Singapore and South Africa using their Formula Fire drivers. Tour success still moves the needle for equipment brands in a way that apparel rarely replicates. When a recognizable player wins with a product back-to-back, the search interest is immediate and measurable.</p>`,
        },
        {
          id:      "the-drop-zone",
          heading: "The Drop Zone",
          body: `<p>L.A.B. Golf dropped 33.3%, falling 17 spots to a DI of 4.9. This is not a story about a brand losing momentum. It is arithmetic. February's 174% surge was exceptional. March's correction was inevitable. The brand launched the LINK 2.1 and 2.2 mid-month and landed on Fast Company's Most Innovative Companies list. It is still well above where it was six months ago.</p>
<p>Vuori declined 18.8%. The brand had been building quietly on the back of Tommy Fleetwood's visibility, and then Blackstone signed Fleetwood on March 31st. The deal moves him into a different tier of brand partnership. The Vuori chapter appears to be closed, and the customer complaints about fabric quality and a production shift to Cambodia that surfaced in the same window did not help.</p>`,
        },
        {
          id:      "global-dispatch",
          heading: "Global Dispatch",
          body: `<p>China surged 52.7% in March, the strongest single-market month we have seen from that region this year. The catalyst was Malbon opening its first mainland flagship store at Jing'an Kerry Centre in Shanghai. A physical retail presence in mainland China signals a level of commitment that search data reflects almost immediately. The question is whether that interest sustains or follows the pattern of launch spikes that fade over the following two months.</p>`,
        },
        {
          id:      "closing",
          heading: "Closing",
          body: `<p>Sugar Loaf dressed a Mid-Am champion heading into Augusta. Krank made noise through one player's two wins. Rhoback turned Augusta week into a product calendar tentpole with zero official affiliation.</p>
<p>The old playbook was tour contracts and print ads. The new one is cultural proximity. The brands that are not positioned for the moment when it arrives will not get a second shot at it.</p>
<p class="scorecard-signature">Adam and Travis, DORMIED</p>`,
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
          heading: "At The Top",
          body: `<p>Titleist holds at 100.0. TaylorMade at 82.1. TravisMathew and Callaway are tied at 54.7, though TravisMathew's three-month trend is down 45%, worth watching. Sun Day Red surged 48.6% to complete the top five, driven by Fleetwood's Genesis sighting plus the Pioneer Willow golf shoe launch on February 26th and the Presidio spikeless on February 17th.</p>
<p>The top of the index is remarkably stable. The same five brands have occupied these positions for consecutive months, which tells you something about how concentrated attention is at the top of the game. The action is in the middle of the field.</p>`,
        },
        {
          id:      "the-biggest-move",
          heading: "The Biggest Move",
          body: `<p>L.A.B. Golf jumped 174.1% in February. That is the single largest move we have recorded in the index since we began tracking. The brand climbed 35 spots to reach a DI of 11.0, a number that would have seemed impossible twelve months ago for a putter-focused brand with no major tour presence.</p>
<p>Three things converged: Austin Smotherman's wire-to-wire Cognizant Classic contention (he made 132 feet of putts in the opening round), JJ Spaun's major championship win using a L.A.B. putter, and the announcement that L Catterton had paid north of $200M to acquire the brand. More than Callaway paid for Odyssey in 1997. A 174% spike with no way to capture demand is noise. This one had somewhere to go.</p>`,
        },
        {
          id:      "the-field",
          heading: "The Field",
          body: `<p>Students Golf climbed 50% to 2.7, jumping 15 spots in the index. The TGL broadcasts put the brand in front of a primetime audience that does not typically follow equipment coverage, and the brand had product ready when interest arrived. Their Course Studies collection at the PGA Show gave it distribution legs. Founded in 2022, they are executing like a brand that has been doing this for a decade.</p>
<p>Sun Day Red's 48.6% jump completes a pattern: proximity to Fleetwood moved search for every brand he wore, but Sun Day Red had the biggest infrastructure to capture it.</p>`,
        },
        {
          id:      "the-long-game",
          heading: "The Long Game",
          body: `<p>Tommy Fleetwood's post-Nike visibility window is closing. Every brand he has been seen wearing in the last 60 days — Malbon, Sun Day Red, Students Golf — registered it in the data. The partnership that does get announced will be visible in the numbers before anyone publishes a press release.</p>
<p>Students Golf probably cannot match adidas money. Sun Day Red is a Tiger vehicle. Malbon is building something different. Whoever signs him is getting a player the internet is watching closely, in a sport that is growing, at the exact moment when brand-athlete alignment matters more than it has in twenty years.</p>`,
        },
        {
          id:      "the-drop-zone",
          heading: "The Drop Zone",
          body: `<p>EP NY collapsed 80.8%. The brand (founded in 1995, rebranded from EP Pro in 2017) is now at 167th in the index. Its six-month trend is down 89.6%. That is not a correction. That is a brand that has lost the audience it once had with no visible path to recovery.</p>
<p>HackMotion fell 45.5%, dropping 25 spots to a DI of 1.2. Training aid brands live and die by content cycles, and February was a quiet one for the category. No viral moment, no tour story, no product drop that found an audience. The three-month trend is down 75.8%.</p>`,
        },
        {
          id:      "global-dispatch",
          heading: "Global Dispatch",
          body: `<p>PXG's South Korea DI is 100.0 against a global average of 30.1. That gap illustrates something the index rarely makes this visible: a brand's global rank tells you very little about its position in any specific market. PXG is not a top-ten brand globally. In South Korea it is the benchmark — operating as a premium lifestyle brand in a market where that positioning has stuck. Regional strategy and global strategy are different documents, and most brands are only writing one of them.</p>`,
        },
        {
          id:      "closing",
          heading: "Closing",
          body: `<p>The most valuable thing a brand can have right now is not a product launch or a tour win. It is proximity to a player the internet is watching. Tommy Fleetwood moved the needle for three different brands in a single month just by getting dressed in the morning.</p>
<p>March data will reflect the Florida swing and the first tremors of Masters season. The brands that are not positioned for the moment when it arrives will not get a second shot at it.</p>
<p class="scorecard-signature">Adam and Travis, DORMIED</p>`,
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
