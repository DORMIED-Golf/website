/* ─────────────────────────────────────────────────────────────────────────────
   take-preview.js — local sample data for THE READ
   Runs on localhost only. Intercepts fetch('/api/take') so brand.js and home.js
   get sample takes without hitting the real API.
   No effect on production.
   ───────────────────────────────────────────────────────────────────────────── */
(function () {
  var hostname = window.location.hostname;
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') return;

  var SAMPLES = {
    'callaway':
      'Sitting at the top of the index is less a triumph right now and more a testament to the inertia of scale. The Paradym AI Smoke line is converting at retail, the tour bag is full, and the brand does not appear to need a reason to stay relevant.',

    'titleist':
      'The Pro V1 does not need a viral moment. Titleist holds its position the way it always has — quietly, confidently, and with the kind of brand loyalty that its competitors have spent decades trying to replicate.',

    'taylormade':
      'Qi10 is still doing work in the algorithm. The Scottie Scheffler effect is real, and the data through February reflects it — this is the brand that wins when the world\'s best player keeps winning.',

    'ping':
      'Steady is not a criticism when you are holding top-five globally. The numbers have not moved dramatically in either direction, which for a brand built on precision engineering is probably exactly the point.',

    'cobra':
      'The Darkspeed launch gave the brand a bump, but it has since settled back to its floor. A brand that punches above its retail weight when it has a story to tell, and is clearly between stories right now.',

    'scotty-cameron':
      'Still the most searched putter brand in golf. Scotty Cameron does not need to do much to stay relevant, which is either a tribute to the brand or an indictment of how little the putter market moves.',

    'cleveland-golf':
      'The wedge business is holding. Cleveland is not a brand that chases headlines, and the search data reflects a quiet, consistent audience that knows what it wants and keeps coming back for it.',

    'sun-mountain':
      'The Michael Block ambassador deal was a smart move for a brand that has historically undersold itself relative to its product quality. The Eclipse bag is getting real press, and the Alma Mater collab is the kind of thing that finds its way onto Instagram whether anyone plans it or not.',

    'jones-sports-co':
      'Portland-cool and quietly building. Jones is not a brand that screams for attention, which is a feature, not a bug — the search interest is organic and the audience it has is genuinely loyal.',

    'bushnell-golf':
      'Rangefinder category leader by a comfortable margin. Bushnell benefits from being the default answer in a category that most golfers buy once and stick with.',

    'arccos-golf':
      'The subscription model creates a floor the raw search data does not fully capture. Arccos is building something stickier than most golf tech brands, and the numbers are starting to reflect it.',

    'footjoy':
      'Tour presence is doing its job. FootJoy is not having a breakout moment, but it is not losing ground either — a brand that competes on trust rather than trend.',

    'adidas-golf':
      'The apparel side is holding up better than the equipment business ever did. Post-equipment exit, Adidas Golf has found its lane, even if that lane is narrower than it used to be.',

    'puma-golf':
      'Rickie Fowler is back in form and the search data knows it. Puma is one of the few lifestyle-adjacent golf brands that actually benefits when its tour players are relevant.',

    'vice-golf':
      'The DTC model is working on its own terms. Vice is not trying to be Titleist, and the data suggests its audience has accepted that framing completely.',

    'bad-birdie':
      'Growing exactly the way a DTC apparel brand is supposed to grow — not explosively, but consistently. The audience it has is enthusiastic, and the product keeps getting better.',

    'g-fore':
      'Still the premium apparel answer for golfers who want to look like they do not need to think about it. Holding its position, and the search data has leveled off into something that looks like maturity rather than decline.',

    'malbon-golf':
      'Lifestyle credibility is high. The question for Malbon has always been whether that translates to sustained search interest, and right now the answer is a qualified yes.',

    'under-armour-golf':
      'Hovering in the middle of the pack with a tour roster that should be doing more for the numbers. The Rory effect is real, but it is not lifting the brand the way the deal was presumably designed to.',

    'srixon':
      'Quietly consistent. Srixon sits in a position where its core audience is locked in and not going anywhere, which is either a strength or a ceiling depending on how ambitious the brand intends to be.',

    'wilson-golf':
      'The Staff model relaunch gave Wilson a moment, and the brand has been careful not to squander it. Search interest is ticking up in markets where it had been flat, and that is worth watching.',

    'bettinardi':
      'A brand that earns its search interest through craftsmanship rather than marketing spend. The numbers are never dramatic, but they have been holding at a level that reflects a healthy, devoted audience.',

    'odyssey':
      'The white hot insert is still the most recognizable piece of equipment technology in putting, and that brand recognition shows up in the data every month without fail.',
  };

  var GENERIC = 'Holding its position in the index with the kind of consistency that points to a loyal core audience doing the work. No dramatic moves in either direction this month, which is either a sign of stability or a lack of urgency depending on where the brand wants to go.';

  // Intercept fetch so /api/take calls return sample data instantly
  var _originalFetch = window.fetch;
  window.fetch = function (url, options) {
    if (typeof url === 'string' && url.indexOf('/api/take') !== -1) {
      try {
        var body    = options && options.body ? JSON.parse(options.body) : {};
        var name    = body.name || '';
        // Convert brand name to slug to look up sample (e.g. "Sun Mountain" → "sun-mountain")
        var slug    = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        var take    = SAMPLES[slug] || GENERIC;
        var payload = JSON.stringify({ take: take });
        return Promise.resolve(new Response(payload, {
          status:  200,
          headers: { 'Content-Type': 'application/json' },
        }));
      } catch (e) {
        return Promise.resolve(new Response(JSON.stringify({ take: GENERIC }), {
          status:  200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
    }
    return _originalFetch.apply(this, arguments);
  };

  console.log('[DORMIED preview] THE READ fetch mock active — ' + Object.keys(SAMPLES).length + ' brand samples + generic fallback.');
})();
