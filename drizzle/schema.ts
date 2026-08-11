import { int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Art opening events table
export const events = mysqlTable("events", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 512 }).notNull(),
  galleryName: varchar("galleryName", { length: 255 }).notNull(),
  address: text("address").notNull(),
  openingDate: varchar("openingDate", { length: 255 }).notNull(),
  endDate: varchar("endDate", { length: 255 }),
  openingTime: varchar("openingTime", { length: 255 }),
  bodyText: text("bodyText"),
  imageUrl: text("imageUrl"),
  lat: varchar("lat", { length: 32 }),
  lng: varchar("lng", { length: 32 }),
  galleryWebsite: varchar("galleryWebsite", { length: 512 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Event = typeof events.$inferSelect;
export type InsertEvent = typeof events.$inferInsert;

// One gallery favorite per device. Device identifiers are generated locally and
// allow community totals without requiring an account sign-in flow.
export const galleryFavorites = mysqlTable(
  "gallery_favorite",
  {
    id: int("id").autoincrement().primaryKey(),
    galleryName: varchar("galleryName", { length: 255 }).notNull(),
    deviceId: varchar("deviceId", { length: 64 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("gallery_favorites_gallery_device_unique").on(table.galleryName, table.deviceId)],
);

export type GalleryFavorite = typeof galleryFavorites.$inferSelect;

// One 1–5 rating per device and opening. Updating a rating overwrites that
// device's previous score so community totals are not inflated by re-rating.
export const eventRatings = mysqlTable(
  "event_ratings",
  {
    id: int("id").autoincrement().primaryKey(),
    eventId: int("eventId").notNull(),
    deviceId: varchar("deviceId", { length: 64 }).notNull(),
    rating: int("rating").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [uniqueIndex("event_ratings_event_device_unique").on(table.eventId, table.deviceId)],
);

export type EventRating = typeof eventRatings.$inferSelect;
