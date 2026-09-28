import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  fetchCommunityStats,
  saveEventRating,
  saveGalleryFavorite,
  type EventCommunityStat,
  type GalleryCommunityStat,
} from "@/lib/community-api";

const DEVICE_ID_KEY = "la_gallery_guide_community_device_id";

function createDeviceId() {
  return `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}-${Math.random().toString(36).slice(2, 14)}`;
}

export async function getCommunityDeviceId() {
  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const created = createDeviceId();
  await AsyncStorage.setItem(DEVICE_ID_KEY, created);
  return created;
}

export type CommunitySubject = { id: string | number; galleryName?: string; creator?: string };

export function useCommunityStats(subjects: CommunitySubject[]) {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const galleryNames = useMemo(
    () => [...new Set(subjects.map((subject) => subject.galleryName || subject.creator || "").filter(Boolean))],
    [subjects],
  );
  const eventIds = useMemo(
    () => subjects.map((subject) => Number(subject.id)).filter((id) => Number.isInteger(id) && id > 0),
    [subjects],
  );

  useEffect(() => {
    getCommunityDeviceId().then(setDeviceId).catch(console.error);
  }, []);

  const query = useQuery({
    queryKey: ["community-stats", deviceId, galleryNames, eventIds],
    enabled: Boolean(deviceId) && (galleryNames.length > 0 || eventIds.length > 0),
    queryFn: () => fetchCommunityStats({ deviceId: deviceId!, galleryNames, eventIds }),
    staleTime: 30_000,
  });

  const galleriesByName = useMemo(
    () => new Map<string, GalleryCommunityStat>((query.data?.galleries ?? []).map((item) => [item.galleryName, item])),
    [query.data?.galleries],
  );
  const eventsById = useMemo(
    () => new Map<number, EventCommunityStat>((query.data?.events ?? []).map((item) => [item.eventId, item])),
    [query.data?.events],
  );

  const toggleFavorite = useCallback(
    async (galleryName: string) => {
      if (!deviceId || !galleryName) return false;
      const favorite = !galleriesByName.get(galleryName)?.isFavorited;
      try {
        await saveGalleryFavorite({ deviceId, galleryName, favorite });
        await query.refetch();
        return true;
      } catch (error) {
        console.error("[community] Failed to save gallery favorite", error);
        return false;
      }
    },
    [deviceId, galleriesByName, query],
  );

  const setRating = useCallback(
    async (eventId: number, rating: number) => {
      if (!deviceId || !Number.isInteger(eventId)) return false;
      try {
        await saveEventRating({ deviceId, eventId, rating });
        await query.refetch();
        return true;
      } catch (error) {
        console.error("[community] Failed to save opening rating", error);
        return false;
      }
    },
    [deviceId, query],
  );

  return { ...query, galleriesByName, eventsById, toggleFavorite, setRating };
}
