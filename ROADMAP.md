# Tab Sentry roadmap

## Current priority: a specialized, accurate popup and unwanted-tab blocker

1. **Reliability:** race-free tab classification, source-frame intent tracking, bounded state, accurate counters, conditional focus restoration.
2. **Diagnostics (first pass implemented):** a small privacy-limited, 60-second rolling recorder with one-click report generation. Validate capture fidelity and clipboard behavior in Chrome; no automatic fixes or site-specific instrumentation yet.
3. **User control and recovery:** polished toolbar UI, local per-site exceptions, activity transparency. Explore a safely recoverable blocked-tab queue that does not retain sensitive URLs by default.
4. **Browser verification:** Chrome end-to-end scenarios for normal browsing, blank-target popups, nested frames, OAuth/payment flows, popup floods, and worker restarts; performance and false-positive benchmarks.
5. **Playback Shield (experimental first pass implemented):** guarded main-world window.open interception, high-confidence overlay neutralization, and per-site strong blocking. Now validate behavior on representative sites; keep browser-event classification as fallback. Evaluate false positives, authentication/payment windows, iframe coverage, and user-gesture compatibility before declaring it ready.
6. **Distribution:** document minimal permissions, privacy, store assets, reproducible packaging, and manual release verification.

## Future phase: full ad blocker (not yet implemented)

Once the specialized popup blocker is verified, evaluate network ad/tracker protection based on Manifest V3 declarativeNetRequest, curated filter lists, efficient updates, per-site controls, cosmetic filtering only where justified, and a privacy-first rules strategy. Keep all protections modular and individually switchable. Do not add a cloud dependency or a heavy UI framework by default.

No full-ad-blocker tasks should be conflated with the popup blocker release gate.

## Release gate

Do not claim the popup blocker is complete until real-browser tests confirm its false-positive behavior, coverage, performance, accessibility, and compatibility. Never claim local CI passed without reading the result. Do not create or trigger GitHub Actions.

## First field test

Load the branch with both the flight recorder and Playback Shield. Keep the default Balanced mode. On a problematic video site, try Play once. If popups or overlays still interfere, enable Stronger popup blocking for that site and retry. Use Diagnose Problem immediately after an issue. Do not collect or share media content or full URLs. Do not claim successful protection without a real-browser outcome.
