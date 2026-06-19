import { ItineraryItem } from "../../lib/itinerary-context";

/**
 * In-memory storage for shared itineraries
 * In production, this would be a database
 */
interface SharedItinerary {
  id: string;
  items: ItineraryItem[];
  createdAt: number;
  expiresAt: number;
}

const shareStorage = new Map<string, SharedItinerary>();

/**
 * Generate a short, unique share code
 */
function generateShareCode(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Store an itinerary and return a share code
 * @param items - Array of itinerary items
 * @param expirationHours - How many hours the link should be valid (default: 7 days)
 * @returns The share code
 */
export function storeSharedItinerary(items: ItineraryItem[], expirationHours: number = 168): string {
  let code = generateShareCode();
  
  // Make sure code is unique
  while (shareStorage.has(code)) {
    code = generateShareCode();
  }

  const now = Date.now();
  const expiresAt = now + expirationHours * 60 * 60 * 1000;

  shareStorage.set(code, {
    id: code,
    items,
    createdAt: now,
    expiresAt,
  });

  return code;
}

/**
 * Retrieve a shared itinerary by code
 * @param code - The share code
 * @returns The itinerary items or null if expired/not found
 */
export function getSharedItinerary(code: string): ItineraryItem[] | null {
  const shared = shareStorage.get(code);

  if (!shared) {
    return null;
  }

  // Check if expired
  if (Date.now() > shared.expiresAt) {
    shareStorage.delete(code);
    return null;
  }

  return shared.items;
}

/**
 * Delete a shared itinerary
 */
export function deleteSharedItinerary(code: string): boolean {
  return shareStorage.delete(code);
}

/**
 * Clean up expired shares (call periodically)
 */
export function cleanupExpiredShares(): number {
  const now = Date.now();
  let deleted = 0;

  for (const [code, shared] of shareStorage.entries()) {
    if (now > shared.expiresAt) {
      shareStorage.delete(code);
      deleted++;
    }
  }

  return deleted;
}

/**
 * Start periodic cleanup of expired shares
 */
export function startCleanupInterval(intervalHours: number = 24): ReturnType<typeof setInterval> {
  return setInterval(() => {
    const deleted = cleanupExpiredShares();
    if (deleted > 0) {
      console.log(`[share-storage] Cleaned up ${deleted} expired shares`);
    }
  }, intervalHours * 60 * 60 * 1000);
}
