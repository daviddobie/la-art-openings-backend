import { eq, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, events, InsertEvent } from "../drizzle/schema";
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

/** Normalise a string for fuzzy comparison: lowercase, strip punctuation/extra spaces */
function normalise(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract just the street number + first word of street name from an address */
function addressKey(addr: string): string {
  const m = addr.match(/(\d+)\s+([a-zA-Z]+)/);
  return m ? `${m[1]} ${m[2].toLowerCase()}` : normalise(addr).slice(0, 20);
}

/** Normalise a date string to YYYY-MM-DD or a comparable token */
function dateKey(d: string): string {
  if (!d) return '';
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  // Try parsing common formats like "July 11, 2026" or "Jul. 11, 2026"
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
  };
  const m = d.match(/([a-zA-Z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/);
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
 * Check if a near-duplicate of this event already exists.
 *
 * Skip if:
 *   - gallery name + date + address all match (exact fuzzy), regardless of title
 *   - gallery name + date + address all match AND titles are similar
 */
export async function findDuplicateEvent(
  galleryName: string,
  openingDate: string,
  address: string,
  title: string
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const all = await db.select({
    galleryName: events.galleryName,
    openingDate: events.openingDate,
    address: events.address,
    title: events.title,
  }).from(events);

  const inGallery = normalise(galleryName);
  const inDate = dateKey(openingDate);
  const inAddr = addressKey(address);

  return all.some(row => {
    const sameGallery = normalise(row.galleryName) === inGallery;
    const sameDate = dateKey(row.openingDate) === inDate && inDate !== '';
    const sameAddr = addressKey(row.address) === inAddr && inAddr.length > 3;
    // All three hard signals match → always a duplicate
    if (sameGallery && sameDate && sameAddr) return true;
    // Gallery + date match AND titles are similar → duplicate
    if (sameGallery && sameDate && similarTitle(row.title, title)) return true;
    // Gallery + address match AND titles are similar → duplicate
    if (sameGallery && sameAddr && similarTitle(row.title, title)) return true;
    return false;
  });
}

export async function createEvent(data: InsertEvent) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(events).values(data);
  return (result as any).insertId as number;
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
