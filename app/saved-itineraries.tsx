import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { getCommunityDeviceId } from "@/hooks/use-community-stats";
import { fetchFavoriteGalleries, saveGalleryFavorite } from "@/lib/community-api";
import { type ItineraryItem, useItinerary } from "@/lib/itinerary-context";

const SAVED_ITINERARIES_KEY = "la_gallery_saved_itineraries_v1";

type SavedItinerary = {
  id: string;
  name: string;
  savedAt: string;
  items: ItineraryItem[];
};

async function readSavedItineraries(): Promise<SavedItinerary[]> {
  try {
    const raw = await AsyncStorage.getItem(SAVED_ITINERARIES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => item?.id && item?.name && Array.isArray(item.items)) : [];
  } catch (error) {
    console.error("[SavedItineraries] Failed to read saved itineraries", error);
    return [];
  }
}

export default function SavedItinerariesScreen() {
  const colors = useColors();
  const router = useRouter();
  const itinerary = useItinerary();
  const [name, setName] = useState("");
  const [saved, setSaved] = useState<SavedItinerary[]>([]);
  const [favoriteGalleries, setFavoriteGalleries] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const loadSaved = useCallback(async () => {
    setSaved(await readSavedItineraries());
  }, []);

  const loadFavorites = useCallback(async () => {
    try {
      const deviceId = await getCommunityDeviceId();
      const rows = await fetchFavoriteGalleries(deviceId);
      setFavoriteGalleries(rows.map((row) => row.galleryName).filter(Boolean));
    } catch (error) {
      console.error("[SavedItineraries] Failed to load favorite galleries", error);
    }
  }, []);

  useEffect(() => {
    void loadSaved();
    void loadFavorites();
  }, [loadSaved, loadFavorites]);

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert("Name your itinerary", "Enter a name before saving.");
      return;
    }
    if (itinerary.items.length === 0) {
      Alert.alert("No stops yet", "Add at least one stop to your itinerary before saving it.");
      return;
    }
    setIsSaving(true);
    try {
      const next: SavedItinerary = {
        id: `saved-${Date.now()}`,
        name: trimmedName,
        savedAt: new Date().toISOString(),
        items: itinerary.getSortedItems(),
      };
      const updated = [next, ...saved];
      await AsyncStorage.setItem(SAVED_ITINERARIES_KEY, JSON.stringify(updated));
      setSaved(updated);
      setName("");
      Alert.alert("Itinerary saved", `“${trimmedName}” is available to load later.`);
    } catch (error) {
      console.error("[SavedItineraries] Failed to save", error);
      Alert.alert("Could not save", "Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoad = (entry: SavedItinerary) => {
    itinerary.loadSharedItems(entry.items);
    Alert.alert("Itinerary loaded", `Loaded “${entry.name}”.`, [{ text: "OK", onPress: () => router.replace("/(tabs)/itinerary") }]);
  };

  const handleDelete = (entry: SavedItinerary) => {
    Alert.alert("Delete saved itinerary?", `Delete “${entry.name}”?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const updated = saved.filter((item) => item.id !== entry.id);
          setSaved(updated);
          await AsyncStorage.setItem(SAVED_ITINERARIES_KEY, JSON.stringify(updated));
        },
      },
    ]);
  };

  const handleRemoveFavorite = async (galleryName: string) => {
    try {
      const deviceId = await getCommunityDeviceId();
      await saveGalleryFavorite({ deviceId, galleryName, favorite: false });
      setFavoriteGalleries((current) => current.filter((name) => name !== galleryName));
    } catch (error) {
      console.error("[SavedItineraries] Failed to remove favorite", error);
    }
  };

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      <FlatList
        data={saved}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <>
            <View style={styles.headerRow}>
              <Pressable onPress={() => router.back()} hitSlop={12}>
                <Text style={[styles.back, { color: colors.primary }]}>‹ Back</Text>
              </Pressable>
              <Text style={[styles.title, { color: colors.foreground }]}>Saved Itineraries</Text>
              <View style={{ width: 48 }} />
            </View>
            <Text style={[styles.helper, { color: colors.muted }]}>Save the current itinerary and load it whenever you need it.</Text>
            <View style={[styles.saveCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Itinerary name"
                placeholderTextColor={colors.muted}
                returnKeyType="done"
                style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              />
              <Pressable
                onPress={handleSave}
                disabled={isSaving}
                style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.primary, opacity: pressed || isSaving ? 0.7 : 1 }]}
              >
                <Text style={[styles.primaryButtonText, { color: colors.background }]}>{isSaving ? "Saving…" : "Save Current Itinerary"}</Text>
              </Pressable>
            </View>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>My Saved Itineraries</Text>
          </>
        }
        renderItem={({ item }) => (
          <View style={[styles.itemCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.itemTitle, { color: colors.foreground }]}>{item.name}</Text>
              <Text style={[styles.itemMeta, { color: colors.muted }]}>{item.items.length} stop{item.items.length === 1 ? "" : "s"} · {new Date(item.savedAt).toLocaleDateString()}</Text>
            </View>
            <Pressable onPress={() => handleLoad(item)} style={[styles.smallButton, { backgroundColor: colors.primary }]}>
              <Text style={[styles.smallButtonText, { color: colors.background }]}>Load</Text>
            </Pressable>
            <Pressable onPress={() => handleDelete(item)} hitSlop={8}>
              <Text style={[styles.deleteText, { color: colors.error }]}>Delete</Text>
            </Pressable>
          </View>
        )}
        ListEmptyComponent={<Text style={[styles.empty, { color: colors.muted }]}>No saved itineraries yet.</Text>}
        ListFooterComponent={
          <View>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Favorite Galleries</Text>
            {favoriteGalleries.length === 0 ? (
              <Text style={[styles.empty, { color: colors.muted }]}>Favorite a gallery from the feed to see it here.</Text>
            ) : favoriteGalleries.map((galleryName) => (
              <View key={galleryName} style={[styles.favoriteRow, { borderBottomColor: colors.border }]}>
                <Text style={[styles.favoriteName, { color: colors.foreground }]}>{galleryName}</Text>
                <Pressable onPress={() => handleRemoveFavorite(galleryName)} hitSlop={8}>
                  <Text style={[styles.deleteText, { color: colors.muted }]}>Remove</Text>
                </Pressable>
              </View>
            ))}
          </View>
        }
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  back: { fontSize: 16, fontWeight: "700", width: 48 },
  title: { fontSize: 22, fontWeight: "800" },
  helper: { fontSize: 13, lineHeight: 19, marginBottom: 16, textAlign: "center" },
  saveCard: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 10, marginBottom: 22 },
  input: { borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  primaryButton: { borderRadius: 9, paddingVertical: 11, alignItems: "center" },
  primaryButtonText: { fontWeight: "800", fontSize: 13 },
  sectionTitle: { fontSize: 17, fontWeight: "800", marginBottom: 10, marginTop: 4 },
  itemCard: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 8, flexDirection: "row", alignItems: "center", gap: 10 },
  itemTitle: { fontSize: 15, fontWeight: "700" },
  itemMeta: { fontSize: 12, marginTop: 4 },
  smallButton: { borderRadius: 7, paddingHorizontal: 11, paddingVertical: 7 },
  smallButtonText: { fontSize: 12, fontWeight: "800" },
  deleteText: { fontSize: 12, fontWeight: "700" },
  empty: { fontSize: 13, paddingVertical: 10, marginBottom: 16 },
  favoriteRow: { borderBottomWidth: 1, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  favoriteName: { fontSize: 15, flex: 1, marginRight: 12 },
});
