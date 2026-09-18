import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("tapMakerWork", {
  platform: process.platform,
  desktop: true
});
