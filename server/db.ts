import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  eventRatings,
  events,
  galleryFavorites,
  InsertEvent,
  InsertUser,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// TODO: add feature queries here as your schema grows.

export async function getAllEvents() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(events).orderBy(desc(events.createdAt));
}

export type CommunityStats = {
  galleries: Array<{ galleryName: string; favoriteCount: number; isFavorited: boolean }>;
  events: Array<{ eventId: number; ratingAverage: number; ratingCount: number; myRating: number | null }>;
};

export async function getCommunityStats(
  galleryNames: string[],
  eventIds: number[],
  deviceId: string,
): Promise<CommunityStats> {
  const db = await getDb();
  const uniqueGalleryNames = [...new Set(galleryNames.filter(Boolean))];
  const uniqueEventIds = [...new Set(eventIds.filter((id) => Number.isInteger(id) && id > 0))];

  if (!db) {
    return {
      galleries: uniqueGalleryNames.map((galleryName) => ({ galleryName, favoriteCount: 0, isFavorited: false })),
      events: uniqueEventIds.map((eventId) => ({ eventId, ratingAverage: 0, ratingCount: 0, myRating: null })),
    };
  }

  const [favoriteRows, deviceFavoriteRows, ratingRows, deviceRatingRows] = await Promise.all([
    uniqueGalleryNames.length
      ? db
          .select({
            galleryName: galleryFavorites.galleryName,
            favoriteCount: sql<number>`count(*)`,
          })
          .from(galleryFavorites)
          .where(inArray(galleryFavorites.galleryName, uniqueGalleryNames))
          .groupBy(galleryFavorites.galleryName)
      : Promise.resolve([]),
    uniqueGalleryNames.length
      ? db
          .select({ galleryName: galleryFavorites.galleryName })
          .from(galleryFavorites)
          .where(and(inArray(galleryFavorites.galleryName, uniqueGalleryNames), eq(galleryFavorites.deviceId, deviceId)))
      : Promise.resolve([]),
    uniqueEventIds.length
      ? db
          .select({
            eventId: eventRatings.eventId,
            ratingCount: sql<number>`count(*)`,
            ratingAverage: sql<number>`coalesce(avg(${eventRatings.rating}), 0)`,
          })
          .from(eventRatings)
          .where(inArray(eventRatings.eventId, uniqueEventIds))
          .groupBy(eventRatings.eventId)
      : Promise.resolve([]),
    uniqueEventIds.length
      ? db
          .select({ eventId: eventRatings.eventId, rating: eventRatings.rating })
          .from(eventRatings)
          .where(and(inArray(eventRatings.eventId, uniqueEventIds), eq(eventRatings.deviceId, deviceId)))
      : Promise.resolve([]),
  ]);

  const favoriteCountByGallery = new Map(favoriteRows.map((row) => [row.galleryName, Number(row.favoriteCount)]));
  const favoritedGalleryNames = new Set(deviceFavoriteRows.map((row) => row.galleryName));
  const ratingByEvent = new Map(
    ratingRows.map((row) => [
      row.eventId,
      { ratingCount: Number(row.ratingCount), ratingAverage: Number(row.ratingAverage) },
    ]),
  );
  const myRatingByEvent = new Map(deviceRatingRows.map((row) => [row.eventId, row.rating]));

  return {
    galleries: uniqueGalleryNames.map((galleryName) => ({
      galleryName,
      favoriteCount: favoriteCountByGallery.get(galleryName) ?? 0,
      isFavorited: favoritedGalleryNames.has(galleryName),
    })),
    events: uniqueEventIds.map((eventId) => ({
      eventId,
      ratingCount: ratingByEvent.get(eventId)?.ratingCount ?? 0,
      ratingAverage: ratingByEvent.get(eventId)?.ratingAverage ?? 0,
      myRating: myRatingByEvent.get(eventId) ?? null,
    })),
  };
}

export async function setGalleryFavorite(galleryName: string, deviceId: string, favorite: boolean) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (!favorite) {
    await db
      .delete(galleryFavorites)
      .where(and(eq(galleryFavorites.galleryName, galleryName), eq(galleryFavorites.deviceId, deviceId)));
    return;
  }

  const existing = await db
    .select({ id: galleryFavorites.id })
    .from(galleryFavorites)
    .where(and(eq(galleryFavorites.galleryName, galleryName), eq(galleryFavorites.deviceId, deviceId)))
    .limit(1);
  if (existing.length > 0) return;

  await db
    .insert(galleryFavorites)
    .values({ galleryName, deviceId, createdAt: new Date() });
}

export async function setEventRating(eventId: number, deviceId: string, rating: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const now = new Date();
  const existing = await db
    .select({ id: eventRatings.id })
    .from(eventRatings)
    .where(and(eq(eventRatings.eventId, eventId), eq(eventRatings.deviceId, deviceId)))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(eventRatings)
      .set({ rating, updatedAt: now })
      .where(eq(eventRatings.id, existing[0].id));
    return;
  }

  await db
    .insert(eventRatings)
    .values({ eventId, deviceId, rating, createdAt: now, updatedAt: now });
}

/** Normalise a string for fuzzy comparison: lowercase, strip punctuation/extra spaces */
function normalise(s: string): string {
  return (s || '')
    // Decompose accented characters (e.g. ö → o + combining diaeresis) then strip combining marks
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalise a gallery name: strip location suffixes like "| Los Angeles", "- LA",
 * "Los Angeles", "· Los Angeles" that different sources append after the real name.
 */
function galleryKey(name: string): string {
  return normalise(
    (name || '')
      // Remove pipe/dash/dot separators followed by city names
      .replace(/[|·\-–—]\s*(los angeles|la|west hollywood|culver city|santa monica|hollywood|dtla|downtown)\s*$/i, '')
      // Remove trailing city names without separator
      .replace(/\s+(los angeles|west hollywood|culver city|santa monica)\s*$/i, '')
  );
}

// Generic words that appear in many gallery names and should not count as a match signal
const GALLERY_STOP_WORDS = new Set(['gallery', 'art', 'space', 'studio', 'studios', 'projects', 'project', 'contemporary', 'fine', 'arts', 'center', 'centre', 'house', 'room', 'works', 'the', 'of', 'and', 'at', 'in']);

/** Returns true if two gallery names refer to the same gallery */
function sameGallery(a: string, b: string): boolean {
  const ka = galleryKey(a);
  const kb = galleryKey(b);
  if (ka === kb) return true;
  // One is a prefix of the other
  if (ka.startsWith(kb) || kb.startsWith(ka)) return true;
  // Word-overlap: extract meaningful (non-stop) words and check if they share enough
  const wordsA = ka.split(' ').filter(w => w.length > 2 && !GALLERY_STOP_WORDS.has(w));
  const wordsB = new Set(kb.split(' ').filter(w => w.length > 2 && !GALLERY_STOP_WORDS.has(w)));
  if (wordsA.length === 0 || wordsB.size === 0) return false;
  const shared = wordsA.filter(w => wordsB.has(w)).length;
  // Require ALL meaningful words from the shorter name to appear in the longer name
  const minLen = Math.min(wordsA.length, wordsB.size);
  return shared >= minLen && minLen >= 1;
}

/** Common street-direction and type abbreviations used in LA addresses */
function expandStreetAbbreviations(addr: string): string {
  return addr
    // Direction abbreviations (word-boundary safe)
    .replace(/\bN\.?\b/gi, 'North')
    .replace(/\bS\.?\b/gi, 'South')
    .replace(/\bE\.?\b/gi, 'East')
    .replace(/\bW\.?\b/gi, 'West')
    // Street type abbreviations
    .replace(/\bBlvd\.?\b/gi, 'Boulevard')
    .replace(/\bAve\.?\b/gi, 'Avenue')
    .replace(/\bSt\.?\b/gi, 'Street')
    .replace(/\bDr\.?\b/gi, 'Drive')
    .replace(/\bRd\.?\b/gi, 'Road')
    .replace(/\bPl\.?\b/gi, 'Place')
    .replace(/\bCt\.?\b/gi, 'Court')
    .replace(/\bLn\.?\b/gi, 'Lane');
}

/** Extract just the street number + first word of street name from an address */
function addressKey(addr: string): string {
  const expanded = expandStreetAbbreviations(addr);
  const m = expanded.match(/(\d+)\s+([a-zA-Z]+)/);
  return m ? `${m[1]} ${m[2].toLowerCase()}` : normalise(expanded).slice(0, 20);
}

/** Normalise a date string to YYYY-MM-DD or a comparable token */
function dateKey(d: string): string {
  if (!d) return '';
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  // Strip leading day-of-week (e.g. "Thursday, July 3, 2026 at 5:00 PM" → "July 3, 2026")
  const stripped = d.replace(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s*/i, '')
                    .replace(/\s+at\s+\d{1,2}:\d{2}.*$/i, '')  // strip " at 5:00 PM"
                    .replace(/\s+\d{1,2}:\d{2}.*$/i, '');       // strip bare time
  // Try parsing common formats like "July 11, 2026" or "Jul. 11, 2026"
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
  };
  const m = stripped.match(/([a-zA-Z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const mon = months[m[1].toLowerCase().slice(0, 3)] || '00';
    return `${m[3]}-${mon}-${m[2].padStart(2, '0')}`;
  }
  return normalise(d).slice(0, 10);
}

/** Returns true if two titles are similar: one contains the other, or they share ≥60% of words */
function similarTitle(a: string, b: string): boolean {
  if (!a || !b) return false;
  const na = normalise(a);
  const nb = normalise(b);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const wa = new Set(na.split(' ').filter(w => w.length > 2));
  const wb = nb.split(' ').filter(w => w.length > 2);
  if (wa.size === 0 || wb.length === 0) return false;
  const shared = wb.filter(w => wa.has(w)).length;
  return shared / Math.max(wa.size, wb.length) >= 0.6;
}

/**
 * Find a near-duplicate of this event.
 *
 * Returns the matching event's ID if found, or null.
 * Matches on:
 *   - gallery name + date + address all match (exact fuzzy), regardless of title
 *   - gallery name + date match AND titles are similar
 *   - gallery name + address match AND titles are similar
 */
export async function findDuplicateEvent(
  galleryName: string,
  openingDate: string,
  address: string,
  title: string
): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const all = await db.select({
    id: events.id,
    galleryName: events.galleryName,
    openingDate: events.openingDate,
    address: events.address,
    title: events.title,
  }).from(events);

  const inDate = dateKey(openingDate);
  const inAddr = addressKey(address);

  const match = all.find(row => {
    const galMatch = sameGallery(row.galleryName, galleryName);
    const sameDate = dateKey(row.openingDate) === inDate && inDate !== '';
    const sameAddr = addressKey(row.address) === inAddr && inAddr.length > 3;
    // All three hard signals match → always a duplicate
    if (galMatch && sameDate && sameAddr) return true;
    // Gallery + date match AND titles are similar → duplicate
    if (galMatch && sameDate && similarTitle(row.title, title)) return true;
    // Gallery + address match AND titles are similar → duplicate
    if (galMatch && sameAddr && similarTitle(row.title, title)) return true;
    return false;
  });

  return match ? match.id : null;
}

export async function createEvent(data: InsertEvent) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(events).values(data);
  return (result as any).insertId as number;
}

export async function getEventById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(events).where(eq(events.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function deleteEvent(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(events).where(eq(events.id, id));
}

export async function updateEvent(id: number, data: Partial<Omit<InsertEvent, 'id'>>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(events).set(data).where(eq(events.id, id));
}

export async function deleteAllEvents() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(events);
}

/**
 * Delete all events whose opening date is strictly before today (LA time).
 * openingDate is stored as YYYY-MM-DD, "Month D, YYYY", or similar text.
 * We fetch all events and filter in JS using the same extractDateString logic
 * to handle all stored formats consistently.
 */
export async function deleteExpiredEvents(): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Today in LA time (Pacific), formatted as YYYY-MM-DD
  // Use Intl.DateTimeFormat parts to safely get the LA date without relying on
  // toLocaleString() → new Date() round-trip which is unreliable on Node servers.
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const p: Record<string, string> = {};
  for (const { type, value } of parts) p[type] = value;
  const todayStr = `${p.year}-${p.month}-${p.day}`;

  // Fetch all events with their imageUrl so we can delete images when events expire
  const allEvents = await db.select({ id: events.id, openingDate: events.openingDate, imageUrl: events.imageUrl }).from(events);

  const expiredIds = allEvents
    .filter((ev) => {
      const d = ev.openingDate || "";
      // Already YYYY-MM-DD
      const isoMatch = d.match(/^(\d{4}-\d{2}-\d{2})/);
      if (isoMatch) return isoMatch[1] < todayStr;
      // Try to parse "Month D, YYYY" style
      const months: Record<string, string> = {
        january: "01", jan: "01", february: "02", feb: "02", march: "03", mar: "03",
        april: "04", apr: "04", may: "05", june: "06", jun: "06", july: "07", jul: "07",
        august: "08", aug: "08", september: "09", sep: "09", sept: "09",
        october: "10", oct: "10", november: "11", nov: "11", december: "12", dec: "12",
      };
      const m = d.replace(/\b([A-Za-z]+)\.(?=\s)/g, "$1").match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
      if (m) {
        const mon = months[m[1].toLowerCase()];
        if (mon) {
          const parsed = `${m[3]}-${mon}-${m[2].padStart(2, "0")}`;
          return parsed < todayStr;
        }
      }
      return false; // Can't parse — keep it
    })
    .map((ev) => ev.id);

  if (expiredIds.length === 0) return 0;

  // Get the expired events with their imageUrls before deleting
  const expiredEvents = allEvents.filter(ev => expiredIds.includes(ev.id));

  for (const event of expiredEvents) {
    // Delete image from GreenGeeks server if it exists
    if (event.imageUrl && event.imageUrl.includes('thelosangelesartgallery.com')) {
      try {
        // Extract filename from URL (e.g., "https://thelosangelesartgallery.com/images/12345.jpg" → "12345.jpg")
        const urlParts = event.imageUrl.split('/');
        const filename = urlParts[urlParts.length - 1];
        
        // Call image-delete.php on GreenGeeks server
        const deleteResponse = await fetch('https://thelosangelesartgallery.com/image-delete.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: filename,
            adminPassword: process.env.GREENGEEKS_ADMIN_PASSWORD || '',
          }),
        });
        
        if (deleteResponse.ok) {
          console.log(`[cleanup] Deleted image: ${filename}`);
        } else {
          console.warn(`[cleanup] Failed to delete image ${filename}: ${deleteResponse.status}`);
        }
      } catch (error) {
        console.error(`[cleanup] Error deleting image for event ${event.id}:`, error);
      }
    }
    
    // Delete event from database
    await db.delete(events).where(eq(events.id, event.id));
  }
  return expiredIds.length;
}
