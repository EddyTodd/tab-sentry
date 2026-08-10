# Tab Sentry

Tab Sentry blocks unwanted tabs and popup windows created by web pages without blocking Chrome itself.

## Behavior

- Allows Chrome startup, new-tab shortcuts, menu actions, and manually created windows.
- Allows a link you intentionally open with `target="_blank"`, middle-click, Ctrl/Cmd-click, Shift-click, keyboard activation, or the link context menu.
- Blocks page-created tabs whose destination does not match a recent intentional link gesture.
- Restores focus to the page that created a blocked tab.

The extension is off by default.

## Install from source

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this repository.
4. Pin Tab Sentry and enable **Smart popup blocking** from its toolbar popup.

After updating the source, use the extension's **Reload** button on `chrome://extensions`.

## Policy details

Content scripts record only the exact URL of an intentional new-tab link gesture. The background service worker consumes that intent once. Page-created targets without a matching intent are closed. Tabs without a source page are never classified as popups, which prevents the extension from deleting Chrome's startup or manual tabs.

Chrome reports a page-created navigation target only after creating it, so a blocked tab may appear briefly before Tab Sentry closes it.

## Tests

Run the policy tests with Node.js 18 or newer:

```sh
node --test tests/tab-policy.test.js
```
