/*
 * Miranda3 core logic — pure functions, no DOM.
 *
 * Shared by the browser app (app.js) and the Node smoke test (test/smoke.js).
 * Everything here operates on the conversation objects produced by
 * export.command and is deterministic given a `now` timestamp, so it can be
 * unit-tested without a browser or a real chat.db.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Miranda = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var HOUR = 3600000;
  var DAY = 86400000;

  // Time buckets the user asked for: unanswered texts in the last 1 / 7 / 30 / 90 days.
  // `maxDays` is the upper bound (inclusive) on how long a thread has been waiting.
  var BUCKETS = [
    { key: '1d', label: '1 day', maxDays: 1 },
    { key: '7d', label: '7 days', maxDays: 7 },
    { key: '30d', label: '30 days', maxDays: 30 },
    { key: '90d', label: '90 days', maxDays: 90 }
  ];

  function getCategory(c) {
    // A manual override (set in the UI) always wins.
    if (c.override) return c.override;
    return c.category || 'uncategorized';
  }

  // Hours since the conversation's last message. Used everywhere for "how long
  // have they been waiting on me".
  function waitHours(c, now) {
    if (!c.last_message_at) return 0;
    return (now - new Date(c.last_message_at).getTime()) / HOUR;
  }

  function waitDays(c, now) {
    return waitHours(c, now) / 24;
  }

  // 1:1, personal, not spam/delivery. This backs the responsiveness *score*,
  // which is deliberately 1:1-only — group dynamics don't imply a personal
  // reply obligation, so folding them in would distort the score.
  function isPersonal(c) {
    if (c.is_group) return false;
    var cat = getCategory(c);
    return cat !== 'spam' && cat !== 'delivery';
  }

  // Largest group (people, including you) that still counts as a real reply
  // obligation. Bigger group chats are noise, not an inbox.
  var MAX_GROUP_PEOPLE = 5;

  // Inbox eligibility for the "waiting on you" list. Same as isPersonal but
  // ALSO includes small group chats (≤ MAX_GROUP_PEOPLE; still excludes
  // spam/delivery). The list shows these groups; the score (isPersonal) doesn't.
  // Exports without participant_count keep showing (we can't size them).
  function inInbox(c) {
    var cat = getCategory(c);
    if (cat === 'spam' || cat === 'delivery') return false;
    if (c.is_group && typeof c.participant_count === 'number' &&
        c.participant_count > MAX_GROUP_PEOPLE) return false;
    return true;
  }

  // "Waiting on you": inbox-eligible (1:1 or group), they sent the last
  // substantive message, and you have not dismissed it.
  function needsResponse(c, dismissed) {
    if (!inInbox(c)) return false;
    if (c.i_replied_last) return false;
    if (dismissed && dismissed[c.id]) return false;
    return true;
  }

  // Which time bucket a waiting conversation falls into. Buckets are cumulative
  // windows (1d ⊂ 7d ⊂ 30d ⊂ 90d); `bucketKeyFor` returns the *tightest* one.
  function bucketKeyFor(c, now) {
    var d = waitDays(c, now);
    for (var i = 0; i < BUCKETS.length; i++) {
      if (d <= BUCKETS[i].maxDays) return BUCKETS[i].key;
    }
    return null; // older than 90 days — outside the tracked window
  }

  // Conversations waiting on you within a given bucket window (cumulative).
  // bucketKey null/'all' => everything up to 90 days.
  function waitingInBucket(conversations, bucketKey, now, dismissed) {
    var maxDays = 90;
    if (bucketKey && bucketKey !== 'all') {
      var b = BUCKETS.filter(function (x) { return x.key === bucketKey; })[0];
      if (b) maxDays = b.maxDays;
    }
    return conversations
      .filter(function (c) { return needsResponse(c, dismissed); })
      .filter(function (c) { return waitDays(c, now) <= maxDays; })
      .sort(function (a, b) { return waitHours(b, now) - waitHours(a, now); });
  }

  // Count of waiting threads in each cumulative bucket.
  function bucketCounts(conversations, now, dismissed) {
    var out = {};
    BUCKETS.forEach(function (b) {
      out[b.key] = waitingInBucket(conversations, b.key, now, dismissed).length;
    });
    return out;
  }

  // ── Score ────────────────────────────────────────────────────────────────
  // 0–100 responsiveness over the eligible personal set.
  //   reply rate   45%  — share of threads where you got the last word
  //   reply speed  25%  — penalize slow average response on open threads
  //   hanging      30%  — penalize open threads, older ones weigh more
  function computeScore(conversations, now, dismissed) {
    var personal = conversations.filter(isPersonal);
    if (!personal.length) {
      return { score: 100, rate: 100, speed: 0, speedScore: 100, hanging: 0, hangingScore: 100, replied: 0, total: 0 };
    }
    var replied = personal.filter(function (c) { return c.i_replied_last || (dismissed && dismissed[c.id]); });
    var unreplied = personal.filter(function (c) { return !c.i_replied_last && !(dismissed && dismissed[c.id]); });
    var total = personal.length;
    var rate = Math.round((replied.length / total) * 100);

    var avgWait = 0;
    if (unreplied.length) {
      avgWait = unreplied.reduce(function (s, c) {
        if (!c.last_message_at) return s;
        return s + waitHours(c, now);
      }, 0) / unreplied.length;
    }
    var speedScore = 100;
    if (avgWait > 1) speedScore = Math.max(0, Math.round(100 - (avgWait / 72) * 100));

    var hp = 0;
    unreplied.forEach(function (c) {
      if (!c.last_message_at) return;
      var h = waitHours(c, now);
      if (h < 1) hp += 1; else if (h < 24) hp += 3; else if (h < 72) hp += 6; else hp += 10;
    });
    var hangingScore = Math.max(0, 100 - hp);

    var score = Math.round(rate * 0.45 + speedScore * 0.25 + hangingScore * 0.30);
    return {
      score: Math.max(0, Math.min(100, score)),
      rate: rate,
      speed: avgWait,
      speedScore: speedScore,
      hanging: unreplied.length,
      hangingScore: hangingScore,
      replied: replied.length,
      total: total
    };
  }

  function scoreLabel(score) {
    if (score <= 15) return 'actively ghosting 👻';
    if (score <= 35) return 'bad texter 😬';
    if (score <= 55) return 'hit or miss 🎲';
    if (score <= 75) return 'solid 👍';
    if (score <= 90) return 'on it ⚡️';
    return 'ELITE responder 🏆';
  }

  function scoreColorVar(s) {
    if (s >= 85) return 'var(--green)';
    if (s >= 65) return 'var(--yellow)';
    if (s >= 40) return 'var(--orange)';
    return 'var(--red)';
  }

  // ── Display helpers ────────────────────────────────────────────────────────
  function displayName(c) {
    if (c.is_group && c.group_name && c.group_name.trim()) return c.group_name.trim();
    return c.contact_name || c.phone || 'Unknown';
  }

  function initial(c) {
    var n = displayName(c).trim();
    return n ? n[0].toUpperCase() : '?';
  }

  function relTime(d, now) {
    if (!d) return '';
    var ms = now - new Date(d).getTime();
    var m = Math.floor(ms / 60000), h = Math.floor(ms / HOUR), dy = Math.floor(ms / DAY);
    if (m < 1) return 'now';
    if (m < 60) return m + 'm';
    if (h < 24) return h + 'h';
    if (dy < 7) return dy + 'd';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function fmtSpeed(h) {
    if (h < 1) return '<1h';
    if (h < 48) return Math.round(h) + 'h';
    return Math.round(h / 24) + 'd';
  }

  // Builds the `sms:` URL macOS hands to Messages.app, opening that thread.
  function buildSmsHref(phone) {
    var clean = String(phone || '').replace(/\s/g, '');
    if (!clean) return null;
    // Only follow if it looks like a real number (avoid synthetic group labels).
    if (!/^\+?\d+$/.test(clean)) return null;
    return 'sms:' + clean;
  }

  return {
    BUCKETS: BUCKETS,
    HOUR: HOUR,
    DAY: DAY,
    getCategory: getCategory,
    waitHours: waitHours,
    waitDays: waitDays,
    isPersonal: isPersonal,
    inInbox: inInbox,
    MAX_GROUP_PEOPLE: MAX_GROUP_PEOPLE,
    needsResponse: needsResponse,
    bucketKeyFor: bucketKeyFor,
    waitingInBucket: waitingInBucket,
    bucketCounts: bucketCounts,
    computeScore: computeScore,
    scoreLabel: scoreLabel,
    scoreColorVar: scoreColorVar,
    displayName: displayName,
    initial: initial,
    relTime: relTime,
    fmtSpeed: fmtSpeed,
    buildSmsHref: buildSmsHref
  };
});
