// RoGuPong — the roster.
//
// Six fighters, each with one signature move and a different paddle feel.
// Nobody is strictly better than anybody else: the wide paddles are slow, the
// fast paddles are small, and every special trades a full meter for a
// different kind of advantage.

export const CHARACTERS = [
  {
    id: 'ro',
    name: 'RO',
    title: 'The Crimson Comet',
    blurb: 'All-rounder. Hits hard, moves quick, forgives nothing.',
    paddle: 1.00,      // paddle width multiplier
    speed: 1.05,       // paddle travel speed multiplier
    meterRate: 1.00,   // how fast the special meter fills
    color: '#ff4d3d',
    color2: '#ffd166',
    trail: '#ff7a3d',
    special: {
      id: 'afterburn',
      name: 'AFTERBURN',
      desc: 'Your next return leaves at nearly double speed, trailing fire.',
      duration: 6.0,
    },
  },
  {
    id: 'gu',
    name: 'GU',
    title: 'The Azure Bulwark',
    blurb: 'A wall with opinions. Wide paddle, patient game.',
    paddle: 1.35,
    speed: 0.85,
    meterRate: 1.10,
    color: '#3da5ff',
    color2: '#9df3ff',
    trail: '#5fd9ff',
    special: {
      id: 'aegis',
      name: 'AEGIS',
      desc: 'A barrier guards your goal. It saves one ball, then shatters.',
      duration: 6.0,
    },
  },
  {
    id: 'neo',
    name: 'NEO',
    title: 'The Neon Trickster',
    blurb: 'Small paddle, fastest hands, deeply unfair angles.',
    paddle: 0.80,
    speed: 1.28,
    meterRate: 1.05,
    color: '#ff56d0',
    color2: '#b98cff',
    trail: '#ff8ae2',
    special: {
      id: 'curve',
      name: 'CURVE',
      desc: 'Bends the ball through the air for three full seconds.',
      duration: 3.0,
    },
  },
  {
    id: 'brio',
    name: 'BRIO',
    title: 'The Bronze Bruiser',
    blurb: 'Runs on espresso. Shoves the whole table when annoyed.',
    paddle: 1.12,
    speed: 0.95,
    meterRate: 0.95,
    color: '#ffb02e',
    color2: '#ffe9a8',
    trail: '#ff8c1a',
    special: {
      id: 'quake',
      name: 'QUAKE',
      desc: 'A shockwave slams every ball back and bogs down your rival.',
      duration: 2.5,
    },
  },
  {
    id: 'mag',
    name: 'MAG',
    title: 'The Junkyard Magnet',
    blurb: 'Patient scavenger. Catches what you throw and throws it back harder.',
    paddle: 1.05,
    speed: 0.92,
    meterRate: 1.00,
    color: '#3ddc84',
    color2: '#b8ffd9',
    trail: '#4be08c',
    special: {
      id: 'magnet',
      name: 'MAGNET',
      desc: 'Your paddle catches the next ball. Slide to aim, then it flings back fast.',
      duration: 5.0,     // how long the paddle stays magnetic waiting for a ball
    },
  },
  {
    id: 'boo',
    name: 'BOO',
    title: 'The Friendly Phantom',
    blurb: 'Mostly transparent, entirely rude. Small paddle, spooky hands.',
    paddle: 0.85,
    speed: 1.18,
    meterRate: 1.05,
    color: '#9b7bff',
    color2: '#e0d4ff',
    trail: '#c9a2ff',
    special: {
      id: 'phantom',
      name: 'PHANTOM',
      desc: 'Your next return turns the ball into a ghost for three whole seconds.',
      duration: 6.0,     // arming window, like AFTERBURN
    },
  },
];

export const byId = (id) => CHARACTERS.find((c) => c.id === id) || CHARACTERS[0];
