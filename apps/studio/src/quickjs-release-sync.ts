import releaseSyncVariant from "@jitl/quickjs-wasmfile-release-sync";
import { newQuickJSWASMModuleFromVariant, type QuickJSWASMModule } from "quickjs-emscripten-core";

let quickJsModule: Promise<QuickJSWASMModule> | undefined;

export function getQuickJS(): Promise<QuickJSWASMModule> {
  quickJsModule ??= newQuickJSWASMModuleFromVariant(releaseSyncVariant);
  return quickJsModule;
}
