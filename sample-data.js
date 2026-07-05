/*
 * Miranda3 sample data generator.
 *
 * Produces a realistic export-shaped payload with conversations spread across
 * the 1 / 7 / 30 / 90-day buckets, plus replied threads and noise (spam,
 * delivery, group) so the score and filters are meaningful. Dates are relative
 * to "now" so the demo never goes stale.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MirandaSample = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function generateSampleData(now) {
    now = now || Date.now();
    var iso = function (msAgo) { return new Date(now - msAgo).toISOString(); };
    var H = 3600000, D = 86400000;

    // [name, phone, hoursWaiting, lastText, repliedLast, extraMsgs]
    var waiting = [
      ['Gemma Colon', '+12125550111', 5 * H, 'Omg thank you! I miss you too are you back in nyc?!', false],
      ['Liz Chen', '+12125550112', 20 * H, 'lmk if you’re free this week, would love to catch up', false],
      ['Gayatri Rao', '+12125550113', 6 * D, 'Hi Sarah! How are you doing? Would love to chat in the coming days, was thinking of grabbing coffee', false],
      ['Marcus Webb', '+12125550114', 4 * D, 'did you ever hear back about the thing? no rush', false],
      ['Dad', '+12125550115', 12 * D, 'call your mother. and me. but mostly her.', false],
      ['Priya Nair', '+12125550116', 22 * D, 'sending you that doc — let me know your thoughts whenever', false],
      ['Jordan Diaz', '+12125550117', 40 * D, 'hey! random but are you still doing the pottery class?', false],
      ['Sam Okafor', '+12125550118', 75 * D, 'happy belated! we should really catch up soon', false]
    ];

    // [name, phone, hoursAgo, lastTextFromMe]
    var replied = [
      ['Rachel Green', '+12125550201', 5 * H, 'Always.'],
      ['Blair Waldorf', '+12125550202', 30 * H, 'I can do one.'],
      ['Joey Tribbiani', '+12125550203', 3 * D, 'How many sandwiches are we talking?'],
      ['Elaine Benes', '+12125550204', 9 * D, 'Also I support the anti-dancing stance.'],
      ['Rory Gilmore', '+12125550205', 20 * D, 'Honestly proud of you.'],
      ['Ron Swanson', '+12125550206', 55 * D, 'Sending now.']
    ];

    var conversations = [];

    waiting.forEach(function (w, i) {
      var name = w[0], phone = w[1], hoursWait = w[2], text = w[3];
      conversations.push({
        id: 'iMessage;-;' + phone,
        contact_name: name,
        phone: phone,
        is_group: false,
        group_name: null,
        category: 'personal',
        last_message_at: iso(hoursWait),
        last_message_text: text,
        i_replied_last: false,
        latest_inbound_at: iso(hoursWait),
        message_count_30d: 8 + i,
        messages: [
          { text: 'hey! it’s been a minute', from_me: false, date: iso(hoursWait + 2 * H) },
          { text: text, from_me: false, date: iso(hoursWait) }
        ]
      });
    });

    replied.forEach(function (r, i) {
      var name = r[0], phone = r[1], ago = r[2], text = r[3];
      conversations.push({
        id: 'iMessage;-;' + phone,
        contact_name: name,
        phone: phone,
        is_group: false,
        group_name: null,
        category: 'personal',
        last_message_at: iso(ago),
        last_message_text: text,
        i_replied_last: true,
        latest_inbound_at: iso(ago + H),
        message_count_30d: 4 + i,
        messages: [
          { text: 'thanks for the other day!', from_me: false, date: iso(ago + H) },
          { text: text, from_me: true, date: iso(ago) }
        ]
      });
    });

    // Noise — spam/delivery are excluded from the inbox and the score. The
    // group chat below shows in the inbox (waiting list) but not the score.
    conversations.push({
      id: 'iMessage;-;88202', contact_name: null, phone: '88202', is_group: false, group_name: null,
      category: 'spam', last_message_at: iso(4 * H), latest_inbound_at: iso(4 * H), i_replied_last: false,
      last_message_text: 'Your verification code is 884201. Do not share this code.', message_count_30d: 1,
      messages: [{ text: 'Your verification code is 884201. Do not share this code.', from_me: false, date: iso(4 * H) }]
    });
    conversations.push({
      id: 'iMessage;-;DoorDash', contact_name: 'DoorDash', phone: '305-DASH', is_group: false, group_name: null,
      category: 'delivery', last_message_at: iso(2 * H), latest_inbound_at: iso(2 * H), i_replied_last: false,
      last_message_text: 'Your DoorDash order is 4 minutes away.', message_count_30d: 1,
      messages: [{ text: 'Your DoorDash order is 4 minutes away.', from_me: false, date: iso(2 * H) }]
    });
    conversations.push({
      id: 'iMessage;chat;sundayroast', contact_name: null, phone: 'Group · 5 people', is_group: true,
      participant_count: 5, group_name: 'Sunday Roast Crew', category: 'personal', last_message_at: iso(3 * H),
      latest_inbound_at: iso(3 * H), i_replied_last: false, last_message_text: 'next round on me', message_count_30d: 12,
      messages: [{ text: 'who’s in for brunch', from_me: false, date: iso(4 * H) }, { text: 'next round on me', from_me: false, date: iso(3 * H) }]
    });
    // Large group (14 people) — shows in the inbox like any group, but is
    // still excluded from the responsiveness score.
    conversations.push({
      id: 'iMessage;chat;collegecrew', contact_name: null, phone: 'Group · 14 people', is_group: true,
      participant_count: 14, group_name: 'College Crew 🎓', category: 'personal', last_message_at: iso(2 * H),
      latest_inbound_at: iso(2 * H), i_replied_last: false, last_message_text: 'anyone going to the reunion??', message_count_30d: 200,
      messages: [{ text: 'anyone going to the reunion??', from_me: false, date: iso(2 * H) }]
    });

    conversations.sort(function (a, b) {
      return (b.last_message_at || '').localeCompare(a.last_message_at || '');
    });

    return {
      app: 'Miranda3',
      version: '3.0',
      exported_at: new Date(now).toISOString(),
      sample: true,
      conversations: conversations
    };
  }

  return { generateSampleData: generateSampleData };
});
