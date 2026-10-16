import { cmd } from '../public/js/engine/engine.js';

export function mkTeam(prefix, name, nums, liberoNum) {
  const players = nums.map((n, i) => ({ id: `${prefix}${i + 1}`, number: String(n), name: `${name[0]}${n}`, libero: false }));
  if (liberoNum) players.push({ id: `${prefix}L`, number: String(liberoNum), name: `${name[0]}Libero`, libero: true });
  return { name, players };
}

export function mkSetup(over = {}) {
  return {
    date: '2026-10-16', site: 'Main Gym',
    home: mkTeam('h', 'Wolves', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 13),
    away: mkTeam('a', 'Hawks', [21, 22, 23, 24, 25, 26, 27, 28, 29, 30], 31),
    rules: {},
    ...over,
  };
}
export const lineup = (p, libero = true) => ({ order: [`${p}1`, `${p}2`, `${p}3`, `${p}4`, `${p}5`, `${p}6`], libero: libero ? `${p}L` : null });
export const startSet = (first = 'home') => cmd.setStart(lineup('h'), lineup('a'), first);
