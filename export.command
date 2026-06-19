#!/bin/bash
# Miranda3 – iMessage Inbox Exporter
# Double-click to run. Requires Full Disk Access for Terminal.
#
# Reads ~/Library/Messages/chat.db (+ AddressBook for names), normalizes the
# conversations, and writes a JSON file to your Desktop. Open index.html and
# drop that JSON onto the page.

SCRIPT_VERSION="3.0.0"

show_help() {
  cat <<'HELP'
Miranda3 message export

Usage:
  ./export.command [--help] [--version]

Environment overrides:
  MIRANDA3_OUTPUT_PATH    Output JSON path (default: ~/Desktop/miranda3_messages.json)
  MIRANDA3_CHAT_DB_PATH   Chat DB path for export (default: ~/Library/Messages/chat.db)
  MIRANDA3_LOOKBACK_DAYS  How far back to pull messages (default: 90)

Exit codes:
  0  Export completed successfully
  1  Export failed (missing dependencies, permissions, or DB/read errors)
HELP
}

for arg in "$@"; do
  case "$arg" in
    --help|-h) show_help; exit 0 ;;
    --version|-v) echo "Miranda3 export.command ${SCRIPT_VERSION}"; exit 0 ;;
    *) echo "Unknown option: $arg"; echo "Run ./export.command --help for usage."; exit 1 ;;
  esac
done

echo ""
echo "  Miranda3 – iMessage Inbox Export"
echo "  ================================"
echo ""

if ! command -v python3 &>/dev/null; then
  echo "  ERROR: Python 3 not found."
  echo "  Install it from python.org or via Homebrew (brew install python)."
  echo ""
  [ -t 0 ] && read -rp "  Press Enter to close..." _
  exit 1
fi

python3 <<'PYTHON_EOF'
import sqlite3, json, os, re, glob, sys, plistlib
from datetime import datetime, timezone, timedelta

# ── Config ────────────────────────────────────────────────────────────────────

LOOKBACK_DAYS   = int(os.environ.get('MIRANDA3_LOOKBACK_DAYS', '90'))
PERSONAL_THRESH = 3     # Min messages in window to classify as personal (no contact)
OUTPUT_PATH     = os.path.expanduser(os.environ.get('MIRANDA3_OUTPUT_PATH', '~/Desktop/miranda3_messages.json'))
APPLE_EPOCH     = datetime(2001, 1, 1, tzinfo=timezone.utc)

# ── Helpers ───────────────────────────────────────────────────────────────────

def apple_ts(ts):
    """Apple Core Data timestamp → datetime."""
    if not ts:
        return None
    try:
        secs = ts / 1e9 if abs(ts) > 1e10 else float(ts)
        return APPLE_EPOCH + timedelta(seconds=secs)
    except Exception:
        return None

def fmt(dt):
    return dt.isoformat() if dt else None

def norm_phone(p):
    """Strip formatting; remove leading 1 from 11-digit US numbers."""
    d = re.sub(r'\D', '', p or '')
    if len(d) == 11 and d[0] == '1':
        d = d[1:]
    return d

def _uid_int(obj):
    if isinstance(obj, plistlib.UID):
        return obj.data
    if isinstance(obj, dict):
        return obj.get('CF$UID')
    return None

# PyObjC is optional — used for the most reliable streamtyped decoding.
try:
    from Foundation import NSData, NSUnarchiver
    _PYOBJC_OK = True
except ImportError:
    _PYOBJC_OK = False

def _extract_streamtyped(raw):
    """Extract plain text from an NSArchiver streamtyped blob."""
    if _PYOBJC_OK:
        try:
            ns_data = NSData.dataWithBytes_length_(raw, len(raw))
            obj = NSUnarchiver.unarchiveObjectWithData_(ns_data)
            if obj is not None:
                s = str(obj.string()).strip() if hasattr(obj, 'string') else str(obj).strip()
                return s or None
        except Exception:
            pass

    # Fallback: scan for the first plausible UTF-8 string in the binary blob.
    _meta = {
        'streamtyped', 'NSString', 'NSMutableString', 'NSAttributedString',
        'NSMutableAttributedString', 'NSObject', 'NSArray', 'NSMutableArray',
        'NSDictionary', 'NSMutableDictionary', 'NSColor', 'NSFont',
        'NSParagraphStyle', 'NSValue', 'NSNumber', 'NSData', 'NSShadow',
        'NSOriginalFont',
    }
    _cls_prefixes = ('NS', 'UI', 'CK', 'IM', '__', '$')
    i = 0
    while i < len(raw):
        b = raw[i]
        if 0x20 <= b <= 0x7e or b >= 0xc2:
            j = i + 1
            while j < len(raw):
                bj = raw[j]
                if 0x20 <= bj <= 0x7e or 0x80 <= bj <= 0xbf or bj >= 0xc2:
                    j += 1
                else:
                    break
            try:
                s = raw[i:j].decode('utf-8', errors='ignore').strip().lstrip('+$')
                # Strip NSArchiver length-prefix byte: its ASCII value equals the string length
                if len(s) >= 1 and not s[0].isalpha() and not s[0].isdigit():
                    if abs(ord(s[0]) - len(s)) <= 2:
                        s = s[1:]
                # Strip leading object-replacement char (inline attachment placeholder)
                if s.startswith('￼'):
                    s = s[1:].strip()
                # Allow single non-ASCII chars (emoji); require len>=2 for ASCII to block noise bytes like @
                if s not in _meta and (len(s) >= 2 or (len(s) == 1 and ord(s[0]) > 127)):
                    if ' ' in s or not any(s.startswith(p) for p in _cls_prefixes):
                        return s
            except UnicodeDecodeError:
                pass
            i = j
        else:
            i += 1
    return None

def extract_attributed_body(blob):
    """Pull plain text from an NSAttributedString attributedBody blob."""
    if not blob:
        return None
    raw = bytes(blob)

    # NSArchiver streamtyped format — what iMessage actually writes.
    if raw.startswith(b'\x04\x0bstreamtyped'):
        return _extract_streamtyped(raw)

    # NSKeyedArchiver plist format — fallback for non-streamtyped blobs.
    try:
        plist   = plistlib.loads(raw)
        objects = plist.get('$objects', [])

        try:
            top_idx = _uid_int(plist.get('$top', {}).get('root'))
            if top_idx is not None:
                top_obj = objects[top_idx]
                if isinstance(top_obj, dict):
                    ns_idx = _uid_int(top_obj.get('NSString'))
                    if ns_idx is not None:
                        s = objects[ns_idx]
                        if isinstance(s, str) and s.strip():
                            return s.strip()
                        if isinstance(s, dict):
                            v = str(s.get('NS.string', '')).strip()
                            if v:
                                return v
        except Exception:
            pass

        _meta = {
            '$null', 'NSString', 'NSMutableString', 'NSAttributedString',
            'NSMutableAttributedString', 'NSColor', 'NSFont', 'NSParagraphStyle',
            'NSValue', 'NSNumber', 'NSObject', 'NSData', 'NSArray',
            'NSMutableArray', 'NSDictionary', 'NSMutableDictionary',
            '__kIMMessagePartAttributeName', '__kIMDataDetectedAttributeName',
            '__kIMTapbackAttributeName', 'NSOriginalFont', 'NSShadow',
        }
        for obj in objects:
            if isinstance(obj, str):
                s = obj.strip()
                if s and s not in _meta and not s.startswith(('NS', 'UI', '__', '$')):
                    return s
    except Exception:
        pass
    return None

def resolve_text(text, att_body, has_attachment):
    """Return the best available plain text for a message row."""
    t = (text or '').strip()
    if t:
        return t
    from_blob = extract_attributed_body(att_body)
    if from_blob:
        return from_blob
    if has_attachment:
        return '📎 Attachment'
    if att_body:
        return '💬'
    return ''

# ── Contacts ──────────────────────────────────────────────────────────────────

def load_contacts():
    """Return a dict of normalised phone/email → display name from AddressBook."""
    contacts = {}
    patterns = [
        "~/Library/Application Support/AddressBook/Sources/*/AddressBook-v22.abcddb",
        "~/Library/Application Support/AddressBook/AddressBook-v22.abcddb",
    ]
    db_path = None
    for pat in patterns:
        found = glob.glob(os.path.expanduser(pat))
        if found:
            db_path = found[0]
            break
    if not db_path:
        return contacts
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        cur  = conn.cursor()

        cur.execute("""
            SELECT r.ZFIRSTNAME, r.ZLASTNAME, r.ZORGANIZATION, p.ZFULLNUMBER
            FROM ZABCDRECORD r
            JOIN ZABCDPHONENUMBER p ON p.ZOWNER = r.ROWID
            WHERE p.ZFULLNUMBER IS NOT NULL
        """)
        for first, last, org, phone in cur.fetchall():
            name = " ".join(x for x in [first, last] if x) or org or ""
            if name:
                contacts[norm_phone(phone)] = name

        cur.execute("""
            SELECT r.ZFIRSTNAME, r.ZLASTNAME, r.ZORGANIZATION, e.ZADDRESS
            FROM ZABCDRECORD r
            JOIN ZABCDEMAILADDRESS e ON e.ZOWNER = r.ROWID
            WHERE e.ZADDRESS IS NOT NULL
        """)
        for first, last, org, email in cur.fetchall():
            name = " ".join(x for x in [first, last] if x) or org or ""
            if name and email:
                contacts[email.strip().lower()] = name

        conn.close()
    except Exception as e:
        print(f"  Warning: could not load contacts – {e}")
    return contacts

# ── Categorisation ────────────────────────────────────────────────────────────

DELIVERY_SENDERS = {
    'doordash', 'ubereats', 'grubhub', 'instacart', 'postmates', 'shipt',
    'amazon', 'fedex', 'ups', 'usps', 'dhl', 'ontrac', 'lasership',
    'uber', 'lyft', 'gopuff', 'getir', 'walmart', 'target', 'caviar', 'resy',
}

DELIVERY_WORDS = [
    'your order', 'your delivery', 'your package', 'your shipment',
    'out for delivery', 'has been delivered', 'pick up your order',
    'ready for pickup', 'estimated delivery', 'tracking number',
    'doordash', 'ubereats', 'grubhub', 'instacart', 'fedex', 'ups', 'usps',
    'amazon.com', 'uber eats', 'postmates', 'shipt', 'dhl', 'your reservation',
]

SPAM_WORDS = [
    'reply stop', 'text stop', 'opt-out', 'to unsubscribe',
    'verification code', 'verify your', 'one-time password', 'one time password',
    'do not share this code', 'do not share',
    'otp:', ' otp ', 'passcode', 'expires in', 'will expire',
    'you have won', 'claim your', 'free gift', "you've been selected",
    'click here', 'limited time offer', 'act now', 'reply yes to donate',
    'fraud alert', 'suspicious activity', 'unusual activity',
    'account suspended', 'account on hold', 'verify your account',
]

def categorize(handle, contact_name, in_contacts, messages, msg_count):
    digits = re.sub(r'\D', '', handle or '')
    if len(digits) in (5, 6):
        return 'spam'

    name_lower   = (contact_name or '').lower()
    handle_lower = (handle or '').lower()

    for svc in DELIVERY_SENDERS:
        if svc in name_lower or svc in handle_lower:
            return 'delivery'

    sample = ' '.join((m.get('text') or '') for m in messages[:15]).lower()
    for kw in DELIVERY_WORDS:
        if kw in sample:
            return 'delivery'
    for kw in SPAM_WORDS:
        if kw in sample:
            return 'spam'

    if in_contacts:
        return 'personal'
    if msg_count >= PERSONAL_THRESH:
        return 'personal'
    return 'uncategorized'

# ── Message fetching ──────────────────────────────────────────────────────────

MSG_QUERY = """
    SELECT
        m.text,
        m.is_from_me,
        m.date,
        m.attributedBody,
        m.associated_message_type,
        m.item_type,
        EXISTS(
            SELECT 1 FROM message_attachment_join maj
            JOIN attachment a ON a.ROWID = maj.attachment_id
            WHERE maj.message_id = m.ROWID
        ) AS has_attachment
    FROM message m
    JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
    WHERE cmj.chat_id = ? {date_filter}
    ORDER BY m.date DESC
    LIMIT 100
"""

def fetch_rows(cur, chat_id, cutoff):
    cur.execute(MSG_QUERY.format(date_filter=f"AND m.date > {cutoff}"), (chat_id,))
    rows = cur.fetchall()
    if not rows:
        # No messages in window — fall back to the most recent few ever
        cur.execute(MSG_QUERY.format(date_filter=""), (chat_id,))
        rows = cur.fetchall()
    return rows

def is_substantive(row):
    """True for real sent/received messages. False for tapbacks, reactions, group events."""
    _t, _fm, _d, _ab, assoc_type, item_type, _att = row
    return not assoc_type and not item_type

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    db_path = os.path.expanduser(os.environ.get('MIRANDA3_CHAT_DB_PATH', '~/Library/Messages/chat.db'))
    if not os.path.exists(db_path):
        print("  ERROR: iMessage database not found.")
        print(f"  Expected: {db_path}")
        print("  Make sure iMessage is enabled on this Mac.")
        return False

    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        conn.execute("SELECT 1 FROM chat LIMIT 1")
    except sqlite3.OperationalError as e:
        print("  ERROR: Cannot read iMessage database.")
        msg = str(e).lower()
        if any(w in msg for w in ("unable to open", "permission", "denied", "authorization")):
            print("\n  Terminal needs Full Disk Access:")
            print("  1. Open System Settings → Privacy & Security → Full Disk Access")
            print("  2. Enable Terminal (or your terminal app)")
            print("  3. Re-run this script")
        else:
            print(f"  Details: {e}")
        return False

    print("  Loading contacts…")
    contacts = load_contacts()
    print(f"  {len(contacts)} contacts found")
    print("  Reading messages…")

    cur    = conn.cursor()
    now    = datetime.now(timezone.utc)
    cutoff = int(((now - timedelta(days=LOOKBACK_DAYS)) - APPLE_EPOCH).total_seconds() * 1e9)

    cur.execute("SELECT ROWID, guid, chat_identifier, display_name, style FROM chat ORDER BY ROWID")
    chats = cur.fetchall()

    conversations       = []
    tapback_corrections = 0

    for chat_id, guid, chat_identifier, display_name, style in chats:
        cur.execute("""
            SELECT h.id FROM handle h
            JOIN chat_handle_join chj ON h.ROWID = chj.handle_id
            WHERE chj.chat_id = ?
        """, (chat_id,))
        handles = [r[0] for r in cur.fetchall()]

        is_group   = bool(style == 43 or len(handles) > 1)
        primary    = handles[0] if handles else (chat_identifier or '')
        phone_norm = norm_phone(primary)

        in_contacts  = bool(contacts.get(phone_norm) or contacts.get(primary.lower()))
        contact_name = (
            contacts.get(phone_norm) or
            contacts.get(primary.lower()) or
            (display_name if is_group else None)
        )

        rows = fetch_rows(cur, chat_id, cutoff)
        if not rows:
            continue

        substantive = [r for r in rows if is_substantive(r)]

        msg_list = [
            {
                'text':    resolve_text(t, ab, has_att),
                'from_me': bool(fm),
                'date':    fmt(apple_ts(d)),
            }
            for t, fm, d, ab, _assoc, _item, has_att in substantive
        ]

        # Determine reply direction from most recent substantive message
        # (ignoring tapbacks/reactions, which would otherwise mislead us).
        if substantive:
            last_row = substantive[0]
            if rows[0] is not last_row:
                tapback_corrections += 1
        else:
            last_row = rows[0]

        last_t, last_fm, last_d, last_ab, _assoc, _item, last_has_att = last_row
        last_at      = fmt(apple_ts(last_d))
        last_preview = resolve_text(last_t, last_ab, last_has_att)
        msg_count    = sum(1 for r in rows if r[2] > cutoff)

        latest_inbound = next(
            (fmt(apple_ts(d)) for _t, fm, d, _ab, _a, _i, _att in substantive if not fm),
            None,
        )

        conversations.append({
            'id':                guid,
            'contact_name':      contact_name,
            'phone':             primary,
            'is_group':          is_group,
            'group_name':        display_name if is_group else None,
            'participant_count': len(handles) + 1,  # other members + you
            'category':          categorize(primary, contact_name, in_contacts, msg_list, msg_count),
            'last_message_at':   last_at,
            'last_message_text': last_preview,
            'i_replied_last':    bool(last_fm),
            'latest_inbound_at': latest_inbound,
            'message_count_30d': msg_count,
            'messages':          list(reversed(msg_list[:6])),
        })

    conn.close()

    conversations.sort(key=lambda c: c.get('last_message_at') or '', reverse=True)

    cats = {}
    unreplied_personal = 0
    for c in conversations:
        cats[c['category']] = cats.get(c['category'], 0) + 1
        if c['category'] == 'personal' and not c['i_replied_last']:
            unreplied_personal += 1

    output = {
        'app':           'Miranda3',
        'version':       '3.0',
        'exported_at':   now.isoformat(),
        'conversations': conversations,
    }

    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    p = cats.get('personal', 0)
    d = cats.get('delivery', 0)
    s = cats.get('spam', 0)
    u = cats.get('uncategorized', 0)

    print(f"\n  Done!\n")
    print(f"  Conversations exported: {len(conversations)}")
    print(f"    Personal:       {p}  ({unreplied_personal} waiting on you)")
    print(f"    Delivery:       {d}")
    print(f"    Spam:           {s}")
    print(f"    Uncategorized:  {u}")
    if tapback_corrections:
        print(f"\n  Tapback corrections: {tapback_corrections} conversation(s) had their")
        print(f"  reply status corrected by ignoring reactions/tapbacks.")
    print(f"\n  File: {OUTPUT_PATH}")
    print(f"\n  Open index.html and drag the JSON file onto the page.")
    return True

ok = main()
sys.exit(0 if ok else 1)
PYTHON_EOF

STATUS=$?
echo ""
if [ $STATUS -eq 0 ]; then
  echo "  Export complete. You can close this window."
else
  echo "  Export failed. See errors above."
fi
echo ""
[ -t 0 ] && [ -t 1 ] && read -rp "  Press Enter to close..." _
exit $STATUS
