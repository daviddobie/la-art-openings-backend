import { getApiBaseUrl } from "@/constants/oauth";
import { extractCommunityPayload } from "@/lib/community-response";

export { extractCommunityPayload } from "@/lib/community-response";

export type GalleryCommunityStat = {
  galleryName: string;
  favoriteCount: number;
  isFavorited: boolean;
};

export type EventCommunityStat = {
  eventId: number;
  ratingAverage: number;
  ratingCount: number;
  myRating: number | null;
};

export type CommunityStats = {
  galleries: GalleryCommunityStat[];
  events: EventCommunityStat[];
};

function buildInput(input: unknown) {
  return encodeURIComponent(JSON.stringify({ 0: { json: input } }));
}

export async function fetchCommunityStats(input: {
  deviceId: string;
  galleryNames: string[];
  eventIds: number[];
}): Promise<CommunityStats> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/trpc/community.getStats?batch=1&input=${buildInput(input)}`,
  );
  if (!response.ok) throw new Error(`Unable to load community stats (${response.status})`);
  return extractCommunityPayload(await response.json()) as CommunityStats;
}

async function mutateCommunity(path: string, input: unknown) {
  const response = await fetch(`${getApiBaseUrl()}/api/trpc/${path}?batch=1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 0: { json: input } }),
  });
  if (!response.ok) throw new Error(`Unable to save community action (${response.status})`);
  return extractCommunityPayload(await response.json());
}

export function saveGalleryFavorite(input: { deviceId: string; galleryName: string; favorite: boolean }) {
  return mutateCommunity("community.setGalleryFavorite", input);
}

export async function fetchFavoriteGalleries(deviceId: string): Promise<Array<{ galleryName: string; createdAt?: string }>> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/trpc/community.getFavoriteGalleries?batch=1&input=${buildInput({ deviceId })}`,
  );
  if (!response.ok) throw new Error(`Unable to load favorite galleries (${response.status})`);
  const payload = extractCommunityPayload(await response.json());
  return Array.isArray(payload) ? payload : [];
}

export function saveEventRating(input: { deviceId: string; eventId: number; rating: number }) {
  return mutateCommunity("community.setEventRating", input);
}
