# Tab Sentry

A lightweight, privacy-conscious Chrome Manifest V3 extension for blocking **unwanted page-created tabs and popup windows**, without blocking ordinary browsing actions.

> Scope for version 1.3: specialized popup and unwanted-tab protection. Full network-level ad blocking is a separate future phase; it is **not implemented**.

## Current features

- Allows browser-created tabs/windows and ordinary new-tab shortcuts.
- Recognizes intentional HTTP(S) links opened by middle-click, modified clicks, new-tab targets, keyboard activation, and link context menus.
- Matches link intent by **source tab, source frame, and exact destination**, and consumes each permission once.
- Closes unmatched page-created targets and attempts to restore focus only when the blocked tab had focus.
- Per-site popup exceptions, stored locally and editable from the toolbar popup.
- Session blocked count and a list of up to 12 recent events (only source and destination hostnames and time, not full browsing URLs).
- Redesigned keyboard-accessible toolbar popup with an explicit **Reset** action.
- One-click **Diagnose Problem** button for video playback and popup issues, with a privacy-limited 60-second event timeline and clipboard copy.
- No framework, tracking, analytics, remote services, or third-party dependencies.

**Protection remains off by default**, and can be enabled from the toolbar popup.

## Install from source

1. Visit chrome://extensions.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this repository.
4. Pin Tab Sentry and switch on **Protection** in the popup.

After editing or pulling the source, click **Reload** on the extension card.

## One-click troubleshooting

Tab Sentry maintains a small **local flight recorder** when protection is enabled. If you click Play and an unwanted tab opens, immediately open the toolbar popup and press **Diagnose Problem**. The popup creates a report for the **currently active browser tab**, copies it when Chrome permits clipboard access, and displays a preview you can inspect and copy manually. Paste the report into ChatGPT to help diagnose what happened. No upload or network transmission occurs.

The recorder captures only:
- Coarse media-control click categories (video, possible overlay, embedded frame or Play control).
- Native HTML video "playing" and "error" events.
- Page-created popup attempts and their allow/block outcomes.
- Source and destination **hostnames** (no paths, query strings or page titles), coarse frame indicator and relative event timing.

It never reads screenshots, playback content, keystrokes, cookies, passwords or other fields. A simple heuristic flags a *possible* click hijack when a media click is followed by a popup without a corresponding playback start; this is not proof that an overlay caused the failure.

**Retention:** a maximum of 120 events is stored in chrome.storage.session. Only events from the preceding 60 seconds are included in reports; expired entries are removed on subsequent event writes. If nothing happens afterward, some expired data may remain in browser-session storage until the next write or browser shutdown. Hostnames may reveal sensitive browsing activity, so review the report before pasting it anywhere. Recording is disabled for Incognito tabs.

If the report shows no events, try immediately after reproducing the problem, while protection is enabled. The recorder observes only the currently supported signals; cross-origin or script-only players may not expose their internals.

## What protection does

Content scripts listen for real user gestures on links and register the exact target URL and source frame. When Chrome reports a newly created navigation target, the background worker checks for a matching one-time link intent or a per-site exception. Unmatched targets from HTTP(S) pages are closed. Chrome startup tabs and browser-created tabs without a page navigation source are not targeted.

Intent permissions expire in 5 seconds, or 12 seconds for the link context menu. The longer context-menu window is a compromise because selection of **Open link in new tab** happens after the menu opens.

A popup can still appear momentarily: webNavigation.onCreatedNavigationTarget fires **after** the browser creates the target. A short grace period also allows a new about:blank target to navigate before classification.

## Limitations

- Some legitimate JavaScript-only authentication/payment popups may be blocked. Use the current site's **Allow popups** switch for trusted sites.
- Script-created navigations without a new tab, popup attempts stopped by Chrome itself, and network ads are outside the current scope.
- Unmatched about:blank targets use a short in-memory grace timer; it is not guaranteed to fire if Chrome suspends the extension service worker during that interval.
- Source-frame-aware matching reduces accidental permissions but does not solve every edge case involving unusual browser-context-menu or redirect behavior.
- Session history stays on-device, in chrome.storage.session, and vanishes when the browser session ends.

## Run tests

Requires Node.js 18+.

    node --test tests/*.test.js
    node --check background.js
    node --check content.js
    node --check popup.js
    node --check tab-policy.js
    node --check diagnostics.js

Test results must be verified externally; adding these tests alone does not confirm Chrome compatibility. Manually test normal tab gestures, OAuth/login windows, payments, ad-heavy pages, popup floods, and extension worker restarts before releasing.

## Roadmap

See [ROADMAP.md](ROADMAP.md). The dedicated popup blocker comes first; optional full ad blocking would require a separate privacy, performance, rules, and permissions design.
