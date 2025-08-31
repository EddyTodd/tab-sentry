const wrap = document.getElementById('wrap');
const toggle = document.getElementById('toggle');

function render(on) {
  if (on) wrap.classList.add('on'); else wrap.classList.remove('on');
}

chrome.storage.sync.get('nnthk_enabled', ({ nnthk_enabled }) => {
  render(!!nnthk_enabled);
});

toggle.addEventListener('click', () => {
  chrome.storage.sync.get('nnthk_enabled', ({ nnthk_enabled }) => {
    const next = !nnthk_enabled;
    chrome.storage.sync.set({ nnthk_enabled: next }, () => render(next));
  });
});
