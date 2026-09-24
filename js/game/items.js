// RoGuPong — the item crates.
//
// A crate drifts through the middle of the court every few seconds. Whoever
// last touched the ball that breaks it gets the pickup, immediately. That
// keeps items as a reward for winning the rally rather than a lottery.
//
// Each stage deals only its own four (stages.js): MULTIBALL everywhere, two
// classics that suit the place and one signature crate found nowhere else.

export const ITEMS = [
  {
    id: 'multi',
    name: 'MULTIBALL',
    glyph: '*',
    blurb: 'Two more balls join the rally.',
    color: '#8affc1',
    duration: 0,
    weight: 3,
  },
  {
    id: 'grow',
    name: 'BIG PADDLE',
    glyph: '+',
    blurb: 'Your paddle swells for seven seconds.',
    color: '#ffd93b',
    duration: 7,
    weight: 4,
  },
  {
    id: 'frost',
    name: 'DEEP FREEZE',
    glyph: '#',
    blurb: 'Their paddle wades through treacle.',
    color: '#9df3ff',
    duration: 4,
    weight: 3,
  },
  {
    id: 'turbo',
    name: 'TURBO',
    glyph: '>',
    blurb: 'The ball gets serious.',
    color: '#ff7a3d',
    duration: 0,
    weight: 3,
  },
  {
    id: 'ghost',
    name: 'GHOST BALL',
    glyph: '?',
    blurb: 'Now you see it. Mostly you do not.',
    color: '#c9a2ff',
    duration: 4,
    weight: 2,
  },
  {
    id: 'shrink',
    name: 'SHRINK RAY',
    glyph: '-',
    blurb: 'Their paddle gets tiny.',
    color: '#ff8ae2',
    duration: 5,
    weight: 3,
  },
  {
    id: 'beach',
    name: 'BEACH BALL',
    glyph: '0',
    blurb: 'Huge, slow and impossible to take seriously.',
    color: '#ff5b5b',
    duration: 6,
    weight: 2,
  },

  // The signature crates, one per stage.
  {
    id: 'mirror',                 // Navigli
    name: 'REFLECTION',
    glyph: '~',
    blurb: 'A mirror-image decoy shadows the ball across the water.',
    color: '#4fb8ff',
    duration: 5,
    weight: 3,
  },
  {
    id: 'spire',                  // Duomo
    name: 'SPIRE',
    glyph: '^',
    blurb: 'A marble pinnacle rises on their half. Mind the bounce.',
    color: '#f2e2cc',
    duration: 6,
    weight: 3,
  },
  {
    id: 'arco',                   // Brera
    name: 'ARCO',
    glyph: '\u2229',             // an arch, drawn by the pixel font
    blurb: 'For six seconds your returns bend back in an arch.',
    color: '#9d8cff',
    duration: 6,
    weight: 3,
  },
  {
    id: 'avalanche',              // Alpi
    name: 'AVALANCHE',
    glyph: '\u2313',             // a snowbank, drawn by the pixel font
    blurb: 'A snowdrift guards the open side of your goal. Twice.',
    color: '#ff9ec4',
    duration: 7,
    weight: 3,
  },
];

export const itemById = (id) => ITEMS.find((i) => i.id === id) || ITEMS[0];

/**
 * Weighted pick from the stage's pool (ids; every item when none is given),
 * driven by the match's own RNG so both phones agree. Party mode triples
 * multiball's weight — a full court is the whole point.
 */
export function rollItem(rand, party = false, pool = null) {
  // Filtering ITEMS rather than mapping the pool keeps the order fixed
  // whatever order the pool lists its ids in.
  let deck = pool ? ITEMS.filter((i) => pool.includes(i.id)) : ITEMS;
  if (!deck.length) deck = ITEMS;
  const w = (i) => (party && i.id === 'multi' ? i.weight * 3 : i.weight);
  const total = deck.reduce((s, i) => s + w(i), 0);
  let n = rand() * total;
  for (const item of deck) {
    n -= w(item);
    if (n <= 0) return item;
  }
  return deck[deck.length - 1];
}
