import {
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as WebBrowser from "expo-web-browser";
import DraggableFlatList, {
  ScaleDecorator,
  RenderItemParams,
} from "react-native-draggable-flatlist";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, { SharedValue, useAnimatedStyle } from "react-native-reanimated";

import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useItinerary, type ItineraryItem } from "@/lib/itinerary-context";
import { useCurrentLocation } from "@/hooks/use-current-location";
import { useCurateLAOpenings } from "@/hooks/use-curate-la";
import { formatDate } from "@/lib/rss";
import { generateGoogleMapsUrl } from "@/lib/maps-utils";
import { generateWebShareLink, generateShareableLink } from "@/lib/itinerary-share";
import { getShortenedShareLink } from "@/lib/url-shortener";
import { generateShareCode } from "@/lib/share-code-generator";
import { setCurrentOpening } from "@/lib/opening-store";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import MapPreview from "@/components/map-preview";

export default function ItineraryScreen() {
  const router = useRouter();
  const colors = useColors();
  const itinerary = useItinerary();
  const { location: currentLocation } = useCurrentLocation();
  const { data: curateData } = useCurateLAOpenings();
  const [sortTapCount, setSortTapCount] = useState(0); // odd = smart sort, even (>0) = groq sort
  const [hasUserSorted, setHasUserSorted] = useState(false);
  const [showShareOptions, setShowShareOptions] = useState(false);
  const [isShorteningUrl, setIsShorteningUrl] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Get sorted items using the context's getSortedItems which handles all sorting logic
  const sortedItems = itinerary.getSortedItems();
  
  // Create a "Your Location" stop if we have current location
  const yourLocationStop = useMemo(() => {
    if (!currentLocation) return null;
    return {
      id: 'your-location',
      type: 'custom' as const,
      title: 'Your Location',
      location: 'Current Location',
      address: 'Current Location',
      lat: currentLocation.lat,
      lng: currentLocation.lng,
      isStartingLocation: true,
      date: undefined,
      time: undefined,
      notes: undefined,
      articleId: undefined,
      creator: undefined,
      imageUrl: undefined,
    } as const satisfies ItineraryItem;
  }, [currentLocation]);
  
  // displayItems includes Your Location at the start if available
  const displayItems = useMemo(() => {
    if (yourLocationStop) {
      return [yourLocationStop, ...sortedItems];
    }
    return sortedItems;
  }, [yourLocationStop, sortedItems]);

  // Reset tap counter when stops are added/removed so next tap always starts from smart sort
  const prevItemCountRef = useRef(sortedItems.length);
  useEffect(() => {
    if (sortedItems.length !== prevItemCountRef.current) {
      prevItemCountRef.current = sortedItems.length;
      setSortTapCount(0);
    }
  }, [sortedItems.length]);
  
  // Separate starting location (pinned) from draggable items
  // Note: Your Location stop (id='your-location') is always the starting location
  const startingLocationItem = useMemo(() => displayItems.find(item => item.isStartingLocation), [displayItems]);
  const draggableItems = useMemo(() => displayItems.filter(item => !item.isStartingLocation && item.id !== 'your-location'), [displayItems]);

  // flatListData only contains draggable items; starting location is rendered separately above the list
  const flatListData = useMemo(() => {
    return draggableItems;
  }, [draggableItems]);

  const handleRemoveItem = useCallback(
    (itemId: string) => {
      itinerary.removeItem(itemId);
    },
    [itinerary]
  );

  const handleOpenMaps = useCallback(() => {
    // For Open in Maps: include starting location as the origin
    // For sharing: starting location is excluded (handled separately)
    const startingStop = displayItems.find(item => item.isStartingLocation);
    const nonStartingItems = displayItems.filter(item => !item.isStartingLocation && item.id !== 'your-location');

    // Build the full list with starting location first (if present)
    const allItems = startingStop ? [startingStop, ...nonStartingItems] : nonStartingItems;
    const googleUrl = generateGoogleMapsUrl(allItems);

    // Build Apple Maps URL
    const addresses = allItems
      .map((item) => (item.address || item.location || item.title || "").trim())
      .filter(Boolean);

    let appleUrl: string;
    if (addresses.length === 0) {
      appleUrl = "maps://maps.apple.com/?q=Los+Angeles,+CA";
    } else if (addresses.length === 1) {
      appleUrl = `maps://maps.apple.com/?saddr=Current+Location&daddr=${encodeURIComponent(addresses[0])}`;
    } else {
      // Use starting location address as origin if available, otherwise current location
      const origin = startingStop
        ? encodeURIComponent((startingStop.address || startingStop.location || startingStop.title || "").trim())
        : "Current+Location";
      const destination = encodeURIComponent(addresses[addresses.length - 1]);
      appleUrl = `maps://maps.apple.com/?saddr=${origin}&daddr=${destination}`;
    }

    const openGoogleMaps = async () => {
      try {
        const supported = await Linking.canOpenURL(googleUrl);
        if (supported) {
          await Linking.openURL(googleUrl);
        } else {
          await WebBrowser.openBrowserAsync(googleUrl);
        }
      } catch (error) {
        console.error("Failed to open Google Maps:", error);
      }
    };

    const openAppleMaps = async () => {
      try {
        const supported = await Linking.canOpenURL(appleUrl);
        if (supported) {
          await Linking.openURL(appleUrl);
        } else {
          // Fallback to web Apple Maps
          await WebBrowser.openBrowserAsync(
            `https://maps.apple.com/?q=${encodeURIComponent(addresses.join(", "))}`
          );
        }
      } catch (error) {
        console.error("Failed to open Apple Maps:", error);
      }
    };

    if (Platform.OS === "ios") {
      Alert.alert(
        "Open in Maps",
        "Choose a maps app:",
        [
          { text: "Apple Maps", onPress: openAppleMaps },
          { text: "Google Maps", onPress: openGoogleMaps },
          { text: "Cancel", style: "cancel" },
        ],
        { cancelable: true }
      );
    } else {
      // On Android / web, open Google Maps directly (no Apple Maps)
      openGoogleMaps();
    }
  }, [displayItems]);

  const handleShareItinerary = useCallback(async () => {
    setShowShareOptions(true);
  }, []);

  const handleShareAsText = useCallback(async () => {
    // Exclude starting location stops from shared text
    const shareableItems = displayItems.filter(item => !item.isStartingLocation && item.id !== 'your-location');
    const message = shareableItems
      .map(
        (item, index) =>
          `${index + 1}. ${item.title}\n   📍 ${item.location || item.address || "Location TBD"}\n   📅 ${item.date ? formatDate(item.date) : "TBD"}\n   ⏰ ${item.time || "TBD"}`
      )
      .join("\n\n");

    const fullMessage = `My LA Art Openings Itinerary:\n\n${message}`;

    if (Platform.OS === "web") {
      try {
        await navigator.clipboard.writeText(fullMessage);
        alert("Itinerary copied to clipboard!");
      } catch (error) {
        console.error("Failed to copy to clipboard:", error);
        alert("Failed to copy itinerary");
      }
    } else {
      try {
        console.log("[Share] Attempting to share text on native platform");
        await Share.share({
          message: fullMessage,
        });
        console.log("[Share] Share successful");
      } catch (error: any) {
        console.error("[Share] Failed to share:", error.message, error);
        // Fallback: show alert with shareable content
        alert("Share:\n\n" + fullMessage);
      }
    }
    setShowShareOptions(false);
  }, [displayItems]);

  const handleResetData = useCallback(async () => {
    try {
      await AsyncStorage.removeItem('curate_la_itinerary');
      itinerary.clearItinerary();
      setShowResetConfirm(false);
    } catch (error) {
      console.error('Failed to reset data:', error);
      alert('Failed to reset app data');
    }
  }, [itinerary]);

  const handleShareAsDeepLink = useCallback(async () => {
    try {
      // Exclude starting location stops from shared link
      const shareableItems = displayItems.filter(item => !item.isStartingLocation && item.id !== 'your-location');
      const result = await generateShareCode(shareableItems);
      if (!result) {
        alert("Failed to generate shareable link");
        return;
      }
      // Use the HTTPS URL so iMessage shows a rich link preview with the app icon
      const installNote = "(Don't have the app? Tap the link to download it, then tap the link again to load this itinerary.)";
      const fullMessage = `Check out my LA Art Openings itinerary!\n\n${result.url}\n\n${installNote}`;

      if (Platform.OS === "web") {
        try {
          await navigator.clipboard.writeText(fullMessage);
          alert("Deep link copied to clipboard!");
        } catch (error) {
          console.error("Failed to copy to clipboard:", error);
          alert("Failed to copy link");
        }
      } else {
        try {
          console.log("[Share] Attempting to share deep link on native platform");
          await Share.share({
            message: fullMessage,
          });
          console.log("[Share] Share successful");
        } catch (error: any) {
          console.error("[Share] Failed to share link:", error.message, error);
        }
      }
    } finally {
      setShowShareOptions(false);
    }
  }, [displayItems]);

  const handleShareAsLink = useCallback(async () => {
    setIsShorteningUrl(true);
    try {
      // Exclude starting location stops from shared link
      const shareableItems = displayItems.filter(item => !item.isStartingLocation && item.id !== 'your-location');
      console.log("[itinerary] Sharing items:", shareableItems);
      const shareData = await generateShareCode(shareableItems);
      
      if (!shareData) {
        alert("Failed to generate shareable link");
        return;
      }

      // Use the HTTPS URL which is clickable in text messages
      const installNote = "(Don't have the app? Tap the link to download it, then tap the link again to load this itinerary.)";
      const fullMessage = `Check out my LA Art Openings itinerary!\n\n${shareData.url}\n\n${installNote}`;

      if (Platform.OS === "web") {
        try {
          await navigator.clipboard.writeText(fullMessage);
          alert("Link copied to clipboard!");
        } catch (error) {
          console.error("Failed to copy to clipboard:", error);
          alert("Failed to copy link");
        }
      } else {
        try {
          console.log("[Share] Attempting to share link on native platform");
          await Share.share({
            message: fullMessage,
          });
          console.log("[Share] Share successful");
        } catch (error: any) {
          console.error("[Share] Failed to share link:", error.message, error);
        }
      }
    } finally {
      setIsShorteningUrl(false);
      setShowShareOptions(false);
    }
  }, [displayItems]);

  // Render item for DraggableFlatList with swipe-to-reveal edit/delete
  const renderDraggableItem = useCallback(
    ({ item, drag, isActive, getIndex }: RenderItemParams<(typeof sortedItems)[0]>) => {
      const itemIndex = getIndex() ?? 0;
      // Offset by 1 if there is a pinned starting location (which occupies position 1)
      const displayNumber = startingLocationItem ? itemIndex + 2 : itemIndex + 1;
      if (!item || !item.id) return null;

      const renderRightActions = () => (
        <View style={styles.swipeActions}>
          <Pressable
            style={[styles.swipeEditAction, { backgroundColor: colors.primary }]}
            onPress={() => router.push({ pathname: "/edit-stop", params: { id: item.id } })}
          >
            <Text style={styles.swipeActionText}>✎</Text>
          </Pressable>
          <Pressable
            style={[styles.swipeDeleteAction, { backgroundColor: colors.error }]}
            onPress={() => handleRemoveItem(item.id)}
          >
            <IconSymbol name="trash" size={18} color="#fff" />
          </Pressable>
        </View>
      );

      return (
        <ScaleDecorator activeScale={1.03}>
          <ReanimatedSwipeable
            renderRightActions={renderRightActions}
            rightThreshold={40}
            overshootRight={false}
          >
            <Pressable
              onPress={() => {
                const navId = item.type === 'article' ? item.articleId : item.id;
                if (navId) {
                  const fullArticle = curateData?.openings?.find((a: any) => a.id === navId);
                  
                  if (fullArticle) {
                    setCurrentOpening({
                      id: fullArticle.id ?? '',
                      title: fullArticle.exhibition ?? '',
                      creator: fullArticle.venue ?? '',
                      pubDate: fullArticle.date ?? '',
                      imageUrl: fullArticle.imageUrl ?? '',
                      address: fullArticle.address ?? '',
                      time: fullArticle.time ?? '',
                      endDate: fullArticle.endDate ?? '',
                      description: fullArticle.description ?? '',
                      tags: fullArticle.tags ?? [],
                      link: '',
                      galleryWebsite: fullArticle.galleryWebsite ?? '',
                    });
                  } else {
                    setCurrentOpening({
                      id: navId,
                      title: item.title,
                      creator: item.creator || '',
                      pubDate: item.date || '',
                      imageUrl: item.imageUrl || '',
                      address: item.address || item.location || '',
                      time: item.time || '',
                      endDate: '',
                      description: (item as any).description || item.notes || '',
                      tags: (item as any).tags || [],
                      link: (item as any).link || '',
                      galleryWebsite: (item as any).galleryWebsite || '',
                    });
                  }
                  router.push(`/article/${navId}`);
                }
              }}
            >
            <View
              style={[
                styles.itemContainer,
                {
                  borderColor: isActive ? colors.primary : colors.border,
                  backgroundColor: isActive ? colors.surface : colors.surface,
                  opacity: isActive ? 0.95 : 1,
                },
              ]}
            >
              <View style={[styles.itemNumber, { backgroundColor: colors.primary, overflow: 'hidden' }]}>
                {item.imageUrl ? (
                  <>
                    <Image
                      source={{ uri: item.imageUrl }}
                      style={styles.itemNumberImage}
                    />
                    <View style={[styles.itemNumberOverlay, { backgroundColor: 'transparent' }]}>
                      <Text style={[styles.itemNumberText, { color: '#fff', fontWeight: '900', textShadowColor: 'rgba(0, 0, 0, 0.8)', textShadowOffset: { width: 1, height: 1 }, textShadowRadius: 2 }]}>
                        {displayNumber}
                      </Text>
                    </View>
                  </>
                ) : (
                  <Text style={[styles.itemNumberText, { color: colors.background }]}>
                    {displayNumber}
                  </Text>
                )}
              </View>

              <View style={styles.itemContent}>
                <Text style={[styles.itemTitle, { color: colors.foreground }]} numberOfLines={1}>
                  {item.title}
                </Text>
                {item.creator && (
                  <Text style={[styles.itemGallery, { color: colors.muted }]} numberOfLines={1}>
                    {item.creator}
                  </Text>
                )}
                {item.time && (
                  <Text style={[styles.itemTime, { color: colors.muted }]} numberOfLines={1}>
                    {item.time}
                  </Text>
                )}
                {item.location && (
                  <Text style={[styles.itemLocation, { color: colors.muted }]} numberOfLines={1}>
                    {item.location}
                  </Text>
                )}
              </View>

              {/* Drag handle — always visible on right */}
              <Pressable
                onLongPress={drag}
                onPressIn={drag}
                delayLongPress={0}
                style={styles.dragHandleButton}
                hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
              >
                <Text style={[styles.dragHandle, { color: colors.primary }]}>≡</Text>
              </Pressable>
            </View>
            </Pressable>
          </ReanimatedSwipeable>
        </ScaleDecorator>
      );
    },
    [colors, router, handleRemoveItem]
  );

  // Render item for regular FlatList (non-Manual mode)
  const renderItem = ({ item, index }: { item: (typeof sortedItems)[0]; index: number }) => {
    const itemIndex = index;
    if (!item || !item.id) {
      return null;
    }
    return (
      <View style={[styles.itemContainer, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <View style={[styles.itemNumber, { backgroundColor: colors.primary, overflow: 'hidden' }]}>
          {item.imageUrl ? (
            <>
              <Image
                source={{ uri: item.imageUrl }}
                style={styles.itemNumberImage}
              />
              <View style={[styles.itemNumberOverlay, { backgroundColor: 'rgba(0, 0, 0, 0.4)' }]}>
                <Text style={[styles.itemNumberText, { color: colors.background }]}>
                  {itemIndex + 1}
                </Text>
              </View>
            </>
          ) : (
            <Text style={[styles.itemNumberText, { color: colors.background }]}>
              {itemIndex + 1}
            </Text>
          )}
        </View>

        <View style={styles.itemContent}>
          <Text style={[styles.itemTitle, { color: colors.foreground }]} numberOfLines={1}>
            {item.title}
          </Text>

          {item.creator && (
            <Text style={[styles.itemGallery, { color: colors.muted }]} numberOfLines={1}>
              {item.creator}
            </Text>
          )}
          {item.time && (
            <Text style={[styles.itemTime, { color: colors.muted }]} numberOfLines={1}>
              ⏰ {item.time}
            </Text>
          )}
          {item.location && (
            <Text style={[styles.itemLocation, { color: colors.muted }]} numberOfLines={1}>
              📍 {item.location}
            </Text>
          )}
        </View>

        <View style={styles.actionButtons}>
          {/* Hamburger icon — always visible, drag only works on hamburger */}
          <Pressable
            onLongPress={() => {
              // Drag only works on hamburger in non-draggable mode
              // This is a placeholder - actual dragging happens in DraggableFlatList
            }}
            onPressIn={() => {}}
            delayLongPress={0}
            style={styles.dragHandleButton}
            hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
          >
            <Text style={[styles.dragHandle, { color: colors.primary }]}>≡</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push({ pathname: "/edit-stop", params: { id: item.id } })}
            style={({ pressed }) => [
              styles.editButton,
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Text style={{ fontSize: 14, color: colors.primary }}>✎</Text>
          </Pressable>
          <Pressable
            onPress={() => handleRemoveItem(item.id)}
            style={({ pressed }) => [
              styles.removeButton,
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <IconSymbol name="xmark" size={20} color={colors.muted} />
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>Itinerary</Text>
            {sortedItems.length > 0 && (
              <Text style={[styles.headerSubtitle, { color: colors.muted }]}>
                {hasUserSorted ? "User sorted" : sortTapCount === 0 ? "Hold ≡ to drag and reorder" : sortTapCount % 2 === 1 ? "Smart sorted" : "AI sorted"}
              </Text>
            )}
          </View>
          <View style={styles.headerButtons}>
            {sortedItems.length > 0 && (
              <>
                {/* Single Sort button: 1st tap = smart sort, 2nd tap = Groq AI sort, alternates */}
                <TouchableOpacity
                  onPress={() => {
                    const nextTap = sortTapCount + 1;
                    setSortTapCount(nextTap);
                    setHasUserSorted(false);
                    if (nextTap % 2 === 1) {
                      itinerary.resortItems();
                    } else {
                      itinerary.resortItemsAI();
                    }
                  }}
                  disabled={itinerary.isGroqSorting}
                  style={[styles.reorderButton, { backgroundColor: colors.primary, borderColor: colors.border, opacity: itinerary.isGroqSorting ? 0.6 : 1 }]}
                >
                  <Text style={[styles.reorderButtonText, { color: colors.background }]}>
                    {itinerary.isGroqSorting ? 'Sorting…' : 'Sort'}
                  </Text>
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity
              onPress={() => router.push("/saved-itineraries")}
              style={[styles.reorderButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Text style={[styles.reorderButtonText, { color: colors.foreground }]}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setShowResetConfirm(true)}
              style={[styles.resetButton, { backgroundColor: colors.foreground }]}
            >
              <Text style={[styles.resetButtonText, { color: colors.background }]}>Clear</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <Modal
        visible={showResetConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowResetConfirm(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}
          >
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Clear Itinerary?</Text>
            <Text style={[styles.modalText, { color: colors.muted }]}>
              This will clear all stops from your itinerary. This action cannot be undone.
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                onPress={() => setShowResetConfirm(false)}
                style={[styles.modalButton, { backgroundColor: colors.border }]}
              >
                <Text style={[styles.modalButtonText, { color: colors.foreground }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleResetData}
                style={[styles.modalButton, { backgroundColor: colors.foreground }]}
              >
                <Text style={[styles.modalButtonText, { color: colors.background }]}>Clear</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {sortedItems.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            No stops yet
          </Text>
          <Text style={[styles.emptyText, { color: colors.muted }]}>
            Check openings from the feed or add custom stops to build your itinerary.
          </Text>
        </View>
      ) : (
        <GestureHandlerRootView style={{ flex: 1 }}>
          <DraggableFlatList
            data={flatListData}
            keyExtractor={(item) => item.id}
            renderItem={renderDraggableItem}
            onDragEnd={({ data }) => {
              // Reorder only the draggable items; starting location stays pinned at position 0
              const startingIds = startingLocationItem ? [startingLocationItem.id] : [];
              const newOrder = [...startingIds, ...data.map((item) => item.id)];
              itinerary.reorderItems(newOrder);
              setHasUserSorted(true);
            }}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <>
                {Platform.OS !== 'web' && <MapPreview items={displayItems} />}
                {startingLocationItem && startingLocationItem.id === 'your-location' && (
                  <View style={[styles.itemContainer, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                    <View style={[styles.itemNumber, { backgroundColor: colors.primary }]}>
                      <Text style={[styles.itemNumberText, { color: colors.background }]}>📍</Text>
                    </View>
                    <View style={styles.itemContent}>
                      <Text style={[styles.itemTitle, { color: colors.foreground }]} numberOfLines={1}>
                        Your Location
                      </Text>
                      <Text style={[styles.itemLocation, { color: colors.muted }]} numberOfLines={1}>
                        {currentLocation ? `${currentLocation.lat.toFixed(4)}, ${currentLocation.lng.toFixed(4)}` : 'Getting location...'}
                      </Text>
                      <Text style={[styles.itemTime, { color: colors.muted }]} numberOfLines={1}>
                        Live GPS · updates as you move
                      </Text>
                    </View>
                  </View>
                )}
                {startingLocationItem && startingLocationItem.id !== 'your-location' && (
                  <ReanimatedSwipeable
                    renderRightActions={() => (
                      <View style={styles.swipeActions}>
                        <Pressable
                          style={[styles.swipeEditAction, { backgroundColor: colors.primary }]}
                          onPress={() => router.push({ pathname: "/edit-stop", params: { id: startingLocationItem.id } })}
                        >
                          <Text style={styles.swipeActionText}>✎</Text>
                        </Pressable>
                        <Pressable
                          style={[styles.swipeDeleteAction, { backgroundColor: colors.error }]}
                          onPress={() => handleRemoveItem(startingLocationItem.id)}
                        >
                          <IconSymbol name="trash" size={18} color="#fff" />
                        </Pressable>
                      </View>
                    )}
                    rightThreshold={40}
                    overshootRight={false}
                  >
                    <View style={[styles.itemContainer, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                      <View style={[styles.itemNumber, { backgroundColor: colors.primary }]}>
                        <Text style={[styles.itemNumberText, { color: colors.background }]}>1</Text>
                      </View>
                      <View style={styles.itemContent}>
                        <Text style={[styles.itemTitle, { color: colors.foreground }]} numberOfLines={1}>
                          {startingLocationItem.title}
                        </Text>
                        {startingLocationItem.location && (
                          <Text style={[styles.itemLocation, { color: colors.muted }]} numberOfLines={1}>
                            {startingLocationItem.location}
                          </Text>
                        )}
                      </View>
                    </View>
                  </ReanimatedSwipeable>
                )}
              </>
            }
            activationDistance={5}
          />
        </GestureHandlerRootView>
      )}

      {/* Bottom Button Container */}
      <View
        style={[
          styles.bottomButtonContainer,
          {
            flexDirection: "row",
            gap: 8,
            backgroundColor: colors.background,
            borderTopColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          style={[styles.addButton, { backgroundColor: colors.primary, flex: 1 }]}
          onPress={() => router.push("/add-stop")}
          activeOpacity={0.85}
        >
          <Text style={[styles.addButtonText, { color: colors.background }]}>+ Add Stop</Text>
        </TouchableOpacity>
        {sortedItems.length > 0 && (
          <>
            <TouchableOpacity
              style={[styles.mapsButton, { backgroundColor: colors.primary, flex: 1 }]}
              onPress={handleOpenMaps}
              activeOpacity={0.85}
            >
              <Text style={[styles.mapsButtonText, { color: colors.background }]}>
                Open in Maps
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.shareButton, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, flex: 1 }]}
              onPress={handleShareItinerary}
              activeOpacity={0.85}
            >
              <Text style={[styles.shareButtonText, { color: colors.foreground }]}>Share</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Share Options Modal */}
      <Modal
        visible={showShareOptions}
        transparent
        animationType="slide"
        onRequestClose={() => setShowShareOptions(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowShareOptions(false)}
        >
          <Pressable
            style={[styles.shareOptionsContainer, { backgroundColor: colors.surface }]}
          >
            <Text style={[styles.shareOptionsTitle, { color: colors.foreground }]}>
              Share Itinerary
            </Text>

            <Pressable
              style={[styles.shareOption, { borderBottomColor: colors.border }]}
              onPress={() => handleShareAsText()}
            >
              <Text style={[styles.shareOptionText, { color: colors.foreground }]}>
                Share as Text
              </Text>
              <Text style={[styles.shareOptionSubtext, { color: colors.muted }]}>
                Share formatted list
              </Text>
            </Pressable>

            <Pressable
              style={[styles.shareOption, { borderBottomColor: colors.border }]}
              onPress={() => handleShareAsDeepLink()}
            >
              <Text style={[styles.shareOptionText, { color: colors.foreground }]}>
                Share as App Link
              </Text>
              <Text style={[styles.shareOptionSubtext, { color: colors.muted }]}>
                Opens in LA Art Openings app
              </Text>
            </Pressable>


          </Pressable>
        </Pressable>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  reorderButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  reorderButtonText: {
    fontSize: 12,
    fontWeight: "600",
  },
  headerButtons: {
    flexDirection: "row",
    gap: 8,
  },
  resetButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  resetButtonText: {
    fontSize: 12,
    fontWeight: "600",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    borderRadius: 12,
    padding: 20,
    width: "80%",
    maxWidth: 300,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 12,
  },
  modalText: {
    fontSize: 14,
    marginBottom: 20,
    lineHeight: 20,
  },
  modalButtons: {
    flexDirection: "row",
    gap: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  modalButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "800",
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 12,
    fontWeight: "500",
    letterSpacing: 0.5,
  },

  listContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 200,
  },

  itemContainer: {
    flexDirection: "row",
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 12,
    alignItems: "flex-start",
  },

  itemNumber: {
    width: 57,
    height: 57,
    borderRadius: 28.5,
    alignItems: "center",
    justifyContent: "center",
    margin: 12,
    minWidth: 57,
  },

  itemNumberText: {
    fontSize: 14,
    fontWeight: "700",
  },

  itemNumberImage: {
    width: 57,
    height: 57,
    borderRadius: 28.5,
  },

  itemNumberOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },

  itemContent: {
    flex: 1,
    paddingVertical: 12,
    paddingRight: 12,
    gap: 4,
  },

  itemGallery: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },

  itemTitle: {
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 20,
  },

  itemLocation: {
    fontSize: 12,
    lineHeight: 16,
  },

  itemDate: {
    fontSize: 12,
    lineHeight: 16,
  },

  itemTime: {
    fontSize: 12,
    lineHeight: 16,
  },

  itemNotes: {
    fontSize: 12,
    lineHeight: 16,
    fontStyle: "italic",
  },

  actionButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingRight: 12,
  },

  dragHandleButton: {
    width: 32,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },

  dragHandle: {
    fontSize: 20,
    fontWeight: "700",
  },

  editButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  removeButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  swipeActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingRight: 12,
  },
  swipeEditAction: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
  },
  swipeDeleteAction: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
  },
  swipeActionText: {
    fontSize: 18,
    color: "#fff",
  },

  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 8,
  },

  emptyTitle: {
    fontSize: 20,
    fontWeight: "700",
  },

  emptyText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },

  bottomButtonContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
  },

  addButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },

  addButtonText: {
    fontSize: 13,
    fontWeight: "600",
  },

  buttonRow: {
    flexDirection: "row",
    gap: 8,
  },

  mapsButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },

  mapsButtonText: {
    fontSize: 12,
    fontWeight: "600",
  },

  shareButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },

  shareButtonText: {
    fontSize: 12,
    fontWeight: "600",
  },

  shareOptionsContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 16,
    paddingBottom: 40,
  },

  shareOptionsTitle: {
    fontSize: 16,
    fontWeight: "700",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },

  shareOption: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },

  shareOptionText: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
  },

  shareOptionSubtext: {
    fontSize: 13,
  },
});
