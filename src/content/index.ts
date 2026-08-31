import type { ReaderMessage, ReaderStateResponse } from "../shared/messages";
import { PageAnalyzer } from "./analysis/pageAnalyzer";
import { createRuntimeProviderChain } from "./providers/runtimeProviderChain";
import { ReaderController } from "./readerController";

declare const __CONTEXT_READER_DEMO_ENABLED__: boolean;

const controller = new ReaderController(
  new PageAnalyzer(),
  createRuntimeProviderChain(__CONTEXT_READER_DEMO_ENABLED__),
);

chrome.runtime.onMessage.addListener((message: ReaderMessage) => {
  if (message.type === "SET_READER_ENABLED") controller.setEnabled(message.enabled);
});

chrome.runtime.sendMessage({ type: "GET_READER_STATE" } satisfies ReaderMessage, (response?: ReaderStateResponse) => {
  if (chrome.runtime.lastError) return;
  controller.setEnabled(response?.enabled ?? false);
});
