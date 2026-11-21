import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/**
 * Renderer smoke test.
 *
 * The real app runs inside Electron, but a crash on the very first render would
 * make the installer useless, so the renderer is bundled exactly like the
 * production build (CSS dropped, React in production mode) and mounted in jsdom
 * against the in-memory mock bridge. It proves the shell, the splash, the
 * library screen and the IPC-free mock path all mount without throwing.
 */
const repo = path.join(__dirname, "..");

async function bundle(): Promise<string> {
  const result = await build({
    stdin: {
      contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import App from "./src/renderer/App";
        export function mount(element) {
          createRoot(element).render(React.createElement(App));
        }
      `,
      resolveDir: repo,
      sourcefile: "smoke-entry.tsx",
      loader: "tsx",
    },
    absWorkingDir: repo,
    bundle: true,
    write: false,
    format: "iife",
    globalName: "ReedanceApp",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    loader: { ".css": "empty", ".png": "dataurl", ".woff2": "empty", ".woff": "empty" },
    define: { "process.env.NODE_ENV": '"production"' },
    alias: { "@shared": path.join(repo, "src/shared") },
    logLevel: "silent",
  });
  return result.outputFiles[0].text;
}

test("the renderer mounts the app shell, splash and library in a browser-like environment", async () => {
  const code = await bundle();

  const dom = new JSDOM(
    `<!doctype html><html lang="fa" dir="rtl"><head></head><body><div id="root"></div><div id="boot-splash"></div></body></html>`,
    { runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/" },
  );
  const { window } = dom;

  // jsdom has no canvas/AudioContext; the library screen does not use them, but
  // the modules import them lazily, so tiny stubs keep the mount deterministic.
  const stubs: Record<string, unknown> = {
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    createObjectURL: () => "blob:mock",
    revokeObjectURL: () => undefined,
  };
  for (const [key, value] of Object.entries(stubs)) {
    if (!(key in window)) (window as unknown as Record<string, unknown>)[key] = value;
  }
  (window as unknown as { URL: typeof URL }).URL.createObjectURL = stubs.createObjectURL as () => string;
  (window as unknown as { URL: typeof URL }).URL.revokeObjectURL = stubs.revokeObjectURL as () => void;

  // Canvas + WebAudio are Electron-only in the real app; jsdom has neither, so
  // the waveform tab gets recording stubs instead of failing to mount.
  const drawn: string[] = [];
  const ctx = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === "measureText") return () => ({ width: 12 });
        if (prop === "createLinearGradient") return () => ({ addColorStop() {} });
        return (...args: unknown[]) => {
          drawn.push(String(prop));
          void args;
        };
      },
      set: () => true,
    },
  );
  (window.HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }).getContext = () => ctx;
  class FakeAudioContext {
    sampleRate = 44100;
    destination = {};
    close(): Promise<void> {
      return Promise.resolve();
    }
    async decodeAudioData(): Promise<unknown> {
      const length = 44100 * 4;
      return {
        length,
        duration: 4,
        numberOfChannels: 1,
        sampleRate: 44100,
        getChannelData: () => new Float32Array(length),
      };
    }
  }
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  (window.HTMLMediaElement.prototype as unknown as { play: () => Promise<void> }).play = () => Promise.resolve();
  (window.HTMLMediaElement.prototype as unknown as { pause: () => void }).pause = () => undefined;

  const errors: string[] = [];
  window.addEventListener("error", (event: ErrorEvent) => errors.push(String(event.message)));
  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => errors.push(String(event.reason)));

  window.eval(`${code}\n;window.__mountReedance = ReedanceApp.mount;`);
  const mount = (window as unknown as { __mountReedance?: (el: Element) => void }).__mountReedance;
  assert.ok(typeof mount === "function", "App exports a mount function");

  const root = window.document.getElementById("root");
  assert.ok(root);
  mount(root as Element);

  // Let React commit and the mock bootstrap promises resolve.
  await new Promise((resolve) => setTimeout(resolve, 250));

  const text = window.document.body.textContent ?? "";
  assert.deepEqual(errors, []);
  assert.ok(text.includes("HYDRO team"), "the splash/footer credits the HYDRO team");
  assert.ok(text.includes("کتابخانه") || text.includes("Library"), "the library screen renders");
  assert.ok(window.document.querySelector(".sidebar"), "the app shell renders the navigation");

  const clickNav = async (label: string): Promise<string> => {
    const button = Array.from(window.document.querySelectorAll(".nav-item")).find((element) =>
      (element.textContent ?? "").includes(label),
    );
    assert.ok(button, `navigation entry ${label} exists`);
    (button as unknown as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 120));
    return window.document.body.textContent ?? "";
  };

  const stats = await clickNav("آمار");
  assert.ok(stats.includes("آمار و گزارش‌ها"), "the statistics page mounts");
  assert.ok(stats.includes("دامنهٔ گزارش"), "the statistics page explains its scope");

  const settings = await clickNav("تنظیمات");
  assert.ok(settings.includes("ظاهر"), "the settings page mounts");
  assert.ok(settings.includes("پوشهٔ خروجی‌ها"), "the output folder setting is offered");
  assert.ok(settings.includes("HYDRO team"), "the about section keeps the HYDRO team credit");
  assert.ok(!settings.includes("کلید رمزنگاری فایل‌ها"), "no key section is shown: keys are embedded, not operator-managed");
  assert.ok(!settings.includes("رمز فایل‌ها"), "no file-password field is left in Settings");
  assert.ok(!settings.includes("اثر انگشت"), "no key fingerprint is exposed");

  const library = await clickNav("کتابخانه");
  assert.ok(library.includes("کتابخانه"), "navigation returns to the library");

  const card = window.document.querySelector(".project-card");
  assert.ok(card, "the mock library lists at least one project");
  const openButton = Array.from(card!.querySelectorAll("button")).find((button) =>
    /بازکردن|باز کردن|Open/i.test(button.textContent ?? ""),
  );
  assert.ok(openButton, "the project card exposes an open action");
  (openButton as unknown as HTMLElement).click();
  await new Promise((resolve) => setTimeout(resolve, 200));
  const projectText = window.document.body.textContent ?? "";
  assert.ok(projectText.includes("midnight-avenue"), "the project workspace opens");
  assert.ok(/نمای کلی|Overview/.test(projectText), "the overview tab is the default");
  assert.ok(projectText.includes("تایم‌لاین"), "the timeline tab is present");

  const timelineTab = Array.from(window.document.querySelectorAll(".tab")).find((element) =>
    (element.textContent ?? "").includes("تایم‌لاین"),
  );
  assert.ok(timelineTab, "the timeline tab button exists");
  (timelineTab as unknown as HTMLElement).click();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const timelineText = window.document.body.textContent ?? "";
  assert.ok(/ثبت زمان سطر|Capture line time/.test(timelineText), "the waveform editor mounts");
  assert.ok(window.document.querySelector(".wave-canvas"), "the waveform canvas is rendered");
  assert.ok(window.document.querySelectorAll(".line-row").length > 0, "lyric lines are listed under the waveform");

  // The story tab must mount its story-audio timeline once a story audio is
  // added: same waveform/transport/capture-line toolkit as the lyric timeline.
  const storyTab = Array.from(window.document.querySelectorAll(".tab")).find((element) =>
    (element.textContent ?? "").includes("داستان"),
  );
  assert.ok(storyTab, "the story tab button exists");
  (storyTab as unknown as HTMLElement).click();
  await new Promise((resolve) => setTimeout(resolve, 160));
  const addStoryAudio = Array.from(window.document.querySelectorAll("button")).find((button) =>
    /افزودن صوت داستان|Add story audio/.test(button.textContent ?? ""),
  );
  assert.ok(addStoryAudio, "the story audio add button renders");
  (addStoryAudio as unknown as HTMLElement).click();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const storyText = window.document.body.textContent ?? "";
  assert.ok(/story\.mp3/.test(storyText), "the added story audio is shown");
  assert.ok(window.document.querySelector(".timeline-ltr .drag-line"), "the story audio timeline mounts the capture line");
  assert.ok(window.document.querySelector(".timeline-ltr .wave-canvas"), "the story audio timeline mounts the waveform");

  // Every remaining project tab must mount too: the content editors, the quiz
  // editor and the review/export panel all read from the same bridge.
  for (const label of ["متن و واژه", "آموزش", "آزمون", "خروجی"]) {
    const tab = Array.from(window.document.querySelectorAll(".tab")).find((element) =>
      (element.textContent ?? "").includes(label),
    );
    assert.ok(tab, `the ${label} tab exists`);
    (tab as unknown as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 160));
  }
  const reviewText = window.document.body.textContent ?? "";
  assert.ok(/دریافت فایل خروجی|Get the output file/.test(reviewText), "the one-click export button renders");
  assert.ok(window.document.querySelector(".export-hero"), "the export panel explains readiness");
  assert.ok(!reviewText.includes("چک‌لیست حقوق"), "the rights checklist page is gone");

  // Light/dark/System theme switch: the resolved theme lands on <html>.
  assert.equal(window.document.documentElement.dataset.theme, "dark");
  const toggle = window.document.querySelector(".theme-toggle");
  assert.ok(toggle, "the theme toggle is in the top bar");
  (toggle as unknown as HTMLElement).click();
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.ok((window.document.querySelector(".theme-toggle")?.textContent ?? "").includes("سیستم"), "dark → system");
  (window.document.querySelector(".theme-toggle") as unknown as HTMLElement).click();
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(window.document.documentElement.dataset.theme, "light");
  (window.document.querySelector(".theme-toggle") as unknown as HTMLElement).click();
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(window.document.documentElement.dataset.theme, "dark");
  assert.ok(window.document.querySelector(".app"), "the shell survives the theme change");

  assert.deepEqual(errors, [], errors.join("; "));
});
