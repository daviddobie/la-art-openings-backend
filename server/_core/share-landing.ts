import { Request, Response } from "express";
import { ItineraryItem } from "../../lib/itinerary-context";
import { getSharedItinerary } from "./share-storage";

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
  // Filter items that have locations
  const locationsWithItems = items.filter(item => item.location);

  if (locationsWithItems.length === 0) {
    return "https://www.google.com/maps";
  }

  if (locationsWithItems.length === 1) {
    // Single location - just search for it
    return `https://www.google.com/maps/search/${encodeURIComponent(locationsWithItems[0].location!)}`;
  }

  // Multiple locations - use standard Google Maps directions format
  // Format: https://www.google.com/maps/dir/address1/address2/address3/...
  // This format works on both desktop and mobile
  const encodeForGoogleMaps = (address: string): string => {
    return encodeURIComponent(address).replace(/%20/g, "+");
  };

  const addressParts = locationsWithItems
    .map(item => encodeForGoogleMaps(item.location!))
    .join("/");
  return `https://www.google.com/maps/dir/${addressParts}`;
}

/**
 * Generate Google Maps URL for a single location
 */
function generateSingleLocationMapsUrl(location: string): string {
  return `https://www.google.com/maps/search/${encodeURIComponent(location)}`;
}

/**
 * Generate HTML for a share code landing page
 */
function generateShareCodeHTML(items: ItineraryItem[]): string {
  const multiStopUrl = generateMultiStopMapsUrl(items);

  const itemsHTML = items
    .map(
      (item, index) => `
    <div class="itinerary-item">
      <div class="item-number">${index + 1}</div>
      <div class="item-content">
        <h3>${item.title}</h3>
        ${
          item.location
            ? `
          <p class="location">
            <span class="icon">📍</span>
            <span>${item.location}</span>
          </p>
        `
            : ""
        }
        ${item.time ? `<p class="time"><span class="icon">🕐</span> ${item.time}</p>` : ""}
        ${item.notes ? `<p class="notes">${item.notes}</p>` : ""}
      </div>
    </div>
  `
    )
    .join("");

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta name="apple-mobile-web-app-capable" content="yes">
      <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
      <title>LA Art Openings - Shared Itinerary</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        html, body {
          height: 100%;
        }
        
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          padding: 16px;
          display: flex;
          flex-direction: column;
        }
        
        .container {
          max-width: 600px;
          margin: 0 auto;
          flex: 1;
          display: flex;
          flex-direction: column;
        }
        
        .header {
          background: white;
          padding: 24px;
          border-radius: 16px;
          margin-bottom: 20px;
          text-align: center;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
        }
        
        .header h1 {
          font-size: 32px;
          margin-bottom: 8px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        
        .header p {
          color: #666;
          font-size: 14px;
        }
        
        .itinerary {
          background: white;
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
          flex: 1;
          display: flex;
          flex-direction: column;
        }
        
        .itinerary-items {
          flex: 1;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
        }
        
        .itinerary-item {
          display: flex;
          gap: 16px;
          padding: 16px;
          border-bottom: 1px solid #f0f0f0;
          align-items: flex-start;
        }
        
        .itinerary-item:last-child {
          border-bottom: none;
        }
        
        .item-number {
          min-width: 32px;
          width: 32px;
          height: 32px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 600;
          font-size: 14px;
          flex-shrink: 0;
        }
        
        .item-content {
          flex: 1;
          min-width: 0;
        }
        
        .item-content h3 {
          font-size: 16px;
          margin-bottom: 8px;
          color: #333;
          word-break: break-word;
        }
        
        .item-content p {
          margin: 6px 0;
          color: #666;
          font-size: 14px;
          display: flex;
          align-items: center;
          gap: 8px;
          word-break: break-word;
        }
        
        .icon {
          display: inline-block;
          min-width: 20px;
          text-align: center;
        }
        
        .notes {
          margin-top: 8px !important;
          padding: 8px 12px;
          background: #f5f5f5;
          border-radius: 6px;
          color: #555;
          font-size: 13px;
          border-left: 3px solid #667eea;
        }
        
        .footer {
          padding: 16px;
          background: white;
          border-top: 1px solid #f0f0f0;
          display: flex;
          gap: 12px;
        }
        
        .maps-button {
          flex: 1;
          padding: 14px 16px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: all 0.2s;
          text-align: center;
        }
        
        .maps-button:active {
          transform: scale(0.98);
          opacity: 0.9;
        }
        
        .empty-state {
          text-align: center;
          padding: 40px 20px;
          color: #999;
        }
        
        .empty-state h2 {
          font-size: 20px;
          margin-bottom: 12px;
          color: #333;
        }
        
        .empty-state p {
          color: #666;
          font-size: 14px;
        }
        
        @media (max-width: 480px) {
          .header {
            padding: 16px;
          }
          
          .header h1 {
            font-size: 24px;
          }
          
          .itinerary-item {
            padding: 12px;
          }
          
          .item-content h3 {
            font-size: 15px;
          }
          
          .item-content p {
            font-size: 13px;
          }
          
          .footer {
            padding: 12px;
          }
          
          .maps-button {
            font-size: 14px;
            padding: 12px 14px;
          }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>LA Art Openings</h1>
          <p>Shared Itinerary</p>
        </div>
        ${
          items.length > 0
            ? `
          <div class="itinerary">
            <div class="itinerary-items">
              ${itemsHTML}
            </div>
            <div class="footer">
              <a href="${multiStopUrl}" target="_blank" class="maps-button">
                🗺️ View All in Google Maps
              </a>
            </div>
          </div>
        `
            : `
          <div class="itinerary">
            <div class="empty-state">
              <h2>No items in this itinerary</h2>
              <p>The shared itinerary appears to be empty.</p>
            </div>
          </div>
        `
        }
      </div>
    </body>
    </html>
  `;
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
          `<html><body style="font-family: sans-serif; text-align: center; padding: 40px;">
            <h1>Shared itinerary not found or expired</h1>
            <p>The link may have expired. Please ask for a new share link.</p>
          </body></html>`
        );
      }

      const html = generateShareCodeHTML(items);
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
          `<html><body style="font-family: sans-serif; text-align: center; padding: 40px;">
            <h1>Invalid share link</h1>
            <p>No itinerary data provided.</p>
          </body></html>`
        );
      }

      const items = decodeItinerary(data);

      if (items.length === 0) {
        return res.status(400).send(
          `<html><body style="font-family: sans-serif; text-align: center; padding: 40px;">
            <h1>Invalid share link</h1>
            <p>Could not decode itinerary data.</p>
          </body></html>`
        );
      }

      const html = generateShareCodeHTML(items);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch (error) {
      console.error("[share-landing] Error handling legacy share:", error);
      res.status(500).send("<h1>Error loading shared itinerary</h1>");
    }
  });
}
