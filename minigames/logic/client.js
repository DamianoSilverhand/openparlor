import { h } from '/shared/ui.js';
import { play } from '/shared/sound.js';
import { rng, int, pick, shuffled, timeouts } from '/sdk/minigame.js';

const ODD = {
  easy: [
    { items: ['Apple', 'Banana', 'Carrot', 'Mango'], ans: 'Carrot' },
    { items: ['Dog', 'Cat', 'Eagle', 'Rabbit'], ans: 'Eagle' },
    { items: ['2', '4', '7', '8'], ans: '7' },
    { items: ['Circle', 'Square', 'Triangle', 'Cube'], ans: 'Cube' },
    { items: ['Car', 'Bus', 'Bicycle', 'Boat'], ans: 'Boat' },
    { items: ['Red', 'Blue', 'Green', 'Round'], ans: 'Round' },
    { items: ['Monday', 'Tuesday', 'January', 'Friday'], ans: 'January' },
    { items: ['Spoon', 'Fork', 'Plate', 'Knife'], ans: 'Plate' },
  ],
  medium: [
    { items: ['Triangle', 'Square', 'Pentagon', 'Sphere'], ans: 'Sphere' },
    { items: ['2', '3', '5', '9'], ans: '9' },
    { items: ['Mercury', 'Venus', 'Moon', 'Mars'], ans: 'Moon' },
    { items: ['Noun', 'Verb', 'Adjective', 'Paragraph'], ans: 'Paragraph' },
    { items: ['Centimetre', 'Kilometre', 'Kilogram', 'Metre'], ans: 'Kilogram' },
    { items: ['16', '25', '36', '45'], ans: '45' },
    { items: ['Copper', 'Iron', 'Gold', 'Plastic'], ans: 'Plastic' },
  ],
  hard: [
    { items: ['Oxygen', 'Nitrogen', 'Water', 'Helium'], ans: 'Water' },
    { items: ['2', '11', '23', '27'], ans: '27' },
    { items: ['Metaphor', 'Simile', 'Sonnet', 'Alliteration'], ans: 'Sonnet' },
    { items: ['8', '27', '64', '100'], ans: '100' },
    { items: ['Kinetic', 'Thermal', 'Newton', 'Potential'], ans: 'Newton' },
    { items: ['Democracy', 'Monarchy', 'Geography', 'Oligarchy'], ans: 'Geography' },
  ],
};

const ANALOGY = {
  easy: [
    { q: 'Bird : Nest :: Bee : ?', a: 'Hive', w: ['Tree', 'Flower', 'Wing'] },
    { q: 'Hot : Cold :: Day : ?', a: 'Night', w: ['Sun', 'Warm', 'Light'] },
    { q: 'Puppy : Dog :: Kitten : ?', a: 'Cat', w: ['Mouse', 'Lion', 'Rabbit'] },
    { q: 'Eye : See :: Ear : ?', a: 'Hear', w: ['Touch', 'Smell', 'Speak'] },
    { q: 'Shoe : Foot :: Glove : ?', a: 'Hand', w: ['Head', 'Arm', 'Leg'] },
  ],
  medium: [
    { q: 'Author : Book :: Composer : ?', a: 'Symphony', w: ['Library', 'Poem', 'Canvas'] },
    { q: 'Thermometer : Temperature :: Barometer : ?', a: 'Pressure', w: ['Speed', 'Weight', 'Sound'] },
    { q: 'Triangle : 3 :: Hexagon : ?', a: '6', w: ['5', '7', '8'] },
    { q: 'Herbivore : Plants :: Carnivore : ?', a: 'Meat', w: ['Fruit', 'Water', 'Insects'] },
  ],
  hard: [
    { q: 'Verbose : Concise :: Ephemeral : ?', a: 'Permanent', w: ['Brief', 'Fragile', 'Loud'] },
    { q: 'Hypothesis : Experiment :: Blueprint : ?', a: 'Building', w: ['Theory', 'Guess', 'Map'] },
    { q: 'Mitosis : Cells :: Erosion : ?', a: 'Rock', w: ['Water', 'Gravity', 'Light'] },
  ],
};

const NAMES = ['Maya', 'Leo', 'Sam', 'Zara', 'Toby', 'Nia'];

function makeProblem(r, level) {
  const kind = r();

  // 1. Number sequence
  if (kind < 0.42) {
    let seq, ans;
    if (level === 'easy') {
      const start = int(r, 2, 15);
      const step = pick(r, [2, 3, 4, 5, 10]);
      seq = [0, 1, 2, 3].map((i) => start + i * step);
      ans = start + 4 * step;
    } else if (level === 'medium') {
      if (r() < 0.5) {
        const a = int(r, 2, 5), m = pick(r, [2, 3]);
        seq = [a, a * m, a * m * m, a * m * m * m];
        ans = a * m * m * m * m;
      } else {
        const a = int(r, 1, 5), b = int(r, 2, 6);
        seq = [a, b, a + b, a + 2 * b];
        ans = 2 * a + 3 * b;
      }
    } else {
      // Second-difference quadratic: +d, +(d+k), +(d+2k)...
      const start = int(r, 1, 8), d = int(r, 2, 5), k = int(r, 2, 4);
      seq = [start];
      for (let i = 0; i < 3; i++) seq.push(seq[i] + d + i * k);
      ans = seq[3] + d + 3 * k;
    }
    const opts = new Set([ans]);
    while (opts.size < 4) {
      const cand = ans + int(r, 1, 6) * (r() < 0.5 ? -1 : 1);
      if (cand > 0) opts.add(cand);
    }
    return {
      q: `What comes next?\n${seq.join(', ')}, ?`,
      options: shuffled(r, [...opts].map(String)),
      answer: String(ans),
    };
  }

  // 2. Odd one out
  if (kind < 0.7) {
    const item = pick(r, ODD[level] || ODD.easy);
    return {
      q: 'Which one is the odd one out?',
      options: shuffled(r, item.items),
      answer: item.ans,
    };
  }

  // 3. Ordering deduction
  if (kind < 0.86) {
    const [a, b, c] = shuffled(r, NAMES).slice(0, 3);
    const askTallest = r() < 0.5;
    return {
      q: `${a} is taller than ${b}. ${c} is taller than ${a}. Who is ${askTallest ? 'tallest' : 'shortest'}?`,
      options: shuffled(r, [a, b, c, 'Cannot tell']),
      answer: askTallest ? c : b,
    };
  }

  // 4. Analogy
  const an = pick(r, ANALOGY[level] || ANALOGY.easy);
  return {
    q: an.q,
    options: shuffled(r, [an.a, ...an.w]),
    answer: an.a,
  };
}

export function start(ctx) {
  const r = rng(ctx.seed);
  const level = ['easy', 'medium', 'hard'].includes(ctx.level) ? ctx.level : 'hard';
  const t = timeouts();
  let correct = 0;
  let wrong = 0;
  let streak = 0;
  let totalScore = 0;
  let locked = false;
  let cur = null;

  const info = h('div', { class: 'mg-info' });
  const qEl = h('div', { class: 'lg-q' });
  const grid = h('div', { class: 'nd-grid' });
  ctx.root.replaceChildren(info, h('div', { class: 'card nd-card' }, qEl), grid);

  const score = () => Math.max(0, totalScore);

  function next() {
    cur = makeProblem(r, level);
    qEl.textContent = cur.q;
    info.textContent = `Right ${correct}  ·  Wrong ${wrong}${streak >= 2 ? `  ·  🔥 ${streak}` : ''}`;
    grid.replaceChildren(
      ...cur.options.map((opt) =>
        h('button', {
          class: 'nd-btn lg-btn',
          'data-quiet': '',
          onpointerdown: (e) => {
            e.preventDefault();
            choose(opt);
          },
        }, opt),
      ),
    );
  }

  function choose(opt) {
    if (locked) return;
    if (opt === cur.answer) {
      correct++;
      streak++;
      totalScore += 100 + Math.min(4, streak - 1) * 20;
      play('good');
      ctx.progress(score());
      next();
    } else {
      wrong++;
      streak = 0;
      totalScore = Math.max(0, totalScore - 35);
      locked = true;
      play('bad');
      qEl.classList.add('bad');
      ctx.progress(score());
      t.set(() => {
        qEl.classList.remove('bad');
        locked = false;
        next();
      }, 450);
    }
  }

  next();
  return { score, destroy: () => t.clearAll() };
}
