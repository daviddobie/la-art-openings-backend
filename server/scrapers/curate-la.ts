/**
 * Curate LA Web Scraper
 * Fetches and parses art opening data from https://curate.la/?view=openings
 * The website is a Next.js app with data embedded in __NEXT_DATA__ script tag
 */

export interface CurateLAOpening {
  id: string;
  venue: string;
  exhibition: string;
  address: string;
  date: string; // ISO format
  time: string; // e.g., "10:00am to 6:00pm"
  tags: string[];
  imageUrl?: string;
  description?: string; // Article description or summary
}

/**
 * Parse date strings like "21-04-26" (DD-MM-YY) to ISO format (YYYY-MM-DD)
 */
function parseDate(dateStr: string): string {
  if (!dateStr) {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // Handle format like "21-04-26" (DD-MM-YY)
  const parts = dateStr.split("-");
  if (parts.length === 3) {
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const year = 2000 + parseInt(parts[2], 10);

    const date = new Date(year, month - 1, day);
    if (!isNaN(date.getTime())) {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }

  return dateStr;
}

/**
 * Parse time strings like "7:00 PM" to 24-hour format
 */
function parseTime(timeStr: string): string {
  if (!timeStr) return "";

  // If already in 12-hour format with AM/PM, return as-is
  if (/(\d{1,2}):(\d{2})\s*(AM|PM)/i.test(timeStr)) {
    return timeStr;
  }

  // Handle 24-hour format (HH:MM) and convert to 12-hour
  const match24hr = timeStr.match(/(\d{1,2}):(\d{2})$/);
  if (match24hr) {
    let hours = parseInt(match24hr[1], 10);
    const minutes = match24hr[2];
    
    // Determine AM/PM before converting hours
    const period = hours >= 12 ? 'PM' : 'AM';
    
    // Convert 24-hour to 12-hour format
    if (hours > 12) {
      hours -= 12;
    } else if (hours === 0) {
      hours = 12;
    }
    
    return `${hours}:${minutes} ${period}`;
  }

  return timeStr;
}

/**
 * Extract opening times from start and end time strings
 */
function formatTimeRange(startTime: string, endTime: string): string {
  if (!startTime || !endTime) return "";
  return `${parseTime(startTime)} to ${parseTime(endTime)}`;
}

/**
 * Map diversity tags to readable format
 */
function parseDiversityTags(diversity: string): string[] {
  const tags: string[] = [];
  if (!diversity) return tags;

  const tagMap: Record<string, string> = {
    "asian-owned": "AAPI-owned",
    "latinx-owned": "Latinx-owned",
    "black-owned": "Black-owned",
    "women-owned": "Women-owned",
    "lgbtq-owned": "LGBTQ-owned",
    "immigrant-owned": "Immigrant-owned",
  };

  if (tagMap[diversity]) {
    tags.push(tagMap[diversity]);
  }

  return tags;
}

/**
 * Scrape Curate LA openings from the Next.js __NEXT_DATA__ JSON
 */
export async function scrapeCurateLAOpenings(): Promise<CurateLAOpening[]> {
  try {
    const response = await fetch("https://curate.la/?view=openings", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch curate.la: ${response.status}`);
    }

    const html = await response.text();
    const openings = parseOpeningsFromHTML(html);

    return openings;
  } catch (error) {
    console.error("Error scraping Curate LA:", error);
    return [];
  }
}

/**
 * Parse opening data from curate.la HTML
 * Extracts the __NEXT_DATA__ JSON from the page
 */
function parseOpeningsFromHTML(html: string): CurateLAOpening[] {
  const openings: CurateLAOpening[] = [];

  try {
    // Extract __NEXT_DATA__ JSON from the page
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>({.*?})<\/script>/s);
    if (!match) {
      console.error("Could not find __NEXT_DATA__ in HTML");
      return [];
    }

    const nextData = JSON.parse(match[1]);
    const pageProps = nextData?.props?.pageProps;

    if (!pageProps || !pageProps.openings) {
      console.error("Could not find openings in pageProps");
      return [];
    }

    // Parse each opening
    for (const opening of pageProps.openings) {
      try {
        const curateLAOpening: CurateLAOpening = {
          id: `${opening.event_id}`,
          venue: opening.place_title || "Unknown Venue",
          exhibition: opening.event_title || "Art Opening",
          address: opening.place_address || "Los Angeles, CA",
          date: parseDate(opening.opening_date),
          time: formatTimeRange(opening.opening_time_start, opening.opening_time_end),
          tags: parseDiversityTags(opening.place_diversity),
          imageUrl: opening.image,
          description: opening.event_description,
        };

        openings.push(curateLAOpening);
      } catch (itemError) {
        console.warn("Error parsing individual opening:", itemError);
        // Continue with next opening
      }
    }

    return openings;
  } catch (error) {
    console.error("Error parsing Curate LA HTML:", error);
    return [];
  }
}

// Cache for openings data
let cachedOpenings: CurateLAOpening[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Get Curate LA openings with caching
 */
export async function getCurateLAOpeningsWithCache(): Promise<CurateLAOpening[]> {
  const now = Date.now();

  // Return cached data if still valid
  if (cachedOpenings && now - cacheTimestamp < CACHE_TTL) {
    console.log(`Returning cached openings: ${cachedOpenings.length} items`);
    return cachedOpenings;
  }

  // Fetch fresh data
  console.log("Fetching fresh openings from curate.la...");
  const openings = await scrapeCurateLAOpenings();

  // Update cache
  cachedOpenings = openings;
  cacheTimestamp = now;

  console.log(`Scraped ${openings.length} openings from curate.la`);
  return openings;
}

/**
 * Clear cache (useful for manual refresh)
 */
export function clearCurateLACache(): void {
  cachedOpenings = null;
  cacheTimestamp = 0;
}


/**
 * Fetch article text for a specific event
 */
export async function fetchArticleText(eventId: string): Promise<string> {
  try {
    const openings = await getCurateLAOpeningsWithCache();
    const opening = openings.find((o) => o.id === eventId);

    if (!opening) {
      return "Event not found";
    }

    return opening.description || "No description available";
  } catch (error) {
    console.error("Error fetching article text:", error);
    return "Error loading article text";
  }
}
