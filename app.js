/* Miranda3 app — DOM glue around core.js. Vanilla JS, no build step. */
(function () {
  'use strict';
  var M = window.Miranda;

  var LS_DATA = 'miranda3.data';
  var LS_DISMISSED = 'miranda3.dismissed';
  var LS_THEME = 'miranda3.theme';
  var LS_HISTORY = 'miranda3.history';

  var S = {
    conversations: [],
    exportedAt: null,
    bucket: '1d',
    dismissed: load(LS_DISMISSED) || {},
    showingDismissed: false
  };

  function load(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }
  function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
  function $(id) { return document.getElementById(id); }

  // ── Boot ───────────────────────────────────────────────────────────────────
  function init() {
    if (load(LS_THEME) === 'dark') document.documentElement.setAttribute('data-theme', 'dark');

    wireStart();
    wireDash();

    var saved = load(LS_DATA);
    if (saved && saved.conversations) {
      adopt(saved);
    }
  }

  function wireStart() {
    var dz = $('dropzone');
    $('pickFile').onclick = function () { $('fileInput').click(); };
    $('fileInput').onchange = function (e) {
      var f = e.target.files[0];
      if (f) readFile(f);
    };
    $('loadSample').onclick = function () {
      adopt(window.MirandaSample.generateSampleData(Date.now()));
    };
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('dragover'); });
    });
    dz.addEventListener('drop', function (e) {
      var f = e.dataTransfer.files[0];
      if (f) readFile(f);
    });
  }

  function readFile(file) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var data = JSON.parse(r.result);
        if (!data || !Array.isArray(data.conversations)) throw new Error('no conversations array');
        adopt(data);
      } catch (err) {
        alert('Could not read that file — expected a miranda3_messages.json export.\n\n' + err.message);
      }
    };
    r.readAsText(file);
  }

  function adopt(data) {
    S.conversations = data.conversations || [];
    S.exportedAt = data.exported_at || null;
    S.isSample = !!data.sample;
    save(LS_DATA, data);
    $('start').hidden = true;
    $('dash').hidden = false;
    recordHistory();
    render();
  }

  // ── Dashboard wiring ────────────────────────────────────────────────────────
  function wireDash() {
    $('darkToggle').onclick = function () {
      var dark = document.documentElement.getAttribute('data-theme') === 'dark';
      if (dark) { document.documentElement.removeAttribute('data-theme'); save(LS_THEME, 'light'); }
      else { document.documentElement.setAttribute('data-theme', 'dark'); save(LS_THEME, 'dark'); }
    };
    $('reload').onclick = function () {
      $('dash').hidden = true;
      $('start').hidden = false;
    };
    $('filters').addEventListener('click', function (e) {
      var btn = e.target.closest('.chip');
      if (!btn) return;
      S.bucket = btn.getAttribute('data-bucket');
      S.showingDismissed = false;
      [].forEach.call(document.querySelectorAll('.chip'), function (c) { c.classList.remove('active'); });
      btn.classList.add('active');
      renderThreads();
    });
    $('showDismissed').onclick = function () {
      S.showingDismissed = !S.showingDismissed;
      renderThreads();
    };
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  function render() {
    renderScore();
    renderFilters();
    renderThreads();
    if (S.exportedAt) {
      $('updated').textContent = 'Updated ' + M.relTime(S.exportedAt, Date.now()) +
        (S.isSample ? ' · sample data' : ' ago');
    } else {
      $('updated').textContent = S.isSample ? 'sample data' : '';
    }
  }

  function renderScore() {
    var now = Date.now();
    var s = M.computeScore(S.conversations, now, S.dismissed);

    $('scoreNum').textContent = s.score;
    $('scoreNum').style.color = M.scoreColorVar(s.score);
    $('scoreLabel').textContent = M.scoreLabel(s.score);

    var circ = 540;
    $('ringFill').style.strokeDashoffset = circ - (circ * s.score / 100);

    $('statRate').textContent = s.rate + '%';
    $('barRate').style.width = s.rate + '%';

    $('statWait').textContent = s.hanging ? M.fmtSpeed(s.speed) : '0h';
    $('barWait').style.width = Math.min(100, (s.speed / 72) * 100) + '%';

    $('statHang').textContent = s.hanging;
    $('barHang').style.width = Math.min(100, s.hanging * 9) + '%';
  }

  function renderFilters() {
    var counts = M.bucketCounts(S.conversations, Date.now(), S.dismissed);
    [].forEach.call(document.querySelectorAll('.chip'), function (chip) {
      var k = chip.getAttribute('data-bucket');
      chip.querySelector('em').textContent = counts[k] != null ? '(' + counts[k] + ')' : '';
    });
    var total = counts['90d'] || 0;
    $('actionSub').textContent = total + (total === 1 ? ' person' : ' people') + ' waiting on you';
  }

  function renderThreads() {
    var now = Date.now();
    var box = $('threads');
    box.innerHTML = '';

    var list;
    if (S.showingDismissed) {
      list = S.conversations.filter(function (c) { return S.dismissed[c.id]; });
    } else {
      list = M.waitingInBucket(S.conversations, S.bucket, now, S.dismissed);
    }

    var dismissedCount = Object.keys(S.dismissed).filter(function (id) {
      return S.conversations.some(function (c) { return c.id === id; });
    }).length;
    $('showDismissed').textContent = S.showingDismissed
      ? '← back to action list'
      : (dismissedCount ? 'view dismissed (' + dismissedCount + ')' : '');
    $('showDismissed').style.visibility = (dismissedCount || S.showingDismissed) ? 'visible' : 'hidden';

    if (!list.length) {
      $('emptyState').hidden = false;
      $('emptyState').textContent = S.showingDismissed
        ? 'Nothing dismissed.'
        : '🎉 Nobody’s waiting on you in this window. Inbox zero vibes.';
      return;
    }
    $('emptyState').hidden = true;

    list.forEach(function (c) { box.appendChild(threadEl(c, now)); });
  }

  function threadEl(c, now) {
    var el = document.createElement('div');
    el.className = 'thread';

    var hrs = M.waitHours(c, now);
    var color = hrs < 24 ? 'var(--yellow)' : hrs < 72 ? 'var(--orange)' : 'var(--red)';
    var preview = escapeHtml(c.last_message_text || '');
    var sender = c.is_group ? '' : 'Them: ';

    var groupTag = c.is_group
      ? ' <span class="group-tag">group' + (c.participant_count ? ' · ' + c.participant_count : '') + '</span>'
      : '';

    el.innerHTML =
      '<div class="avatar">' + escapeHtml(M.initial(c)) + '</div>' +
      '<div class="thread-main">' +
        '<div class="thread-top">' +
          '<span class="thread-name">' + escapeHtml(M.displayName(c)) + groupTag + '</span>' +
          '<span class="thread-when">' + escapeHtml(M.relTime(c.last_message_at, now)) +
            '<span class="dot" style="background:' + color + '"></span></span>' +
        '</div>' +
        '<div class="thread-preview"><b>' + sender + '</b>' + preview + '</div>' +
      '</div>';

    var actions = document.createElement('div');
    actions.className = 'thread-actions';

    if (!S.showingDismissed) {
      var dismiss = document.createElement('button');
      dismiss.className = 'dismiss-btn';
      dismiss.title = 'Dismiss — I don’t owe a reply';
      dismiss.textContent = '✕';
      dismiss.onclick = function () {
        S.dismissed[c.id] = { at: Date.now(), inbound: c.latest_inbound_at || c.last_message_at };
        save(LS_DISMISSED, S.dismissed);
        render();
      };
      actions.appendChild(dismiss);
    } else {
      var restore = document.createElement('button');
      restore.className = 'dismiss-btn';
      restore.textContent = 'restore';
      restore.onclick = function () {
        delete S.dismissed[c.id];
        save(LS_DISMISSED, S.dismissed);
        render();
      };
      actions.appendChild(restore);
    }

    // Groups have no single sms: target (the export's phone is just one member),
    // so don't deep-link them — send the user to Messages to pick the thread.
    var href = c.is_group ? null : M.buildSmsHref(c.phone);
    var go = document.createElement('a');
    go.className = 'go-btn';
    go.textContent = 'Go to iMessage →';
    if (href) { go.href = href; }
    else {
      go.href = '#';
      go.title = 'Open Messages and pick this thread';
      go.onclick = function (e) {
        e.preventDefault();
        alert(c.is_group
          ? 'Group chat — open Messages and pick “' + M.displayName(c) + '”.'
          : 'No phone/handle on this thread (group or short code).');
      };
    }
    actions.appendChild(go);

    el.appendChild(actions);
    return el;
  }

  // One score snapshot per day (last 90 kept) — backs a future trend view.
  function recordHistory() {
    var hist = load(LS_HISTORY) || [];
    var s = M.computeScore(S.conversations, Date.now(), S.dismissed);
    var day = new Date().toISOString().slice(0, 10);
    var idx = hist.findIndex(function (h) { return h.date === day; });
    var entry = { date: day, score: s.score, rate: s.rate, hanging: s.hanging };
    if (idx >= 0) hist[idx] = entry; else hist.push(entry);
    if (hist.length > 90) hist = hist.slice(-90);
    save(LS_HISTORY, hist);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
