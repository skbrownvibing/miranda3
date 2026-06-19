/* Node smoke test for Miranda3 core logic. Run: node test/smoke.js */
var M = require('../core.js');
var Sample = require('../sample-data.js');

var passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
}
function eq(name, a, b) { ok(name + ' (' + a + ' == ' + b + ')', a === b); }

var NOW = Date.parse('2026-05-28T18:00:00Z');
var data = Sample.generateSampleData(NOW);
var convos = data.conversations;
var dismissed = {};

console.log('\nMiranda3 core smoke test\n------------------------');

// Sample shape
ok('sample has conversations', convos.length > 0);
ok('sample is flagged', data.sample === true);

// Eligibility: spam / delivery / groups excluded from personal
var spam = convos.filter(function (c) { return c.id.indexOf('88202') >= 0; })[0];
ok('spam exists in raw data', !!spam);
ok('spam is not personal', !M.isPersonal(spam));
var dd = convos.filter(function (c) { return c.contact_name === 'DoorDash'; })[0];
ok('delivery is not personal', !M.isPersonal(dd));
var group = convos.filter(function (c) { return c.group_name === 'Sunday Roast Crew'; })[0];
ok('small group is not personal (excluded from score)', !M.isPersonal(group));
ok('small group (≤5) IS inbox-eligible', M.inInbox(group));
ok('small group needs response (last msg not from me)', M.needsResponse(group, dismissed));
var bigGroup = convos.filter(function (c) { return c.group_name === 'College Crew 🎓'; })[0];
ok('massive group exists in raw data', !!bigGroup);
ok('massive group (>5) is NOT inbox-eligible', !M.inInbox(bigGroup));
ok('massive group does NOT need response', !M.needsResponse(bigGroup, dismissed));

// needsResponse: only personal + they sent last
var gemma = convos.filter(function (c) { return c.contact_name === 'Gemma Colon'; })[0];
ok('Gemma needs response', M.needsResponse(gemma, dismissed));
var rachel = convos.filter(function (c) { return c.contact_name === 'Rachel Green'; })[0];
ok('Rachel (replied last) does NOT need response', !M.needsResponse(rachel, dismissed));

// Bucketing is cumulative: 1d ⊂ 7d ⊂ 30d ⊂ 90d
var counts = M.bucketCounts(convos, NOW, dismissed);
console.log('  buckets:', JSON.stringify(counts));
ok('counts cumulative 1d<=7d', counts['1d'] <= counts['7d']);
ok('counts cumulative 7d<=30d', counts['7d'] <= counts['30d']);
ok('counts cumulative 30d<=90d', counts['30d'] <= counts['90d']);
// We seeded 8 waiting 1:1 threads + 1 waiting group, all within 90d.
eq('90d bucket has all 9 waiting (8 1:1 + 1 group)', counts['90d'], 9);
// Gemma (5h) + Liz (20h) + Sunday Roast group (3h) are within 1 day.
eq('1d bucket has 3', counts['1d'], 3);

// bucketKeyFor tightest bucket
eq('Gemma tightest bucket', M.bucketKeyFor(gemma, NOW), '1d');
var sam = convos.filter(function (c) { return c.contact_name === 'Sam Okafor'; })[0];
eq('Sam (75d) tightest bucket', M.bucketKeyFor(sam, NOW), '90d');

// Dismiss removes from waiting + bucket count
var d2 = { 'iMessage;-;+12125550111': { at: NOW } }; // dismiss Gemma
eq('1d count drops after dismiss (Liz + group remain)', M.bucketCounts(convos, NOW, d2)['1d'], 2);
ok('dismissed Gemma no longer needs response', !M.needsResponse(gemma, d2));

// Score sanity
var s = M.computeScore(convos, NOW, dismissed);
console.log('  score:', JSON.stringify(s));
ok('score within 0..100', s.score >= 0 && s.score <= 100);
eq('total eligible = 8 waiting + 6 replied + 1 group? (group excluded)', s.total, 14);
eq('hanging = 8', s.hanging, 8);
ok('reply rate is 6/14 ≈ 43%', s.rate === Math.round(6 / 14 * 100));
ok('dismissing all waiting -> score 100', M.computeScore([rachel], NOW, {}).score === 100);

// SMS deep-link
eq('sms href for real phone', M.buildSmsHref('+1 212 555 0111'), 'sms:+12125550111');
ok('sms href null for group label', M.buildSmsHref('Group · 5 people') === null);
ok('sms href null for empty', M.buildSmsHref('') === null);

// Label tiers
eq('low score label', M.scoreLabel(10), 'actively ghosting 👻');
eq('high score label', M.scoreLabel(95), 'ELITE responder 🏆');

console.log('\n------------------------');
console.log(passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
