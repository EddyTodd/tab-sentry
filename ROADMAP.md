# Tab Sentry roadmap

## Current priority: a specialized, accurate popup and unwanted-tab blocker

1. **Reliability:** race-free tab classification, source-frame intent tracking, bounded state, accurate counters, conditional focus restoration.
2. **User control and recovery:** polished toolbar UI, local per-site exceptions, activity transparency. Explore a safely recoverable blocked-tab queue that does not retain sensitive URLs by default.
3. **Browser verification:** Chrome end-to-end scenarios for normal browsing, blank-target popups, nested frames, OAuth/payment flows, popup floods, and worker restarts; performance and false-positive benchmarks.
4. **Advanced detection:** evaluate isolated main-world interception experiments only if they demonstrate measurable improvements and preserve compatibility. Keep browser-event protection as a fallback.
5. **Distribution:** document minimal permissions, privacy, store assets, reproducible packaging, and manual release verification.

## Future phase: full ad blocker (not yet implemented)

Once the specialized popup blocker is verified, evaluate network ad/tracker protection based on Manifest V3 declarativeNetRequest, curated filter lists, efficient updates, per-site controls, cosmetic filtering only where justified, and a privacy-first rules strategy. Keep all protections modular and individually switchable. Do not add a cloud dependency or a heavy UI framework by default.

No full-ad-blocker tasks should be conflated with the popup blocker release gate.

## Release gate

Do not claim the popup blocker is complete until real-browser tests confirm its false-positive behavior, coverage, performance, accessibility, and compatibility. Never claim local CI passed without reading the result. Do not create or trigger GitHub Actions.
