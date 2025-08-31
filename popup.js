const KEY = 'enabled';
const $toggle = document.getElementById('toggle');

function setUI(on) {
  $toggle.classList.toggle('on', !!on);
}

chrome.storage.local.get(KEY, (s) => setUI(!!s[KEY]));

$toggle.addEventListener('click', () => {
  chrome.storage.local.get(KEY, (s) => {
    const next = !s[KEY];
    chrome.storage.local.set({ [KEY]: next }, () => {
      setUI(next);
      chrome.runtime.sendMessage({ type: 'broadcast-enabled-change', enabled: next });
    });
  });
});
