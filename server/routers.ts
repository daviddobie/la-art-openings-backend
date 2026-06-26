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
        // Check for duplicates based on title + gallery
        const isDuplicate = await db.checkDuplicateEvent(
          input.title,
          input.galleryName
        );
        if (isDuplicate) {
          throw new Error("Event already exists with same title, gallery, and date");
        }
        return await db.createEvent({
          title: input.title,
          galleryName: input.galleryName,
          address: input.address,
          openingDate: input.openingDate,
          endDate: input.endDate,
          openingTime: input.openingTime,
          bodyText: input.bodyText,
          imageUrl: input.imageUrl,
          lat: input.lat,
          lng: input.lng,
        });
      }),

    delete: publicProcedure
      .input(z.object({ id: z.string(), adminPassword: z.string() }))
      .mutation(async ({ input }) => {
        const adminPassword = process.env.ADMIN_PASSWORD || "laartadmin2024";
        if (input.adminPassword !== adminPassword) {
          throw new Error("Unauthorized");
        }
        return await db.deleteEvent(input.id);
      }),

    deleteAll: publicProcedure
      .input(z.object({ adminPassword: z.string() }))
      .mutation(async ({ input }) => {
        const adminPassword = process.env.ADMIN_PASSWORD || "laartadmin2024";
        if (input.adminPassword !== adminPassword) {
          throw new Error("Unauthorized");
        }
        return await db.deleteAllEvents();
      }),
  }),

  geocode: router({
    search: publicProcedure
      .input(z.object({ query: z.string() }))
      .query(async ({ input }) => {
        try {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(input.query)}&format=json&limit=5`,
            { headers: { "User-Agent": "LA-Art-Openings-App" } }
          );
          if (!response.ok) return { results: [] };
          const data = await response.json();
          const results = (data as any[]).map((item) => ({
            address: item.address?.road || item.display_name || "",
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

  // AI-powered itinerary optimization
  itinerary: router({
    optimize: publicProcedure
      .input(
        z.object({
          stops: z.array(
            z.object({
              id: z.string(),
              title: z.string(),
              time: z.string().optional(),
              address: z.string().optional(),
              lat: z.number().optional(),
              lng: z.number().optional(),
              isStartingLocation: z.boolean().optional(),
            })
          ),
        })
      )
      .query(async ({ input }) => {
        try {
          // Build a prompt for the AI to optimize the itinerary
          const stopsDescription = input.stops
            .map(
              (stop, idx) =>
                `${idx + 1}. ${stop.title}${stop.time ? ` (${stop.time})` : ""}${stop.address ? ` at ${stop.address}` : ""}`
            )
            .join("\n");

          const prompt = `You are an expert trip planner. Optimize this Los Angeles art gallery itinerary for the best route considering:
1. Time windows (when galleries are open)
2. Geographic proximity (minimize travel time)
3. Logical flow (visit nearby galleries in sequence)

Current stops:
${stopsDescription}

Respond with ONLY a JSON object in this exact format:
{
  "order": [1, 3, 2, 4, 5],
  "reasoning": "Brief explanation of why this order is optimal"
}

Where "order" is an array of stop numbers (1-indexed) in the optimal sequence.`;

          // Call the Manus LLM service via the backend
          const response = await fetch("https://api.manus.im/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.MANUS_API_KEY || ""}`,
            },
            body: JSON.stringify({
              model: "gpt-4-turbo",
              messages: [
                {
                  role: "user",
                  content: prompt,
                },
              ],
              temperature: 0.7,
              max_tokens: 500,
            }),
          });

          if (!response.ok) {
            console.warn("AI optimization failed, returning original order");
            return {
              order: input.stops.map((_, idx) => idx),
              reasoning: "Could not optimize - using original order",
            };
          }

          const data = await response.json();
          const content = data.choices?.[0]?.message?.content || "";

          // Parse the JSON response
          const jsonMatch = content.match(/\{[^}]+\}/);
          if (!jsonMatch) {
            console.warn("Could not parse AI response, returning original order");
            return {
              order: input.stops.map((_, idx) => idx),
              reasoning: "Could not parse AI response",
            };
          }

          const result = JSON.parse(jsonMatch[0]);
          // Convert 1-indexed to 0-indexed
          const optimizedOrder = result.order.map((n: number) => n - 1);

          return {
            order: optimizedOrder,
            reasoning: result.reasoning || "Optimized by AI",
          };
        } catch (error) {
          console.error("Itinerary optimization error:", error);
          return {
            order: input.stops.map((_, idx) => idx),
            reasoning: "Error during optimization",
          };
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
