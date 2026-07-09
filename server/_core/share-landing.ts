import { Request, Response } from "express";
import { ItineraryItem } from "../../lib/itinerary-context";
import { getSharedItinerary } from "./share-storage";

const APP_STORE_URL =
  "https://apps.apple.com/us/app/los-angeles-art-gallery-guide/id6781113154";
const APP_SCHEME = "manus20260411181801";

/**
 * Decode itinerary items from a shareable format
 */
function decodeItinerary(encoded: string): ItineraryItem[] {
  try {
    const json = Buffer.from(encoded, "base64").toString("utf-8");
    const items = JSON.parse(json) as ItineraryItem[];
    return Array.isArray(items) ? items : [];
  } catch (error) {
    console.error("Failed to decode itinerary:", error);
    return [];
  }
}

/**
 * Generate Google Maps URL for multiple locations (multi-stop itinerary)
 */
function generateMultiStopMapsUrl(items: ItineraryItem[]): string {
  const locationsWithItems = items.filter((item) => item.location);

  if (locationsWithItems.length === 0) {
    return "https://www.google.com/maps";
  }

  if (locationsWithItems.length === 1) {
    return `https://www.google.com/maps/search/${encodeURIComponent(locationsWithItems[0].location!)}`;
  }

  const encodeForGoogleMaps = (address: string): string =>
    encodeURIComponent(address).replace(/%20/g, "+");

  const addressParts = locationsWithItems
    .map((item) => encodeForGoogleMaps(item.location!))
    .join("/");
  return `https://www.google.com/maps/dir/${addressParts}`;
}

/**
 * Generate HTML for a share code landing page.
 *
 * Smart-link behaviour:
 *  1. Page loads → JS immediately fires the custom-scheme deep link
 *     (manus20260411181801://share/<code>).  If the app is installed iOS
 *     intercepts it and opens the itinerary; the browser tab goes to the
 *     background and the timer below never fires.
 *  2. After 1 600 ms, if the tab is still visible (app not installed or
 *     user is on Android/desktop), redirect to the App Store.
 *  3. The itinerary preview is always rendered so the user can read it
 *     while the redirect is happening.
 */
function generateShareCodeHTML(items: ItineraryItem[], code: string): string {
  const multiStopUrl = generateMultiStopMapsUrl(items);
  const deepLink = `${APP_SCHEME}://share/${code}`;

  const itemsHTML = items
    .map(
      (item, index) => `
    <div class="itinerary-item">
      <div class="item-number">${index + 1}</div>
      <div class="item-content">
        <h3>${escapeHtml(item.title)}</h3>
        ${
          item.location
            ? `<p class="location"><span class="icon">📍</span><span>${escapeHtml(item.location)}</span></p>`
            : ""
        }
        ${item.time ? `<p class="time"><span class="icon">🕐</span> ${escapeHtml(item.time)}</p>` : ""}
        ${item.notes ? `<p class="notes">${escapeHtml(item.notes)}</p>` : ""}
      </div>
    </div>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>LA Art Openings — Shared Itinerary</title>

  <!-- Open Graph / iMessage rich link preview -->
  <meta property="og:type" content="website">
  <meta property="og:title" content="LA Art Openings Itinerary">
  <meta property="og:description" content="${items.length} stop${items.length !== 1 ? "s" : ""}: ${escapeHtml(items.slice(0, 3).map((i) => i.title).join(", "))}${items.length > 3 ? "…" : ""}">
  <meta property="og:image" content="https://web-production-41356.up.railway.app/app-icon.png">
  <meta property="og:image:width" content="512">
  <meta property="og:image:height" content="512">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="LA Art Openings Itinerary">
  <meta name="twitter:description" content="${items.length} stop${items.length !== 1 ? "s" : ""}: ${escapeHtml(items.slice(0, 3).map((i) => i.title).join(", "))}${items.length > 3 ? "…" : ""}">
  <meta name="twitter:image" content="https://web-production-41356.up.railway.app/app-icon.png">

  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 16px;
      display: flex;
      flex-direction: column;
    }
    .container { max-width: 600px; margin: 0 auto; flex: 1; display: flex; flex-direction: column; }

    /* ── Smart-link banner ── */
    .smart-banner {
      background: white;
      border-radius: 16px;
      padding: 20px 24px;
      margin-bottom: 16px;
      text-align: center;
      box-shadow: 0 8px 32px rgba(0,0,0,0.12);
    }
    .smart-banner h2 { font-size: 18px; color: #333; margin-bottom: 6px; }
    .smart-banner p  { font-size: 14px; color: #666; margin-bottom: 16px; line-height: 1.5; }
    .btn-open-app {
      display: inline-block;
      padding: 14px 28px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 700;
      text-decoration: none;
      cursor: pointer;
      border: none;
      width: 100%;
      transition: opacity 0.2s;
    }
    .btn-open-app:active { opacity: 0.85; }
    .btn-store {
      display: inline-block;
      margin-top: 10px;
      padding: 10px 20px;
      background: #000;
      color: white;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      text-decoration: none;
      width: 100%;
      transition: opacity 0.2s;
    }
    .btn-store:active { opacity: 0.8; }
    .status-msg { font-size: 13px; color: #888; margin-top: 10px; min-height: 18px; }

    /* ── Header ── */
    .header {
      background: white;
      padding: 20px 24px;
      border-radius: 16px;
      margin-bottom: 16px;
      text-align: center;
      box-shadow: 0 8px 32px rgba(0,0,0,0.1);
    }
    .header h1 {
      font-size: 28px;
      margin-bottom: 4px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .header p { color: #666; font-size: 13px; }

    /* ── Itinerary list ── */
    .itinerary {
      background: white;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(0,0,0,0.1);
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    .itinerary-items { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; }
    .itinerary-item {
      display: flex;
      gap: 16px;
      padding: 16px;
      border-bottom: 1px solid #f0f0f0;
      align-items: flex-start;
    }
    .itinerary-item:last-child { border-bottom: none; }
    .item-number {
      min-width: 32px; width: 32px; height: 32px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-weight: 600; font-size: 14px; flex-shrink: 0;
    }
    .item-content { flex: 1; min-width: 0; }
    .item-content h3 { font-size: 16px; margin-bottom: 6px; color: #333; word-break: break-word; }
    .item-content p  { margin: 4px 0; color: #666; font-size: 14px; display: flex; align-items: center; gap: 8px; word-break: break-word; }
    .icon { display: inline-block; min-width: 20px; text-align: center; }
    .notes {
      margin-top: 6px !important;
      padding: 8px 12px;
      background: #f5f5f5;
      border-radius: 6px;
      color: #555;
      font-size: 13px;
      border-left: 3px solid #667eea;
    }
    .footer {
      padding: 14px 16px;
      background: white;
      border-top: 1px solid #f0f0f0;
      display: flex;
      gap: 12px;
    }
    .maps-button {
      flex: 1;
      padding: 13px 16px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: opacity 0.2s;
      text-align: center;
    }
    .maps-button:active { opacity: 0.85; }
    .empty-state { text-align: center; padding: 40px 20px; color: #999; }
    .empty-state h2 { font-size: 20px; margin-bottom: 12px; color: #333; }
    .empty-state p  { color: #666; font-size: 14px; }

    @media (max-width: 480px) {
      .header { padding: 14px 16px; }
      .header h1 { font-size: 22px; }
      .itinerary-item { padding: 12px; }
      .item-content h3 { font-size: 15px; }
      .item-content p  { font-size: 13px; }
      .footer { padding: 10px 12px; }
      .maps-button { font-size: 14px; padding: 11px 12px; }
    }
  </style>
</head>
<body>
  <div class="container">

    <!-- Smart-link banner -->
    <div class="smart-banner">
      <h2>LA Art Openings</h2>
      <p>Someone shared an itinerary with you.<br>Open it in the app to add it to your own itinerary.</p>
      <button class="btn-open-app" onclick="tryOpenApp()">📱 Open in App</button>
      <a href="${APP_STORE_URL}" class="btn-store">⬇️ Download on the App Store</a>
      <p class="status-msg" id="status"></p>
    </div>

    <!-- Itinerary preview -->
    <div class="header">
      <h1>Shared Itinerary</h1>
      <p>${items.length} stop${items.length !== 1 ? "s" : ""}</p>
    </div>

    ${
      items.length > 0
        ? `<div class="itinerary">
        <div class="itinerary-items">${itemsHTML}</div>
        <div class="footer">
          <a href="${multiStopUrl}" target="_blank" class="maps-button">🗺️ View All in Google Maps</a>
        </div>
      </div>`
        : `<div class="itinerary">
        <div class="empty-state">
          <h2>No items in this itinerary</h2>
          <p>The shared itinerary appears to be empty.</p>
        </div>
      </div>`
    }

  </div>

  <script>
    var DEEP_LINK   = ${JSON.stringify(deepLink)};
    var STORE_URL   = ${JSON.stringify(APP_STORE_URL)};
    var redirectTimer = null;

    function tryOpenApp() {
      var status = document.getElementById('status');
      status.textContent = 'Opening app…';

      // Attempt to open the custom-scheme deep link.
      // If the app is installed iOS will intercept it; the page stays in the
      // background and the timer below is paused/cancelled by the OS.
      window.location.href = DEEP_LINK;

      // If we're still here after 1 600 ms the app isn't installed.
      redirectTimer = setTimeout(function () {
        // Only redirect if the tab is still visible (user hasn't switched away)
        if (!document.hidden) {
          status.textContent = 'App not found — opening App Store…';
          window.location.href = STORE_URL;
        }
      }, 1600);
    }

    // Cancel the timer if the user manually leaves the page
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && redirectTimer) {
        clearTimeout(redirectTimer);
        redirectTimer = null;
      }
    });

    // On iOS Safari, auto-attempt the deep link on load so tapping the
    // iMessage link card opens the app without an extra button tap.
    // We wrap in a tiny delay so the page has rendered first.
    var isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (isIOS) {
      setTimeout(tryOpenApp, 300);
    }
  </script>
</body>
</html>`;
}

/** Minimal HTML-escape to prevent XSS in user-supplied strings */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Handle share landing page requests
 * GET /share/:code (new share code format)
 */
export function registerShareLandingRoute(app: any, scheme: string) {
  // New route: /share/:code (share code format)
  app.get("/share/:code", (req: Request, res: Response) => {
    try {
      const { code } = req.params;
      console.log("[share-landing] Handling share code:", code);

      const items = getSharedItinerary(code);

      if (!items) {
        console.warn("[share-landing] Share not found or expired:", code);
        return res.status(404).send(
          `<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:40px;">
            <h1>Shared itinerary not found or expired</h1>
            <p>The link may have expired (links last 7 days). Please ask for a new share link.</p>
            <a href="${APP_STORE_URL}" style="display:inline-block;margin-top:20px;padding:12px 24px;background:#000;color:#fff;border-radius:10px;text-decoration:none;font-weight:600;">Download the App</a>
          </body></html>`
        );
      }

      const html = generateShareCodeHTML(items, code);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch (error) {
      console.error("[share-landing] Error handling share code:", error);
      res.status(500).send("<h1>Error loading shared itinerary</h1>");
    }
  });

  // Legacy route: /share?data=encoded_data
  app.get("/share", (req: Request, res: Response) => {
    try {
      const { data } = req.query;

      if (!data || typeof data !== "string") {
        return res.status(400).send(
          `<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:40px;">
            <h1>Invalid share link</h1>
            <p>No itinerary data provided.</p>
          </body></html>`
        );
      }

      const items = decodeItinerary(data);

      if (items.length === 0) {
        return res.status(400).send(
          `<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:40px;">
            <h1>Invalid share link</h1>
            <p>Could not decode itinerary data.</p>
          </body></html>`
        );
      }

      // For legacy links we don't have a share code, so use a placeholder
      // that still shows the preview + App Store button.
      const html = generateShareCodeHTML(items, "legacy");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch (error) {
      console.error("[share-landing] Error handling legacy share:", error);
      res.status(500).send("<h1>Error loading shared itinerary</h1>");
    }
  });
}
