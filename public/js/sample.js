// Sample teams for the practice game / tour. Nothing here is ever saved as a real game.
import { cmd } from './engine/engine.js';

const names = (arr) => arr.map(([n, name, libero], i) => ({ id: 'p' + i, number: String(n), name, libero: !!libero }));
export function sampleSetup(date) {
  const home = { name: 'Practice Panthers', players: names([[1, 'Maya'], [4, 'Zoe'], [7, 'Ava'], [9, 'Lily'], [10, 'Emma'], [12, 'Chloe'], [14, 'Grace'], [15, 'Ella'], [3, 'Nora', true]]) };
  const away = { name: 'Practice Hawks', players: names([[2, 'Ivy'], [5, 'Ruby'], [6, 'Mia'], [8, 'Lucy'], [11, 'Hana'], [13, 'Jade'], [16, 'Nia'], [17, 'Rose'], [20, 'Tess', true]]) };
  return { date, site: 'Practice Gym', home, away, rules: {} };
}
export function sampleLineup(setup, side) {
  const pl = setup[side].players;
  return { order: pl.filter((p) => !p.libero).slice(0, 6).map((p) => p.id), libero: (pl.find((p) => p.libero) || {}).id || null, captain: null };
}
export function sampleSetStart(setup, first = 'home') {
  return cmd.setStart(sampleLineup(setup, 'home'), sampleLineup(setup, 'away'), first);
}
