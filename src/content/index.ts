import type { ReaderMessage, ReaderStateResponse } from "../shared/messages";
import { PageAnalyzer } from "./analysis/pageAnalyzer";
import { BuiltInTranslatorProvider } from "./providers/builtInTranslatorProvider";
import { DemoProvider } from "./providers/demoProvider";
import { ProviderChain } from "./providers/provider";
import { RemoteInterpretationProvider } from "./providers/remoteInterpretationProvider";
import { ReaderController } from "./readerController";

const controller = new ReaderController(
  new PageAnalyzer(),
  new ProviderChain([
    new BuiltInTranslatorProvider(),
    new RemoteInterpretationProvider(),
    new DemoProvider(),
  ]),
);

chrome.runtime.onMessage.addListener((message: ReaderMessage) => {
  if (message.type === "SET_READER_ENABLED") controller.setEnabled(message.enabled);
});

chrome.runtime.sendMessage({ type: "GET_READER_STATE" } satisfies ReaderMessage, (response?: ReaderStateResponse) => {
  if (chrome.runtime.lastError) return;
  controller.setEnabled(response?.enabled ?? false);
});
