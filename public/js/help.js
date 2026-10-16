// The HELP button: restart the tour or read short answers for every feature.
import { h, modal } from './util.js';

const FAQ = [
  ['How do I start a game?', 'Tap New Game. Type the two team names, add the player numbers, then pick the six players who start (in serving order) and which team serves first. Tap Start.'],
  ['How do I give a team a point?', 'When a team wins a rally, tap their big colored POINT button. The app changes the score, the server and the rotation for you.'],
  ['What is a "rally"?', 'A rally starts with a serve and ends when the ball hits the floor, goes out, or someone makes a mistake. Whoever wins the rally gets the point.'],
  ['How do I record who did what?', 'Tap what happened (Ace, Kill, Assist, Dig, Block or Error) and then tap the player. You can also tap a player first and pick what they did. You never have to — stats are optional.'],
  ['What are Ace, Kill, Assist, Dig, Block?', 'Ace: a serve nobody can return. Kill: a hit that wins the point. Assist: the pass or set right before a kill. Dig: saving a hard-hit ball. Block: stopping a hit at the net. Error: a mistake that gives the other team a point.'],
  ['I don\'t know which player did it.', 'Tap "Not sure" and the stat is saved without a player — or just skip it. Never guess.'],
  ['Who is serving?', 'The yellow SERVING label on the scoreboard shows the server\'s number and their serving-order number (I to VI). The app moves the order when a team wins the serve back.'],
  ['How do I call a time-out?', 'Tap Time-out under the team that asked for it. Each team gets 2 per set. The app writes it on the scoresheet with the score.'],
  ['How do I substitute a player?', 'Tap Sub under the team. Tap the player who is leaving, then the player coming in. The app warns you if the rules might not allow it.'],
  ['What is a libero?', 'The libero is a defensive specialist in a different color shirt who can swap in for a back-row player. Tap Libero to send them in or out. They leave on their own when the rotation moves them to the front row.'],
  ['I made a mistake!', 'Tap Undo to take back the last thing you entered. Tap Redo to bring it back. To fix something older, tap History and remove it from the list.'],
  ['Where is the scoresheet?', 'Tap VIEW SCORESHEET any time. It shows the real paper form filling itself in. Pinch or use the + and − buttons to zoom.'],
  ['How do I print or share the scoresheet?', 'Open VIEW SCORESHEET and tap DOWNLOAD COMPLETED SCORESHEET. On iPhone and iPad you can then Print, AirDrop, email it, or save it to Files. You can also find every old game under Game Reports.'],
  ['Does it work without WiFi?', 'Yes. Everything is saved on your device as you go. If you signed in, games sync when you are back online.'],
  ['Can I use it on two devices?', 'Sign in on both (tap the sync button at the top). Only one device can score a game at a time, so nobody overwrites anybody. The other device can watch, or tap "Take over".'],
  ['Put it on my home screen', 'iPhone/iPad: tap the Share button in Safari, then "Add to Home Screen". Then it opens like a normal app.'],
];

export function showHelp(ctx) {
  const body = h('div', null,
    h('div', { class: 'row', style: { marginBottom: '12px' } },
      h('button', { class: 'btn primary', onclick: () => { m.close(); ctx.startTour(); } }, 'Restart the quick tour'),
      h('button', { class: 'btn', onclick: () => { m.close(); ctx.go('/'); } }, 'Go to dashboard')),
    h('div', { class: 'helplist' }, FAQ.map(([q, a]) => h('details', null, h('summary', null, q), h('p', null, a)))),
    h('div', { class: 'modal-actions', style: { marginTop: '14px' } }, h('button', { class: 'btn', onclick: () => m.close() }, 'Close')));
  const m = modal(body, { title: 'Help', class: 'wide' });
}
export { FAQ };
