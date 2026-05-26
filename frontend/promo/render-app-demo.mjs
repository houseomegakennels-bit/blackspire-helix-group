import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(__dirname, "blackspire-app-demo.html");
const outDir = path.join(__dirname, "out");
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--hide-scrollbars",
    "--mute-audio",
  ],
});

const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  screen: { width: 1920, height: 1080 },
  recordVideo: {
    dir: outDir,
    size: { width: 1920, height: 1080 },
  },
  deviceScaleFactor: 1,
});

const page = await context.newPage();
await page.goto(`file:///${htmlPath.replace(/\\/g, "/")}`, { waitUntil: "load" });
await page.waitForTimeout(15000);
await context.close();
await browser.close();
