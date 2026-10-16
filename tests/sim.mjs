// Simulates a realistic 4-set match and returns {setup, events}. Used by tests and by the dev scripts.
import { cmd, buildState, other, courtOf } from '../public/js/engine/engine.js';
import { mkSetup, startSet, lineup } from './helpers.mjs';

export function simulateMatch(seed = 7, opts = {}) {
  let r = seed;
  const rnd = () => { r = (r * 1664525 + 1013904223) % 4294967296; return r / 4294967296; };
  const setup = mkSetup({ startTime: undefined, ...(opts.setup || {}) });
  const events = [];
  const S = () => buildState(setup, events);
  const plan = opts.plan || [['home', 25, 19], ['away', 25, 22], ['home', 27, 25], ['home', 25, 17]];
  let first = 'home';
  plan.forEach(([winner, w, l], si) => {
    events.push(cmd.setStart(lineup('h'), lineup('a'), first));
    first = other(first);
    let hs = 0, as = 0; // target scores
    const target = { home: winner === 'home' ? w : l, away: winner === 'away' ? w : l };
    let n = 0;
    while (hs < target.home || as < target.away) {
      const st = S();
      const set = st.cur;
      // choose winner of rally proportional to the remaining points needed (keeps the score close)
      let team;
      if (hs >= target.home) team = 'away';
      else if (as >= target.away) team = 'home';
      else team = rnd() < (target.home - hs) / ((target.home - hs) + (target.away - as)) ? 'home' : 'away';
      const ends = (nh, na) => Math.max(nh, na) >= 25 && Math.abs(nh - na) >= 2;
      const remaining = (nh, na) => (target.home - nh) + (target.away - na);
      if (team === 'home' && ends(hs + 1, as) && remaining(hs + 1, as) > 0) team = 'away';
      else if (team === 'away' && ends(hs, as + 1) && remaining(hs, as + 1) > 0) team = 'home';
      // random extras
      if (n === 3 && si === 0) events.push(cmd.timeout('away'));
      if (n === 6 && si === 0) { const ct = courtOf(set, 'home').find((c) => c.pos === 5); events.push(cmd.libero('home', 'in', ct.idx)); }
      if (n === 9 && si === 0) { events.push(cmd.sub('away', 'a3', 'a7')); }
      if (n === 14 && si === 1) events.push(cmd.timeout('home'));
      if (n === 11 && si === 0) { events.push(cmd.replay('R')); }
      const kinds = rnd();
      const court = (sd) => set[sd].cur;
      const before = events.length;
      const pt = cmd.point(team);
      if (kinds < 0.25 && set.serving === team) {
        events.push(cmd.stat(team, 'ace', set[team].cur[set[team].srv]));
      } else if (kinds < 0.55) {
        const killer = court(team)[Math.floor(rnd() * 6)];
        events.push(cmd.stat(team, 'kill', killer));
        events.push(cmd.stat(team, 'assist', court(team)[Math.floor(rnd() * 6)]));
      } else if (kinds < 0.65) {
        events.push(cmd.stat(team, 'block', court(team)[Math.floor(rnd() * 6)]));
      } else if (kinds < 0.85) {
        events.push(cmd.stat(other(team), 'err_attack', court(other(team))[Math.floor(rnd() * 6)]));
      }
      if (rnd() < 0.4) events.push(cmd.stat(other(team), 'dig', court(other(team))[Math.floor(rnd() * 6)]));
      events.push(pt);
      if (team === 'home') hs++; else as++;
      n++;
      void before;
    }
  });
  return { setup, events, state: buildState(setup, events) };
}
