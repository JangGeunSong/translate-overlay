import { BuiltInTranslatorProvider } from "./builtInTranslatorProvider";
import { DemoProvider } from "./demoProvider";
import { ProviderChain, type LinguisticProvider } from "./provider";
import { RemoteInterpretationProvider } from "./remoteInterpretationProvider";
import { RemoteTranslationProvider } from "./remoteTranslationProvider";

export function createRuntimeProviderChain(enableDemo = false): ProviderChain {
  const providers: LinguisticProvider[] = [
    new BuiltInTranslatorProvider(),
    new RemoteTranslationProvider(),
    new RemoteInterpretationProvider(),
  ];

  if (enableDemo) providers.push(new DemoProvider());

  return new ProviderChain(providers);
}
