import { ESPLoader, Transport } from "../vendor/esptool-js.bundle.js";
import { unzipSync } from "../vendor/fflate.browser.js";

const GH_OWNER = "cryptspeak";
const GH_REPO = "csCardputer";
const CHIP_FAMILY = "ESP32-S3";
const FLASH_BAUD = 460800;

// GitHub doesn't put a CORS header on release assets, so they can't be
// fetched directly from another origin. The firmware repo's CI also
// mirrors each release zip to its GitHub Pages site, which does serve
// with CORS enabled, so fetch it from there instead.
const PAGES_BASE = `https://${GH_OWNER}.github.io/${GH_REPO}`;

const releaseInfoEl = document.getElementById("release-info");
const unsupportedEl = document.getElementById("unsupported");
const flashBtn = document.getElementById("flash-btn");
const progressEl = document.getElementById("progress");
const eraseToggle = document.getElementById("erase-toggle");
const logEl = document.getElementById("log");
const manualLinkEl = document.getElementById("manual-link");

const terminal = {
  clean() {
    logEl.textContent = "";
  },
  writeLine(data) {
    logEl.textContent += data + "\n";
    logEl.scrollTop = logEl.scrollHeight;
  },
  write(data) {
    logEl.textContent += data;
    logEl.scrollTop = logEl.scrollHeight;
  },
};

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function loadFirmware() {
  releaseInfoEl.textContent = "Checking latest release...";

  const releasesRes = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/releases`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!releasesRes.ok) {
    if (releasesRes.status === 403 && releasesRes.headers.get("x-ratelimit-remaining") === "0") {
      throw new Error("GitHub API rate limit hit, try again in a few minutes");
    }
    throw new Error(`GitHub API error (${releasesRes.status})`);
  }
  const releases = await releasesRes.json();
  const release = releases[0];
  if (!release) throw new Error("No releases found on the firmware repo");

  const asset = release.assets.find((a) => a.name.endsWith(".zip"));
  if (!asset) throw new Error(`Release ${release.tag_name} has no firmware zip asset`);
  const expectedDigest = (asset.digest || "").replace(/^sha256:/, "").toLowerCase();

  manualLinkEl.href = asset.browser_download_url;
  manualLinkEl.textContent = `Get ${asset.name} from GitHub`;

  const label = `${release.tag_name}${release.prerelease ? " (pre-release)" : ""}`;
  releaseInfoEl.textContent = `Firmware ${label}, fetching ${asset.name}...`;

  const pagesUrl = `${PAGES_BASE}/${asset.name}`;
  const zipRes = await fetch(pagesUrl);
  if (!zipRes.ok) {
    throw new Error(`Couldn't fetch the firmware (${zipRes.status}). Use the download link below instead.`);
  }
  const zipBytes = new Uint8Array(await zipRes.arrayBuffer());

  if (expectedDigest) {
    const actualDigest = await sha256Hex(zipBytes);
    if (actualDigest !== expectedDigest) {
      throw new Error("Checksum mismatch on the downloaded firmware, not flashing it");
    }
  }

  const files = unzipSync(zipBytes);
  const manifestBytes = files["manifest.json"];
  if (!manifestBytes) throw new Error("manifest.json missing from firmware package");
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  if (manifest.chipFamily !== CHIP_FAMILY) {
    throw new Error(`Unexpected chip family in manifest: ${manifest.chipFamily}`);
  }

  const part = manifest.parts[0];
  const binBytes = files[part.path];
  if (!binBytes) throw new Error(`Firmware image ${part.path} missing from package`);

  releaseInfoEl.textContent = `Firmware ${label} ready to flash.`;

  return {
    binBytes,
    offset: parseInt(part.offset, 16),
    flashMode: manifest.flashMode,
    flashFreq: manifest.flashFreq,
    flashSize: manifest.flashSize,
    label,
  };
}

function onBeforeUnload(event) {
  event.preventDefault();
  event.returnValue = "";
}

async function flash() {
  flashBtn.disabled = true;
  terminal.clean();
  progressEl.hidden = true;
  progressEl.value = 0;
  window.addEventListener("beforeunload", onBeforeUnload);

  let transport;
  try {
    // Request the port first, before any awaited network calls, so the
    // click that triggered this still counts as user activation for it.
    const port = await navigator.serial.requestPort();
    transport = new Transport(port, true);

    const firmware = await loadFirmware();

    const esploader = new ESPLoader({ transport, baudrate: FLASH_BAUD, terminal });

    terminal.writeLine("Connecting...");
    const chip = await esploader.main();
    terminal.writeLine(`Connected: ${chip}`);

    const eraseAll = eraseToggle.checked;
    terminal.writeLine(`${eraseAll ? "Erasing all data and flashing" : "Flashing"} Cryptspeak ${firmware.label}...`);

    progressEl.hidden = false;
    await esploader.writeFlash({
      fileArray: [{ data: firmware.binBytes, address: firmware.offset }],
      flashMode: firmware.flashMode,
      flashFreq: firmware.flashFreq,
      flashSize: firmware.flashSize,
      eraseAll,
      compress: true,
      reportProgress: (_fileIndex, written, total) => {
        progressEl.value = Math.round((written / total) * 100);
      },
    });

    terminal.writeLine("Resetting device...");
    await esploader.after("hard_reset");
    await transport.disconnect();
    terminal.writeLine("Done. Cryptspeak is now running on your Cardputer.");
  } catch (err) {
    terminal.writeLine(`Error: ${err.message}`);
    if (transport) {
      try {
        await transport.disconnect();
      } catch {
        // already gone
      }
    }
  } finally {
    window.removeEventListener("beforeunload", onBeforeUnload);
    flashBtn.disabled = false;
  }
}

if (!("serial" in navigator)) {
  unsupportedEl.hidden = false;
  flashBtn.disabled = true;
} else {
  releaseInfoEl.textContent = "Click \"Connect & Flash\" to fetch, verify, and flash the latest firmware.";
  flashBtn.addEventListener("click", flash);
}
