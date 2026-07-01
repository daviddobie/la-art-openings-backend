import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerShareLandingRoute } from "./share-landing";
import { handleCreateShare, handleGetShare } from "./share-api";
import { startCleanupInterval } from "./share-storage";
import { appRouter } from "../routers";
import { createContext } from "./context";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

// Local database of popular LA art venues for quick search
const localVenues = [
  {
    name: "The Getty",
    address: "1200 Getty Center Drive",
    city: "Los Angeles",
    state: "CA",
    zipCode: "90049",
    displayName: "The Getty, 1200 Getty Center Drive, Los Angeles, CA 90049"
  },
  {
    name: "The Getty Villa",
    address: "17985 Pacific Coast Highway",
    city: "Malibu",
    state: "CA",
    zipCode: "90272",
    displayName: "The Getty Villa, 17985 Pacific Coast Highway, Malibu, CA 90272"
  },
  {
    name: "LACMA",
    address: "5905 Wilshire Boulevard",
    city: "Los Angeles",
    state: "CA",
    zipCode: "90036",
    displayName: "LACMA, 5905 Wilshire Boulevard, Los Angeles, CA 90036"
  },
  {
    name: "Museum of Contemporary Art",
    address: "250 South Grand Avenue",
    city: "Los Angeles",
    state: "CA",
    zipCode: "90012",
    displayName: "Museum of Contemporary Art, 250 South Grand Avenue, Los Angeles, CA 90012"
  },
  {
    name: "Broad Museum",
    address: "221 South Grand Avenue",
    city: "Los Angeles",
    state: "CA",
    zipCode: "90012",
    displayName: "Broad Museum, 221 South Grand Avenue, Los Angeles, CA 90012"
  },
  {
    name: "Griffith Observatory",
    address: "2800 East Observatory Road",
    city: "Los Angeles",
    state: "CA",
    zipCode: "90027",
    displayName: "Griffith Observatory, 2800 East Observatory Road, Los Angeles, CA 90027"
  },
  {
    name: "Natural History Museum",
    address: "900 Exposition Boulevard",
    city: "Los Angeles",
    state: "CA",
    zipCode: "90007",
    displayName: "Natural History Museum, 900 Exposition Boulevard, Los Angeles, CA 90007"
  },
  {
    name: "Hammer Museum",
    address: "11000 Wilshire Boulevard",
    city: "Los Angeles",
    state: "CA",
    zipCode: "90024",
    displayName: "Hammer Museum, 11000 Wilshire Boulevard, Los Angeles, CA 90024"
  },
  {
    name: "Pasadena Museum of Art",
    address: "46 North Los Robles Avenue",
    city: "Pasadena",
    state: "CA",
    zipCode: "91101",
    displayName: "Pasadena Museum of Art, 46 North Los Robles Avenue, Pasadena, CA 91101"
  },
  {
    name: "Huntington Library",
    address: "1151 Oxford Road",
    city: "San Marino",
    state: "CA",
    zipCode: "91108",
    displayName: "Huntington Library, 1151 Oxford Road, San Marino, CA 91108"
  }
];

// Simple in-memory cache for geocoding results
const geocodeCache = new Map<string, { results: any[]; timestamp: number }>();
const CACHE_TTL = 3600000; // 1 hour in milliseconds

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Enable CORS for all routes
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization, x-admin-password",
    );
    res.header("Access-Control-Allow-Credentials", "true");

    // Handle preflight requests
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Serve static files for universal links and app links
  app.use(express.static("public"));

  // Serve universal link files with correct content type
  app.get("/.well-known/apple-app-site-association", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.sendFile("public/.well-known/apple-app-site-association", { root: process.cwd() });
  });

  app.get("/.well-known/assetlinks.json", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.sendFile("public/.well-known/assetlinks.json", { root: process.cwd() });
  });

  registerOAuthRoutes(app);
  registerShareLandingRoute(app, process.env.APP_SCHEME || "manus20260411181801");

  // Share API endpoints
  app.post("/api/share", handleCreateShare);
  app.get("/api/share/:code", handleGetShare);

  // Start cleanup interval for expired shares
  startCleanupInterval(24);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  // Geocoding endpoint for address and business name search
  app.get("/api/geocode", async (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query || query.length < 2) {
        return res.json({ results: [] });
      }

      // Check cache first
      const cacheKey = query.toLowerCase();
      const cached = geocodeCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return res.json({ results: cached.results });
      }

      // Search local venues first
      const queryLower = query.toLowerCase();
      const localResults = localVenues
        .filter(venue => 
          venue.name.toLowerCase().includes(queryLower) ||
          venue.address.toLowerCase().includes(queryLower) ||
          venue.city.toLowerCase().includes(queryLower)
        )
        .map((venue, index) => ({
          id: `local-${index}-${venue.name.replace(/\s+/g, '-')}`,
          address: venue.address,
          city: venue.city,
          state: venue.state,
          zipCode: venue.zipCode,
          displayName: venue.displayName
        }));

      // If we found local results, return them
      if (localResults.length > 0) {
        geocodeCache.set(cacheKey, { results: localResults, timestamp: Date.now() });
        return res.json({ results: localResults });
      }

            // Try Photon (Komoot) — designed for autocomplete, no rate limit issues
      try {
                const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(query )}&limit=8&lang=en&lat=34.05&lon=-118.24&bbox=-124.48,32.53,-114.13,42.01`;

        const response = await fetch(photonUrl, {
          headers: { 'User-Agent': 'LA-Art-Openings-App' },
        });

        if (response.ok) {
          const data = await response.json();
          if (data.features && Array.isArray(data.features) && data.features.length > 0) {
            const results = data.features
              .map((feature: any, index: number) => {
                const p = feature.properties || {};
                const street = p.street || '';
                const housenumber = p.housenumber || '';
                const streetAddress = housenumber ? `${housenumber} ${street}` : street;
                const name = p.name || '';
                const city = p.city || p.town || p.village || 'Los Angeles';
                const state = p.state || 'CA';
                const postcode = p.postcode || '';
                const parts = [name, streetAddress, city, state && postcode ? `${state} ${postcode}` : state].filter(Boolean);
                const displayName = parts.join(', ');
                const addressLine = streetAddress || name || city;
                return {
                  id: `photon-${index}-${feature.properties?.osm_id || index}`,
                  address: addressLine,
                  city,
                  state,
                  zipCode: postcode,
                  displayName,
                  venueName: name,
                  lat: feature.geometry?.coordinates?.[1],
                  lng: feature.geometry?.coordinates?.[0],
                };
              })
                           .filter((item: any) => {
                if (!item.displayName || item.displayName.length <= 3) return false;
                // Hard-filter: only keep California results
                const st = (item.state || '').toLowerCase();
                return st === 'california' || st === 'ca';
              });


            if (results.length > 0) {
              geocodeCache.set(cacheKey, { results, timestamp: Date.now() });
              return res.json({ results });
            }
          }
        }
      } catch (error) {
        console.error('Photon autocomplete error:', error);
      }



      // No results found
      res.json({ results: [] });
    } catch (error) {
      console.error('Geocoding endpoint error:', error);
      res.json({ results: [] });
    }
  });

  // Admin image upload endpoint
  app.post("/api/admin/upload-image", async (req, res) => {
    try {
      const adminPassword = process.env.ADMIN_PASSWORD || "laartadmin2024";
      const authHeader = req.headers["x-admin-password"] as string;
      if (authHeader !== adminPassword) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const body = req.body as { imageData?: string; contentType?: string; fileName?: string };
      if (!body.imageData) {
        return res.status(400).json({ error: "imageData is required" });
      }

      const base64Data = body.imageData.replace(/^data:[^;]+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      const contentType = body.contentType || "image/jpeg";
      const ext = contentType.split("/")[1] || "jpg";
      const fileName = body.fileName || `event-${Date.now()}.${ext}`;

      const FormDataPackage = (await import("form-data")).default;
      const formData = new FormDataPackage();
      formData.append("image", buffer, { filename: fileName, contentType });
      formData.append("password", adminPassword);

      const uploadResponse = await fetch("https://thelosangelesartgallery.com/upload.php", {
        method: "POST",
        headers: formData.getHeaders(),
        body: formData as any,
      });

      if (!uploadResponse.ok) {
        throw new Error(`GreenGeeks upload failed: ${uploadResponse.statusText}`);
      }

      const result = await uploadResponse.json() as { success?: boolean; imageUrl?: string; error?: string };
      if (!result.success || !result.imageUrl) {
        throw new Error(result.error || "Upload failed");
      }

      return res.json({ url: result.imageUrl });
    } catch (error) {
      console.error("Image upload error:", error);
      return res.status(500).json({ error: String(error) });
    }
  });

  // Direct REST endpoint for itinerary optimization
  app.post("/api/optimize-itinerary", async (req, res) => {
    try {
      const { stops } = req.body;
      if (!Array.isArray(stops) || stops.length === 0) {
        return res.status(400).json({ error: "Invalid stops array" });
      }

      // Pre-calculate haversine distances between all stop pairs (in miles)
      function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
        const R = 3958.8;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      }

      const hasCoords = stops.some((s: any) => s.lat && s.lng);
      const stopsDescription = stops
        .map((stop: any, idx: number) => {
          return `${idx + 1}. ${stop.title}${stop.time ? ` (${stop.time})` : ''}${stop.address ? ` at ${stop.address}` : ''}`;
        })
        .join("\n");

      // Build distance matrix so Groq doesn't need to estimate distances
      let distanceMatrix = '';
      if (hasCoords) {
        const lines: string[] = [];
        for (let i = 0; i < stops.length; i++) {
          for (let j = i + 1; j < stops.length; j++) {
            const si = stops[i] as any;
            const sj = stops[j] as any;
            if (si.lat && si.lng && sj.lat && sj.lng) {
              const dist = haversine(Number(si.lat), Number(si.lng), Number(sj.lat), Number(sj.lng));
              lines.push(`Stop ${i+1} → Stop ${j+1}: ${dist.toFixed(1)} miles`);
            }
          }
        }
        if (lines.length > 0) {
          distanceMatrix = `\n\nPRE-CALCULATED DISTANCES (use these exact numbers — do NOT estimate):\n${lines.join('\n')}`;
        }
      }

      const stopCount = stops.length;
      const geoRule = distanceMatrix
        ? `3. For stops with similar opening times (within 30 minutes of each other), use the pre-calculated distances above to pick the geographically nearest stop to the previous one — this minimizes backtracking`
        : `3. When opening times are identical or very close, keep the original relative order — do NOT try to guess geography from addresses`;
      const prompt = `You are an expert trip planner optimizing a Los Angeles art gallery itinerary.

You have EXACTLY ${stopCount} stops listed below. You must return EXACTLY ${stopCount} numbers in your order array — no more, no less.

Current stops:
${stopsDescription}${distanceMatrix}

RULES:
1. Keep stop 1 (Home/starting location) FIRST always
2. Sort remaining stops by opening time — EARLIEST opening time comes first. Parse times like "2pm", "2:00 PM", "2pm to 3pm" all as 2:00 PM.
${geoRule}
4. Return ONLY the stop numbers that appear in the list above — do NOT invent new stops

Respond with ONLY a JSON object:
{
  "order": [1, 3, 2],
  "reasoning": "Brief explanation"
}

The "order" array must contain EXACTLY ${stopCount} numbers, each between 1 and ${stopCount}, with no duplicates and no omissions.`;

      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GROQ_API_KEY || ""}`
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
          max_tokens: 600
        } )
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`AI optimization failed (${response.status}):`, errorText);
        return res.json({
          order: stops.map((_: any, idx: number) => idx),
          reasoning: "Could not optimize - using original order"
        });
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "";

      // Extract JSON — handle multi-line responses
      let result: any = null;
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON found');
        result = JSON.parse(jsonMatch[0]);
      } catch (parseErr) {
        console.warn("Could not parse AI response:", content);
        return res.json({
          order: stops.map((_: any, idx: number) => idx),
          reasoning: "Could not parse AI response"
        });
      }

      const rawOrder: number[] = result.order.map((n: number) => n - 1);
      const validIndices = new Set(stops.map((_: any, i: number) => i));
      const uniqueOrder = [...new Set(rawOrder)].filter(i => validIndices.has(i));

      if (uniqueOrder.length !== stops.length) {
        console.warn(`[Groq] Invalid order length: got ${uniqueOrder.length}, expected ${stops.length}. Falling back.`);
        return res.json({
          order: stops.map((_: any, idx: number) => idx),
          reasoning: "Could not validate AI response - using original order"
        });
      }

      console.log(`[Groq] Optimized order:`, uniqueOrder, `| Reasoning:`, result.reasoning);
      return res.json({
        order: uniqueOrder,
        reasoning: result.reasoning || "Optimized by AI"
      });
    } catch (error) {
      console.error("Itinerary optimization error:", error);
      return res.status(500).json({
        error: "Optimization failed",
        order: req.body.stops?.map((_: any, idx: number) => idx) || []
      });
    }
  });


  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`[api] server listening on port ${port}`);
  });
}

startServer().catch(console.error);
