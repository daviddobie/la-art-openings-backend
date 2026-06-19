import { getCurateLAOpeningsWithCache } from "./curate-la";

export interface UnifiedOpening {
  id: string;
  venue: string;
  exhibition: string;
  address: string;
  date: string; // YYYY-MM-DD format
  time: string;
  tags: string[];
  imageUrl?: string;
  source: "curate.la" | "rss";
  link?: string;
}

const RSS_URL = "https://medium.com/feed/@curate.LA";

/**
 * Parse RSS XML and extract articles
 */
function parseRss(xml: string): any[] {
  const articles: any[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    
    const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').trim() : "Untitled";
    
    const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/);
    const link = linkMatch ? linkMatch[1].trim() : "";
    
    const guidMatch = item.match(/<guid[^>]*>([\s\S]*?)<\/guid>/);
    const id = guidMatch ? guidMatch[1].trim() : link;
    
    const contentMatch = item.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/);
    const content = contentMatch ? contentMatch[1].replace(/<[^>]*>/g, '').trim() : "";
    
    const categoryRegex = /<category>([\s\S]*?)<\/category>/g;
    const categories: string[] = [];
    let catMatch;
    while ((catMatch = categoryRegex.exec(item)) !== null) {
      categories.push(catMatch[1].trim());
    }

    articles.push({
      id,
      title,
      link,
      content,
      categories,
    });
  }

  return articles;
}

/**
 * Fetch RSS feed
 */
async function fetchRssFeed(): Promise<any[]> {
  const response = await fetch(RSS_URL, {
    headers: {
      Accept: "application/rss+xml, application/xml, text/xml",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch RSS feed: ${response.status}`);
  }

  const xml = await response.text();
  return parseRss(xml);
}

/**
 * Extract date from RSS article title or content
 * Look for patterns like "Thursday, April 16 at 7:00 PM" or "April 16, 2026"
 */
function extractDateFromRss(title: string, content: string): string | null {
  const text = `${title} ${content}`;
  
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  
  for (let i = 0; i < monthNames.length; i++) {
    const monthName = monthNames[i];
    const monthNum = String(i + 1).padStart(2, '0');
    
    const regex = new RegExp(`${monthName}\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?`, 'i');
    const match = text.match(regex);
    
    if (match) {
      const day = String(match[1]).padStart(2, '0');
      const year = match[2] || new Date().getFullYear().toString();
      return `${year}-${monthNum}-${day}`;
    }
  }
  
  return null;
}

/**
 * Extract time from RSS article title or content
 */
function extractTimeFromRss(title: string, content: string): string {
  const text = `${title} ${content}`;
  
  const timeRegex = /(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))(?:\s*[–-]\s*(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)))?/;
  const match = text.match(timeRegex);
  
  if (match) {
    if (match[2]) {
      return `${match[1]} - ${match[2]}`;
    }
    return match[1];
  }
  
  return "";
}

/**
 * Convert RSS article to UnifiedOpening format
 */
function rssToOpening(article: any): UnifiedOpening | null {
  const date = extractDateFromRss(article.title, article.content);
  if (!date) return null;
  
  const time = extractTimeFromRss(article.title, article.content);
  
  const venueParts = article.title.split(/[:-]/);
  const venue = venueParts[0].trim();
  
  return {
    id: `rss-${article.id}`,
    venue,
    exhibition: article.title,
    address: "",
    date,
    time,
    tags: article.categories || [],
    imageUrl: undefined,
    source: "rss",
    link: article.link,
  };
}

/**
 * Merge curate.la scraper data with RSS feed data
 */
export async function getUnifiedOpenings(): Promise<UnifiedOpening[]> {
  try {
    const [curateOpenings, rssArticles] = await Promise.all([
      getCurateLAOpeningsWithCache(),
      fetchRssFeed(),
    ]);
    
    const rssOpenings = rssArticles
      .map(rssToOpening)
      .filter((o): o is UnifiedOpening => o !== null);
    
    const curateUnified: UnifiedOpening[] = curateOpenings.map(o => ({
      ...o,
      source: "curate.la" as const,
    }));
    
    const allOpenings = [...curateUnified, ...rssOpenings];
    const seen = new Set<string>();
    const deduplicated: UnifiedOpening[] = [];
    
    for (const opening of allOpenings) {
      const key = `${opening.date}|${opening.venue.toLowerCase()}|${opening.exhibition.toLowerCase()}`;
      
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(opening);
      }
    }
    
    deduplicated.sort((a, b) => a.date.localeCompare(b.date));
    
    return deduplicated;
  } catch (error) {
    console.error("Error fetching unified openings:", error);
    const curateOpenings = await getCurateLAOpeningsWithCache();
    return curateOpenings.map(o => ({
      ...o,
      source: "curate.la" as const,
    }));
  }
}
