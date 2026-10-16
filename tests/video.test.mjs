import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYouTube, shareText } from '../public/js/video.js';

test('channel forms all become the channel live link', () => {
  for (const [input, url] of [
    ['@RockyMountainVBC', 'https://www.youtube.com/@RockyMountainVBC/live'],
    ['youtube.com/@RockyMountainVBC', 'https://www.youtube.com/@RockyMountainVBC/live'],
    ['https://www.youtube.com/@RockyMountainVBC/videos', 'https://www.youtube.com/@RockyMountainVBC/live'],
    ['https://m.youtube.com/channel/UCabc_123-x', 'https://www.youtube.com/channel/UCabc_123-x/live'],
    ['https://www.youtube.com/c/MyTeam', 'https://www.youtube.com/c/MyTeam/live'],
  ]) { const r = parseYouTube(input); assert.equal(r.ok, true, input); assert.equal(r.kind, 'channel'); assert.equal(r.url, url); }
});
test('single-video links are recognised', () => {
  for (const input of ['https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/live/dQw4w9WgXcQ?si=x']) {
    const r = parseYouTube(input); assert.equal(r.kind, 'video', input); assert.equal(r.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  }
});
test('non-YouTube and junk input is rejected', () => {
  for (const input of ['', '   ', 'hello there', 'https://evil.com/@RockyMountainVBC', 'https://youtube.com.evil.com/@x', 'https://www.youtube.com/', '@ab']) assert.equal(parseYouTube(input).ok, false, input);
});
test('share text names the game when known', () => {
  assert.equal(shareText({ home: { name: 'Lions' }, away: { name: 'Bears' } }), 'Watch Lions vs Bears live:');
  assert.equal(shareText(null), 'Watch our game live:');
});
