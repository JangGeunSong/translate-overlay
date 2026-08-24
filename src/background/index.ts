import type { ReaderMessage, ReaderStateResponse } from "../shared/messages";

const stateKey = (tabId: number): string => `reader:${tabId}`;

async function getEnabled(tabId: number): Promise<boolean> {
  const result = await chrome.storage.session.get(stateKey(tabId));
  return result[stateKey(tabId)] === true;
}

async function setEnabled(tabId: number, enabled: boolean): Promise<void> {
  await chrome.storage.session.set({ [stateKey(tabId)]: enabled });
  await chrome.action.setBadgeText({ tabId, text: enabled ? "ON" : "" });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#2457d6" });
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  const enabled = !(await getEnabled(tab.id));
  await setEnabled(tab.id, enabled);
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "SET_READER_ENABLED", enabled } satisfies ReaderMessage);
  } catch {
    await setEnabled(tab.id, false);
  }
});

chrome.runtime.onMessage.addListener(
  (message: ReaderMessage, sender, sendResponse: (response: ReaderStateResponse) => void) => {
    if (message.type !== "GET_READER_STATE" || !sender.tab?.id) return false;
    void getEnabled(sender.tab.id).then((enabled) => sendResponse({ enabled }));
    return true;
  },
);

chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.remove(stateKey(tabId));
});
