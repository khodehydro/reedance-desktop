import type { StudioApi } from "@shared/types";
import { createMockBridge } from "./dev/mock";

declare global {
  interface Window {
    reedance?: StudioApi;
  }
}

export const isMock = !window.reedance;

/**
 * In Electron the preload bridge is the only API surface. In a plain browser
 * (design preview) a clearly-labelled in-memory mock takes its place.
 */
export const api: StudioApi = window.reedance ?? createMockBridge();
