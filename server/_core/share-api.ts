import { Request, Response } from "express";
import { storeSharedItinerary, getSharedItinerary } from "./share-storage";
import { ItineraryItem } from "../../lib/itinerary-context";

/**
 * POST /api/share
 * Create a new share code for an itinerary
 * Body: { items: ItineraryItem[] }
 * Returns: { code: string, url: string }
 */
export function handleCreateShare(req: Request, res: Response) {
  try {
    const { items } = req.body;
    console.log("[share-api] POST /api/share received", { itemsLength: Array.isArray(items) ? items.length : "not array", body: req.body });

    if (!Array.isArray(items) || items.length === 0) {
      console.error("[share-api] Invalid items array", { items });
      return res.status(400).json({ error: "Items array is required and must not be empty" });
    }

    const code = storeSharedItinerary(items);
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
    const httpsUrl = `${baseUrl}/share/${code}`;
    const deepLink = `manus20260411181801://share/${code}`;

    console.log("[share-api] Created share:", { code, httpsUrl, deepLink });

    res.json({
      code,
      url: httpsUrl,
      deepLink,
    });
  } catch (error) {
    console.error("Failed to create share:", error);
    res.status(500).json({ error: "Failed to create share" });
  }
}

/**
 * GET /api/share/:code
 * Retrieve a shared itinerary by code
 * Returns: { items: ItineraryItem[] } or 404
 */
export function handleGetShare(req: Request, res: Response) {
  try {
    const { code } = req.params;

    if (!code || typeof code !== "string") {
      return res.status(400).json({ error: "Share code is required" });
    }

    const items = getSharedItinerary(code);

    if (!items) {
      return res.status(404).json({ error: "Share not found or expired" });
    }

    res.json({ items });
  } catch (error) {
    console.error("Failed to get share:", error);
    res.status(500).json({ error: "Failed to get share" });
  }
}
