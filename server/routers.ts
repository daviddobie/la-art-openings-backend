import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // Art opening events (replaces curate.la scraper)
  events: router({
    list: publicProcedure.query(async () => {
      const items = await db.getAllEvents();
      return { events: items };
    }),

    create: publicProcedure
      .input(
        z.object({
          title: z.string().min(1).max(512),
          galleryName: z.string().min(1).max(255),
          address: z.string().min(1),
          openingDate: z.string().min(1),
          endDate: z.string().optional(),
          openingTime: z.string().optional(),
          bodyText: z.string().optional(),
          imageUrl: z.string().optional(),
          lat: z.string().optional(),
          lng: z.string().optional(),
          adminPassword: z.string(),
        })
      )
      .mutation(async ({ input }) => {
        const adminPassword = process.env.ADMIN_PASSWORD || "laartadmin2024";
        if (input.adminPassword !== adminPassword) {
          throw new Error("Unauthorized");
        }
        const { adminPassword: _, ...eventData } = input;
        // Fuzzy duplicate check: same gallery + same opening date or same address
        const isDuplicate = await db.findDuplicateEvent(
          eventData.galleryName,
          eventData.openingDate,
          eventData.address,
          eventData.title
        );
        if (isDuplicate) {
          return { id: null, skipped: true };
        }
        const id = await db.createEvent(eventData);
        return { id, skipped: false };
      }),

    delete: publicProcedure
      .input(
        z.object({
          id: z.coerce.number().int().positive(),
          adminPassword: z.string(),
        })
      )
      .mutation(async ({ input }) => {
        const adminPassword = process.env.ADMIN_PASSWORD || "laartadmin2024";
        if (input.adminPassword !== adminPassword) {
          throw new Error("Unauthorized");
        }
        await db.deleteEvent(input.id);
        return { success: true };
      }),

    update: publicProcedure
      .input(
        z.object({
          id: z.coerce.number().int().positive(),
          title: z.string().min(1).max(512),
          galleryName: z.string().min(1).max(255),
          address: z.string().min(1),
          openingDate: z.string().min(1),
          endDate: z.string().optional(),
          openingTime: z.string().optional(),
          bodyText: z.string().optional(),
          imageUrl: z.string().optional(),
          adminPassword: z.string(),
        })
      )
      .mutation(async ({ input }) => {
        const adminPassword = process.env.ADMIN_PASSWORD || "laartadmin2024";
        if (input.adminPassword !== adminPassword) {
          throw new Error("Unauthorized");
        }
        const { adminPassword: _, id, ...eventData } = input;
        await db.updateEvent(id, eventData);
        return { success: true };
      }),

    cleanupPast: publicProcedure
      .input(z.object({ adminPassword: z.string() }))
      .mutation(async ({ input }) => {
        const adminPassword = process.env.ADMIN_PASSWORD || "laartadmin2024";
        if (input.adminPassword !== adminPassword) {
          throw new Error("Unauthorized");
        }
        const deleted = await db.deleteExpiredEvents();
        return { success: true, deleted };
      }),

    deleteAll: publicProcedure
      .input(z.object({ adminPassword: z.string() }))
      .mutation(async ({ input }) => {
        const adminPassword = process.env.ADMIN_PASSWORD || "laartadmin2024";
        if (input.adminPassword !== adminPassword) {
          throw new Error("Unauthorized");
        }
        await db.deleteAllEvents();
        return { success: true };
      }),
  }),

  // Geocoding endpoint for address search
  geocode: router({
    search: publicProcedure
      .input(z.object({ query: z.string() }))
      .query(async ({ input }) => {
        try {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(input.query)}&city=Los%20Angeles&state=California&format=json&limit=5`,
            { headers: { "User-Agent": "LA-Art-Openings-App" } }
          );
          if (!response.ok) return { results: [] };
          const data = await response.json();
          if (!Array.isArray(data)) return { results: [] };
          const results = data
            .filter((item: any) => item && item.address)
            .map((item: any, index: number) => ({
              id: `${index}-${item.osm_id}`,
              address: item.address?.road || item.address?.pedestrian || item.name || item.display_name,
              city: item.address?.city || "Los Angeles",
              state: item.address?.state || "CA",
              zipCode: item.address?.postcode || "",
              displayName: item.display_name,
              lat: parseFloat(item.lat),
              lng: parseFloat(item.lon),
            }));
          return { results };
        } catch (error) {
          console.error("Geocoding error:", error);
          return { results: [] };
        }
      }),

    coordinates: publicProcedure
      .input(z.object({ address: z.string() }))
      .query(async ({ input }) => {
        try {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(input.address)}&format=json&limit=1`,
            { headers: { "User-Agent": "LA-Art-Openings-App" } }
          );
          if (!response.ok) return { lat: null, lng: null };
          const data = await response.json();
          if (!Array.isArray(data) || data.length === 0) return { lat: null, lng: null };
          const item = data[0];
          return { lat: parseFloat(item.lat), lng: parseFloat(item.lon) };
        } catch (error) {
          console.error("Geocoding coordinates error:", error);
          return { lat: null, lng: null };
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
