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

      // Try Nominatim as fallback for addresses not in our local database
      try {
        const searchQuery = query.includes("Los Angeles") ? query : query + " Los Angeles";
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQuery)}&format=json&limit=5`,
          {
            headers: {
              'User-Agent': 'LA-Art-Openings-App',
            },
          }
        );

        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data) && data.length > 0) {
            const results = data
              .map((item: any, index: number) => ({
                id: `nominatim-${index}-${item.osm_id}`,
                address: item.address?.road || item.address?.pedestrian || item.name || '',
                city: item.address?.city || 'Los Angeles',
                state: item.address?.state || 'CA',
                zipCode: item.address?.postcode || '',
                displayName: item.display_name || item.name || '',
              }))
              .filter((item: any) => item.displayName);

            if (results.length > 0) {
              geocodeCache.set(cacheKey, { results, timestamp: Date.now() });
              return res.json({ results });
            }
          }
        }
      } catch (error) {
        console.error('Nominatim fallback error:', error);
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

      const uploadResponse = await fetch("https://thelosangelesartgallery.com/upload.php", {
        method: "POST",
        headers: {
          "x-admin-password": adminPassword,
          ...formData.getHeaders(),
        },
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
