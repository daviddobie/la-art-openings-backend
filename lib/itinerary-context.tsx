import React, { createContext, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { type RssArticle } from "./rss";
import { smartSortItinerary } from "./itinerary-sort";
import { geocodeAddress } from "./geocode";
import { trpc } from "./trpc";
import { getApiBaseUrl } from "@/constants/oauth";

// Sorting is now automatic - always geographic + time-based

/**
 * Call the backend Groq endpoint to get an AI-optimized sort order.
 * Returns the sorted items array, or null if the call fails.
 */
async function groqSortItinerary(items: ItineraryItem[]): Promise<ItineraryItem[] | null> {
  try {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) {
      console.warn('[groqSort] No API base URL available, skipping Groq sort');
      return null;
    }
    const stops = items.map((item) => ({
      id: item.id,
      title: item.title,
      time: item.time,
      address: item.address,
      lat: item.lat ?? null,
      lng: item.lng ?? null,
    }));
    console.log('[groqSort] Calling Groq endpoint at', baseUrl);
    const response = await fetch(`${baseUrl}/api/optimize-itinerary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stops }),
    });
    if (!response.ok) {
      console.warn('[groqSort] Groq endpoint returned', response.status);
      return null;
    }
    const data = await response.json();
    // data.order is 0-indexed array of positions into the original stops array
    if (!Array.isArray(data.order) || data.order.length !== items.length) {
      console.warn('[groqSort] Invalid order from Groq:', data);
      return null;
    }
    const sorted = data.order.map((idx: number) => items[idx]).filter(Boolean) as ItineraryItem[];
    console.log('[groqSort] Groq sorted order:', sorted.map(i => i.title), '| Reasoning:', data.reasoning);
    return sorted;
  } catch (err) {
    console.warn('[groqSort] Error calling Groq endpoint:', err);
    return null;
  }
}

export interface ItineraryItem {
  id: string;
  type: "article" | "custom";
  title: string;
  date?: string; // ISO date string for articles
  time?: string; // Opening time (e.g., "6:00 PM - 8:00 PM")
  location?: string; // Address or location name
  address?: string; // Full address for custom stops
  notes?: string;
  articleId?: string; // Reference to original article
  creator?: string; // Gallery/venue name
  isStartingLocation?: boolean; // If true, always sorts first in itinerary
  lat?: number; // Geocoded latitude
  lng?: number; // Geocoded longitude
  imageUrl?: string; // Preview image URL
}

interface ItineraryContextType {
  items: ItineraryItem[];
  selectedArticleIds: Set<string>;
  manualOrder: string[]; // Array of item IDs in custom order
  addArticle: (article: RssArticle) => void;
  removeArticle: (articleId: string) => void;
  addCustomStop: (title: string, address: string, time?: string, notes?: string, isStartingLocation?: boolean, initialCoords?: { lat: number; lng: number }) => void;
  updateItem: (itemId: string, updates: Partial<Pick<ItineraryItem, 'title' | 'address' | 'location' | 'time' | 'notes' | 'isStartingLocation'>>) => void;
  removeItem: (itemId: string) => void;
  getSortedItems: () => ItineraryItem[];
  reorderItems: (newOrder: string[]) => void;
  resortItems: () => void; // Smart sort only — no Groq call
  resortItemsAI: () => void; // Call Groq and auto-apply the AI result
  loadSharedItems: (items: ItineraryItem[]) => void; // Load a full set of items preserving IDs, coords, and order
  clearItinerary: () => void;
  forceOptimization: () => void;
  groqOrder: string[] | null; // AI-suggested order (null if not yet computed or unavailable)
  isGroqSorting: boolean; // True while Groq is computing in the background
  activeSort: 'smart' | 'ai'; // Which sort is currently displayed
  applySmartSort: () => void; // Switch to smart sort order
  applyGroqSort: () => void; // Switch to AI sort order
}

export const ItineraryContext = createContext<ItineraryContextType | undefined>(undefined);

const STORAGE_KEY = "curate_la_itinerary";
const STORAGE_VERSION = 3; // Increment when data shape changes (v3: clear manualOrder to fix sorting)

/**
 * Validate that a stored item has the minimum required fields.
 * Returns true if the item is valid, false if it should be discarded.
 */
function isValidItem(item: unknown): item is ItineraryItem {
  if (!item || typeof item !== "object") return false;
  const obj = item as Record<string, unknown>;
  return (
    typeof obj.id === "string" &&
    typeof obj.title === "string" &&
    (obj.type === "article" || obj.type === "custom")
  );
}

/**
 * Extract location/address from article content.
 * Looks for patterns like "at [venue]" or "[venue] in [neighborhood]"
 */
function extractLocationFromContent(content: string | undefined | null): string | undefined {
  if (!content || typeof content !== 'string') return undefined;
  // Simple heuristics: look for common gallery/venue patterns
  const patterns = [
    /at\s+([A-Z][^,\n]+(?:Gallery|Museum|Center|Space|Studio|Hall))/i,
    /([A-Z][^,\n]+(?:Gallery|Museum|Center|Space|Studio|Hall))\s+in\s+([^,\n]+)/i,
    /venue[:\s]+([^,\n]+)/i,
    /location[:\s]+([^,\n]+)/i,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      return match[1] || match[0];
    }
  }

  return undefined;
}

// Groq/AI optimization removed — local smartSortItinerary is used instead

/**
 * Calculate distance between two LA coordinates (simplified).
 * Returns a rough neighborhood/area grouping.
 */
function getLocationGroup(location?: string): number {
  if (!location) return 999;

  const location_lower = location.toLowerCase();

  // Group by LA neighborhoods (simplified)
  if (location_lower.includes("downtown") || location_lower.includes("dtla")) return 1;
  if (location_lower.includes("arts district")) return 2;
  if (location_lower.includes("silver lake") || location_lower.includes("echo park")) return 3;
  if (location_lower.includes("los feliz")) return 4;
  if (location_lower.includes("west hollywood") || location_lower.includes("weho")) return 5;
  if (location_lower.includes("santa monica") || location_lower.includes("venice")) return 6;
  if (location_lower.includes("culver city")) return 7;
  if (location_lower.includes("pasadena") || location_lower.includes("south pasadena")) return 8;
  if (location_lower.includes("long beach")) return 9;

  return 10; // Other
}

export function ItineraryProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ItineraryItem[]>([]);
  const [selectedArticleIds, setSelectedArticleIds] = useState<Set<string>>(new Set());
  const [manualOrder, setManualOrder] = useState<string[]>([]);
  const [aiOptimizedOrder, setAiOptimizedOrder] = useState<number[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [groqOrder, setGroqOrder] = useState<string[] | null>(null);
  const [smartOrder, setSmartOrder] = useState<string[] | null>(null);
  const [isGroqSorting, setIsGroqSorting] = useState(false);
  const [activeSort, setActiveSort] = useState<'smart' | 'ai'>('smart');

  // Load from storage on mount
  useEffect(() => {
    const loadItinerary = async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) {
          const data = JSON.parse(stored);

          // Version check: if stored version doesn't match, clear stale data
          if (data.version !== undefined && data.version < STORAGE_VERSION) {
            console.log("[ItineraryContext] Stale data version detected, clearing storage");
            await AsyncStorage.removeItem(STORAGE_KEY);
            setIsLoading(false);
            return;
          }

          // Validate items — filter out any malformed entries
          const rawItems = Array.isArray(data.items) ? data.items : [];
          const validItems = rawItems.filter(isValidItem);
          if (validItems.length !== rawItems.length) {
            console.warn(`[ItineraryContext] Discarded ${rawItems.length - validItems.length} invalid items from storage`);
          }

          // Validate selectedArticleIds
          const rawIds = Array.isArray(data.selectedArticleIds) ? data.selectedArticleIds : [];
          const validIds = rawIds.filter((id: unknown) => typeof id === "string");

          setItems(validItems);
          setSelectedArticleIds(new Set(validIds));
          // Don't restore manual order - always use AI optimization
          setManualOrder([]);
          // Clear AI order so it gets recalculated
          setAiOptimizedOrder(null);
        }
      } catch (error) {
        // Corrupted storage — clear it and start fresh
        console.error("[ItineraryContext] Failed to load itinerary, clearing storage:", error);
        try {
          await AsyncStorage.removeItem(STORAGE_KEY);
        } catch (clearError) {
          console.error("[ItineraryContext] Failed to clear storage:", clearError);
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadItinerary();
  }, []);

  // Save to storage whenever items or sortOrder changes
  useEffect(() => {
    if (!isLoading) {
      const saveItinerary = async () => {
        try {
          const validItemIds = new Set(items.map(item => item.id));
          const cleanedManualOrder = manualOrder.filter(id => validItemIds.has(id));
          
          // Don't save manual order - always use AI optimization
          await AsyncStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
              version: STORAGE_VERSION,
              items,
              selectedArticleIds: Array.from(selectedArticleIds),
              manualOrder: [],
            })
          );
        } catch (error) {
          console.error("Failed to save itinerary:", error);
        }
      };

      saveItinerary();
    }
  }, [items, selectedArticleIds, manualOrder, isLoading]);

  // Auto-sort whenever items are added or removed
  // 1. Apply local smart sort immediately (instant feedback)
  // 2. Debounce Groq call by 1.5s so rapid add/remove doesn't fire multiple requests
  const prevItemCount = useRef(0);
  useEffect(() => {
    if (isLoading) return;
    const currentCount = items.length;
    if (currentCount !== prevItemCount.current) {
      prevItemCount.current = currentCount;
      if (currentCount > 1) {
        // Apply local sort immediately
        const localSorted = smartSortItinerary(items);
        const localIds = localSorted.map((item) => item.id);
        console.log('[autoResort] Local sort applied:', localSorted.map(i => i.title));
        setManualOrder(localIds);
        // Debounce Groq call — wait 1.5s before firing so rapid changes settle
        let cancelled = false;
        const currentItems = [...items];
        const currentIds = new Set(currentItems.map(i => i.id));
        const timer = setTimeout(() => {
          if (cancelled) return;
          groqSortItinerary(currentItems).then((groqSorted) => {
            if (cancelled) return;
            if (groqSorted && groqSorted.length === currentItems.length) {
              // Only apply if all IDs still exist in current items
              const allValid = groqSorted.every(i => currentIds.has(i.id));
              if (allValid) {
                const groqIds = groqSorted.map((item) => item.id);
                console.log('[autoResort] Groq refined order applied:', groqSorted.map(i => i.title));
                setManualOrder(groqIds);
              }
            }
          }).catch(() => { /* ignore groq errors silently */ });
        }, 1500);
        return () => { cancelled = true; clearTimeout(timer); };
      } else {
        setManualOrder([]);
      }
    }
  }, [items, isLoading]);

  const addArticle = useCallback(
    (article: any) => {
      // Prevent duplicates — if this article ID is already in the itinerary, do nothing
      if (selectedArticleIds.has(article.id)) return;
      const address = article.address; // Use the provided address directly, don't extract from content
      const newItem: ItineraryItem = {
        id: `article-${article.id}`,
        type: "article",
        title: article.title,
        date: article.pubDate,
        time: article.time,
        location: address, // Display the actual address, not extracted content
        address,
        articleId: article.id,
        creator: article.creator,
        imageUrl: article.imageUrl,
      };


      setItems((prev) => [...prev, newItem]);
      setSelectedArticleIds((prev) => new Set([...prev, article.id]));

      // Geocode the address asynchronously and update the item with real coordinates
      if (address) {
        geocodeAddress(address).then((coords) => {
          if (coords) {
            setItems((prev) =>
              prev.map((item) =>
                item.id === newItem.id ? { ...item, lat: coords.lat, lng: coords.lng } : item
              )
            );
          }
        });
      }
    },
    [selectedArticleIds]
  );

  const removeArticle = useCallback((articleId: string) => {
    setItems((prev) => prev.filter((item) => item.articleId !== articleId));
    setSelectedArticleIds((prev) => {
      const updated = new Set(prev);
      updated.delete(articleId);
      return updated;
    });
  }, []);

  const addCustomStop = useCallback((title: string, address: string, time?: string, notes?: string, isStartingLocation?: boolean, initialCoords?: { lat: number; lng: number }) => {
    const newItem: ItineraryItem = {
      id: `custom-${Date.now()}`,
      type: "custom",
      title,
      address,
      location: address,
      time,
      notes,
      isStartingLocation: isStartingLocation || false,
      // Use provided coords immediately if available
      lat: initialCoords?.lat,
      lng: initialCoords?.lng,
    };

    // If this is a starting location, clear any existing starting locations
    if (isStartingLocation) {
      setItems((prev) => [
        ...prev.map(item => ({ ...item, isStartingLocation: false })),
        newItem,
      ]);
    } else {
      setItems((prev) => [...prev, newItem]);
    }

    // Geocode the address asynchronously only if we don't already have coords
    if (address && !initialCoords) {
      geocodeAddress(address).then((coords) => {
        if (coords) {
          setItems((prev) =>
            prev.map((item) =>
              item.id === newItem.id ? { ...item, lat: coords.lat, lng: coords.lng } : item
            )
          );
        }
      });
    }
  }, []);

  const updateItem = useCallback((itemId: string, updates: Partial<Pick<ItineraryItem, 'title' | 'address' | 'location' | 'time' | 'notes' | 'isStartingLocation'>>) => {
    setItems((prev) => {
      const newAddress = updates.address || updates.location;
      // If setting as starting location, clear other starting locations
      if (updates.isStartingLocation) {
        return prev.map(item => {
          if (item.id === itemId) {
            // Clear old coords if address changed so map re-geocodes
            const coordReset = newAddress && newAddress !== item.address ? { lat: undefined, lng: undefined } : {};
            return { ...item, ...updates, ...coordReset, location: newAddress || item.location };
          }
          return { ...item, isStartingLocation: false };
        });
      }
      return prev.map(item => {
        if (item.id !== itemId) return item;
        const coordReset = newAddress && newAddress !== item.address ? { lat: undefined, lng: undefined } : {};
        return { ...item, ...updates, ...coordReset, location: newAddress || item.location };
      });
    });

    // Re-geocode asynchronously if address changed
    if (updates.address || updates.location) {
      const newAddr = updates.address || updates.location;
      if (newAddr) {
        geocodeAddress(newAddr).then((coords) => {
          if (coords) {
            setItems((prev) =>
              prev.map((item) =>
                item.id === itemId ? { ...item, lat: coords.lat, lng: coords.lng } : item
              )
            );
          }
        });
      }
    }
  }, []);

  const removeItem = useCallback((itemId: string) => {
    setItems((prev) => prev.filter((item) => item.id !== itemId));
    
    // Also remove from manualOrder if present
    setManualOrder((prev) => prev.filter((id) => id !== itemId));

    // If it's an article, also remove from selected
    const articleId = itemId.replace("article-", "");
    setSelectedArticleIds((prev) => {
      const updated = new Set(prev);
      updated.delete(articleId);
      return updated;
    });
  }, []);

  /**
   * Parse time string to minutes since midnight for comparison.
   * Handles formats like "6:00 PM - 8:00 PM" or "10:00am to 6:00pm"
   */
  const parseTimeToMinutes = (timeStr?: string): number => {
    if (!timeStr) return 0;
    
    // Extract the first time (start time)
    const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})\s*(am|pm|AM|PM)?/);
    if (!timeMatch) return 0;
    
    let hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2], 10);
    const meridiem = timeMatch[3]?.toLowerCase();
    
    // Convert to 24-hour format
    if (meridiem === 'pm' && hours !== 12) {
      hours += 12;
    } else if (meridiem === 'am' && hours === 12) {
      hours = 0;
    }
    
    return hours * 60 + minutes;
  };

  const getSortedItems = useCallback((): ItineraryItem[] => {
    // Helper: always pin starting location items first in any ordering
    const pinStartingLocations = (ordered: ItineraryItem[]): ItineraryItem[] => {
      const starters = ordered.filter(i => i.isStartingLocation);
      const rest = ordered.filter(i => !i.isStartingLocation);
      return [...starters, ...rest];
    };

    // If manual order is set, use it — but also append any new items not yet in the order
    if (manualOrder.length > 0) {
      const orderedItems = manualOrder.map(id => items.find(item => item.id === id)).filter(Boolean) as ItineraryItem[];
      // Find items added after the last sort that aren't in manualOrder yet
      const orderedIds = new Set(manualOrder);
      const newItems = items.filter(item => !orderedIds.has(item.id));
      const combined = newItems.length > 0 ? [...orderedItems, ...newItems] : orderedItems;
      if (newItems.length > 0) {
        console.log('[getSortedItems] Manual order + appending new items:', newItems.map(i => i.title));
      } else {
        console.log('[getSortedItems] Using manual order:', manualOrder.length, 'items');
      }
      return pinStartingLocations(combined);
    }
    
    // If AI optimization has provided an order, use it
    if (aiOptimizedOrder && aiOptimizedOrder.length > 0 && aiOptimizedOrder.length === items.length) {
      console.log('[getSortedItems] Using AI optimized order');
      return aiOptimizedOrder.map(idx => items[idx]).filter(Boolean);
    }
    
    // Fall back to smart sorting
    console.log('[getSortedItems] Using smart sort fallback');
    return smartSortItinerary(items);
  }, [items, aiOptimizedOrder, manualOrder]);

  const clearItinerary = useCallback(() => {
    setItems([]);
    setSelectedArticleIds(new Set());
    setManualOrder([]);
  }, []);

  const forceOptimization = useCallback(() => {
    console.log('[forceOptimization] Forcing AI optimization');
    setAiOptimizedOrder(null);
  }, []);

  const reorderItems = useCallback((newOrder: string[]) => {
    if (newOrder.length === 0) {
      console.log('[reorderItems] Clearing manual order');
      setManualOrder([]);
      return;
    }
    console.log('[reorderItems] Setting manual order:', newOrder);
    setManualOrder(newOrder);
  }, []);

  const applySmartSort = useCallback(() => {
    if (smartOrder) {
      setManualOrder(smartOrder);
      setActiveSort('smart');
    }
  }, [smartOrder]);

  const applyGroqSort = useCallback(() => {
    if (groqOrder) {
      setManualOrder(groqOrder);
      setActiveSort('ai');
    }
  }, [groqOrder]);

  // Smart sort only — no Groq call
  const resortItems = useCallback(() => {
    const localSorted = smartSortItinerary(items);
    const localIds = localSorted.map((item) => item.id);
    console.log('[resortItems] Smart sort applied:', localSorted.map(i => i.title));
    setSmartOrder(localIds);
    setGroqOrder(null); // Clear any previous AI result
    setActiveSort('smart');
    setManualOrder(localIds);
  }, [items]);

  // AI sort — calls Groq and auto-applies the result
  const resortItemsAI = useCallback(() => {
    // Apply smart sort immediately as a placeholder while Groq is thinking
    const localSorted = smartSortItinerary(items);
    const localIds = localSorted.map((item) => item.id);
    setSmartOrder(localIds);
    setGroqOrder(null);
    setActiveSort('smart');
    setManualOrder(localIds);
    // Fetch Groq sort and auto-apply when ready
    setIsGroqSorting(true);
    const currentItems = [...items];
    groqSortItinerary(currentItems).then((groqSorted) => {
      setIsGroqSorting(false);
      if (groqSorted && groqSorted.length === currentItems.length) {
        const groqIds = groqSorted.map((item) => item.id);
        console.log('[resortItemsAI] Groq result ready, applying:', groqSorted.map(i => i.title));
        setGroqOrder(groqIds);
        setManualOrder(groqIds);
        setActiveSort('ai');
      }
    }).catch(() => {
      setIsGroqSorting(false);
    });
  }, [items]);

  // Load a full set of shared items preserving their original IDs, coordinates, and order.
  // This bypasses addCustomStop (which discards IDs/coords and re-geocodes) so the shared
  // itinerary is displayed exactly as the sender had it.
  const loadSharedItems = useCallback((sharedItems: ItineraryItem[]) => {
    if (!sharedItems || sharedItems.length === 0) return;
    setItems(sharedItems);
    setSelectedArticleIds(new Set(sharedItems.filter((item) => item.type === "article" && item.articleId).map((item) => item.articleId as string)));
    setManualOrder(sharedItems.map(item => item.id));
  }, []);

  const value: ItineraryContextType = {
    items,
    selectedArticleIds,
    manualOrder,
    addArticle,
    removeArticle,
    addCustomStop,
    updateItem,
    removeItem,
    getSortedItems,
    reorderItems,
    resortItems,
    resortItemsAI,
    loadSharedItems,
    clearItinerary,
    forceOptimization,
    groqOrder,
    isGroqSorting,
    activeSort,
    applySmartSort,
    applyGroqSort,
  };

  return (
    <ItineraryContext.Provider value={value}>{children}</ItineraryContext.Provider>
  );
}

export function useItinerary(): ItineraryContextType {
  const context = React.useContext(ItineraryContext);
  if (!context) {
    throw new Error("useItinerary must be used within ItineraryProvider");
  }
  return context;
}
