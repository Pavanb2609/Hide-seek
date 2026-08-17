chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeText({ text: '' });
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.action === 'updateBadge') {
    const count = msg.count || 0;
    const tabId = sender.tab ? sender.tab.id : null;
    if (tabId) {
      chrome.action.setBadgeText({
        text: count > 0 ? String(count) : '',
        tabId: tabId
      });
      chrome.action.setBadgeBackgroundColor({
        color: '#ff003c',
        tabId: tabId
      });
    }
  }
});
