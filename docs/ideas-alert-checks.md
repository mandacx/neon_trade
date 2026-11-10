# Trade Ideas alerts: owner checks on real clients

Code and headless Chromium cannot answer these. Work through them with your own mailboxes and devices. **No test goes to a real
subscriber.** Nothing in this document is verified yet: the results table at the end is empty until you fill it in.

| Area | Code / headless Chromium already checks | Only a real client or phone can check |
|---|---|---|
| Email layout | 600/360/320 px render with no horizontal overflow, preheader hidden, link present, light and dark emulation, contrast of every text/background pair (`node scripts/render-idea-alert-samples.mjs --screenshots`, `node scripts/test-idea-alerts.mjs`) | Gmail, Outlook (Word renderer), Apple Mail, forced inversion, clipping, spam folder |
| Unsubscribe | token round trip, tampering, header building (`node scripts/test-unsubscribe.mjs`) | Gmail / Yahoo native Unsubscribe button and one-click POST, DKIM coverage of the header, the page against the real database |
| Telegram | message text built, widest row printed (`report.json`) | actual `<pre>` width on a phone, inline button |
| Push | payload size, urgency mapping | truncation, icon, click, latency |

## Before you start

1. Resend: confirm `stockstrendz.com` is a **verified sending domain** (SPF and DKIM verified, DMARC ideally set).
2. Vercel Production: set the `EMAIL_FROM` address to `support@stockstrendz.com` (the display name no longer matters: alerts are
   sent as `StocksTrendz Trade Ideas <address>`).
3. Generate and set `IDEA_UNSUB_SECRET` in Vercel Production, then redeploy:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` (at least 32 characters; keep it secret, never commit it).
   Without it emails go out with no unsubscribe link and no headers.
4. Confirm `support@stockstrendz.com` actually receives mail (the footer says "Contact support@stockstrendz.com").
5. Samples without sending anything: `node scripts/render-idea-alert-samples.mjs --screenshots` writes `.tmp/idea-alert-samples/`
   (git-ignored): `index.html` links every sample; each has `.html`, `.txt`, `.eml` (double-click in Apple Mail or Outlook
   desktop; no send needed, but it is not a Gmail test), Telegram text and push JSON. The sample unsubscribe link is invalid on
   purpose (it shows the "link does not work" state). For Gmail you need one real message: publish an idea to yourself with only
   your own account opted in, and with your approval.
6. For every pass or fail note the device model, app and OS version; keep a screenshot of every fail.

## Email, per client (open from the inbox list, screenshot each)

1. **Inbox list.** Sender shows `StocksTrendz Trade Ideas`; the subject starts with the symbol or "New idea:"; the preview text
   completes the subject and is not the card's first body text. Fail: another sender name (for example "Stocks Trendz"), blank or filler preview.
2. **Layout.** Banner with group word and headline, symbol and LONG/SHORT badge, levels table, button, grey disclaimer box,
   footer, in that order, nothing cut off, columns line up, no sideways scrolling. Fail: overlap, one-letter columns, unreadable
   button, anything clipped, or Gmail's "Message clipped" bar.
3. **Footer and unsubscribe.** Unsubscribe and Manage alerts links visible, underlined, tappable. The unsubscribe link opens the
   confirm page and does **not** unsubscribe by itself (Alerts menu: Email still ticked). Fail: hard to see, not clickable,
   unsubscribes without a button press, or State "link does not work" on a fresh email.
4. **Gmail** (web, iOS, Android; light then dark mode). Pass (dark): all text readable, banner words and button label legible,
   nothing white-on-white or dark-on-dark (the card may be dark or stay light). Gmail only: look for the native "Unsubscribe" next
   to the sender name, tap it, confirm, then check the Alerts menu: Email is unticked. In "Show original" confirm
   `List-Unsubscribe` and `List-Unsubscribe-Post` are present **and listed in the DKIM `h=` tag**. Fail: link missing (report
   which clients), or tapped but Email still ticked.
5. **Outlook** desktop (Windows), Outlook on the web, Outlook mobile if you have it. Pass: readable in order; rounded corners and
   exact widths may be lost; the button still looks like a button and works. Fail: invisible button text, collapsed table, white text on a white banner. Outlook.com dark: same as Gmail dark.
6. **Apple Mail** macOS and iOS, light then dark. Expected: the card stays light in dark mode (`color-scheme: light`). Pass: readable
   in both; note which way it behaves. If the light card in dark mode feels glaring, tell the developer: that is the trigger to build the
   specified dark palette (not a readability failure).
7. **Text-only view.** Reads top to bottom, headline first, levels listed, the unsubscribe URL alone on its own line.
8. **Screen reader** (VoiceOver on iPhone, one message). Pass: headline words, symbol, LONG or SHORT, the levels as a table, footer links read by name. Fail: glyph names ("black star") before the headline, or the long URL read letter by letter.
9. **Spam check.** After the first real send with the new sender name, note inbox or spam in Gmail and Outlook; if spam, mark "not spam" and tell the developer.
10. **End-to-end unsubscribe.** Tap Unsubscribe in the email, press the button, see "You are unsubscribed"; open the Alerts menu
    (signed in): Email is unticked; trigger another alert: no email arrives (Telegram and push, if on, still arrive). Press Undo on
    the page, or tick Email again, to restore. Fail: Email still ticked, emails keep arriving, or Telegram/push stopped.
11. **Unsubscribe page on your phone** (Safari iOS, Chrome Android) at about 360 px: button easily tappable, no horizontal scroll,
    text readable. Delete the last 5 characters of the token in the URL: the "link does not work" state appears with the manual steps.

## Telegram on a phone

Open a received alert at default text size, portrait, and look at the monospace levels block (`<pre>`). The code currently builds rows
up to 48 characters (`stopped`; the other kinds are 33 or less, see `report.json`); the design target was about 34.
- Pass: every row is fully visible, columns line up, no sideways swipe, in a short message (stopped) and the longest (published with two targets and a note).
- Fail: a row is cut off, wrapped so the columns no longer align, or needs a sideways swipe.
Also check: the first line names symbol and event; the "Open idea" button works; the text link works; a forwarded copy keeps the link; bold and italic render; the
"Ideas are for information..." disclaimer line is present.

**If any row fails, narrow to a 36-character budget in this order** (not applied yet; do not narrow blindly): (1) labels at most 6
characters (`Entry`, `Stop`, `T1`, `Valid`); (2) drop "zone" and "original" from rows (`Entry 100.00 - 102.00`); (3) status as the glyph plus
at most 5 letters (`✓ hit`, `○`, `× miss`); (4) put the R note on its own line below the block; (5) a row that still exceeds 36 moves out of the block
into plain text under it (for example `Original stop 95.00 (scored)`). Then fail the fixture at 40.

## Push notifications

Chrome desktop (Windows or macOS), Chrome Android, Firefox desktop, Safari macOS, and an iPhone with the app added to the Home Screen.
Trigger an alert to yourself on each.
- **Title and body:** title shows `SYMBOL direction: event ...` fully or with a clean cut after the key words; body shows the numbers line and "For information only, not advice."; no `\n` characters visible.
- **Icon:** an icon appears (currently an SVG; unverified on every platform). Report which platform shows a blank or generic icon (feeds the PNG icon follow-up).
- **Stacking:** two events on one idea give two separate notifications.
- **Click:** opens the right `/ideas/<id>` (signed out goes to login and returns).
- **Urgency:** lock the phone on battery saver for 30 minutes, then trigger a "stopped" alert (sent with urgency `high`). Pass: it arrives within about a minute. A fail is noted, not an app bug (how each push service treats the hint is unverified).

## Glyphs

Look for `★ ● ✓ ✕ ◷ ○ ✎ ⇄ ◐ ■ ⊘` and the arrows `▲ ▼` in the email on iPhone, Android, Windows (Outlook) and macOS. Pass: clean symbols. Fail: a box, a question mark or
an emoji-style picture (the words in the banner carry the meaning; a swap is cosmetic). Tell the developer which glyph and client.

## Results

| Client | Device / OS / app version | Light / dark | Pass / fail | Note |
|---|---|---|---|---|
| | | | | |
