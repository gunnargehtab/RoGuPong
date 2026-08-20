// RoGuPong — the item crates.
//
// A crate drifts through the middle of the court every few seconds. Whoever
// last touched the ball that breaks it gets the pickup, immediately. That
// keeps items as a reward for winning the rally rather than a lottery.

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
];

export const itemById = (id) => ITEMS.find((i) => i.id === id) || ITEMS[0];

/** Weighted pick, driven by the match's own RNG so both phones agree. */
export function rollItem(rand) {
  const total = ITEMS.reduce((s, i) => s + i.weight, 0);
  let n = rand() * total;
  for (const item of ITEMS) {
    n -= item.weight;
    if (n <= 0) return item;
  }
  return ITEMS[ITEMS.length - 1];
}
