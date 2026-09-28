import { useEffect, useState, useCallback } from "react";
import { FlatList, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useCurateLAOpenings } from "@/hooks/use-curate-la";
import { ArticleCard } from "@/components/article-card";
import { SkeletonCard } from "@/components/skeleton-card";
import { useItinerary } from "@/lib/itinerary-context";
import { setCurrentOpening } from "@/lib/opening-store";
import { AppHeader } from "@/components/app-header";
import { useCommunityStats } from "@/hooks/use-community-stats";

export default function FeedScreen() {
  const colors = useColors();
  const router = useRouter();
  const routeParams = useLocalSearchParams<{ date?: string }>();
  const routeDate = typeof routeParams.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(routeParams.date)
    ? routeParams.date
    : "";
  const { data: curateData, isLoading, error, refetch } = useCurateLAOpenings();
  const [showTodayOnly, setShowTodayOnly] = useState(false);
  
  // Debug logging
  useEffect(() => {
    if (error) {
      console.log('[Feed] API Error:', error);
    }
    if (curateData?.openings) {
      console.log('[Feed] Loaded openings:', curateData.openings.length);
    }
  }, [error, curateData]);
  const [sortByDate, setSortByDate] = useState(true);
  const [selectedDate, setSelectedDate] = useState<Date | null>(() =>
    routeDate ? new Date(`${routeDate}T00:00:00`) : null,
  );
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [isSorting, setIsSorting] = useState(false);
  const itinerary = useItinerary();

  const updateSelectedDate = useCallback((date: Date | null) => {
    setSelectedDate(date);
    router.setParams({ date: date ? date.toISOString().slice(0, 10) : undefined });
  }, [router]);

  const openings = curateData?.openings || [];
  const community = useCommunityStats(
    openings.map((opening) => ({ id: opening.id, galleryName: opening.venue })),
  );

  // Filter by selected date
  let filteredOpenings = openings;
  
  if (selectedDate) {
    const selectedDateStr = selectedDate.toISOString().split('T')[0];
    filteredOpenings = openings.filter((opening) => {
      return opening.date === selectedDateStr;
    });
  }

  const normalizedSearch = searchQuery.trim().toLowerCase();
  if (normalizedSearch) {
    filteredOpenings = filteredOpenings.filter((opening) => {
      const searchableText = [
        opening.exhibition,
        opening.venue,
        opening.address,
        opening.date,
        opening.time,
        opening.description,
        ...(opening.tags || []),
      ].filter(Boolean).join(" ").toLowerCase();
      return searchableText.includes(normalizedSearch);
    });
  }

  // Sort by date or gallery name
  filteredOpenings = [...filteredOpenings].sort((a, b) => {
    if (sortByDate) {
      return a.date.localeCompare(b.date);
    } else {
      return a.venue.localeCompare(b.venue);
    }
  });

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } catch (e) {
      console.error('[Feed] Refresh error:', e);
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const handleSort = useCallback(() => {
    setIsSorting(true);
    try {
      // resortItems applies local sort immediately then refines with Groq in background
      itinerary.resortItems();
    } catch (error) {
      console.error('[Feed] Sort error:', error);
    } finally {
      setIsSorting(false);
      router.push('/(tabs)/itinerary');
    }
  }, [itinerary, router]);

  const handleOpeningPress = useCallback(
        (opening: any) => {
      // Store full opening data in memory to avoid Expo Router param truncation on native.
      // ArticleCard passes the article object directly, which uses title/creator field names.
      setCurrentOpening({
        id: opening.id ?? "",
        title: opening.title ?? opening.exhibition ?? "",
        creator: opening.creator ?? opening.venue ?? "",
        pubDate: opening.pubDate ?? opening.date ?? "",
        imageUrl: opening.imageUrl || "",
        address: opening.address ?? "",
        time: opening.time ?? "",
        endDate: opening.endDate ?? "",
        description: opening.description ?? "",
        tags: opening.categories ?? opening.tags ?? [],
        link: opening.link ?? "",
        galleryWebsite: opening.galleryWebsite ?? "",
      });
      router.push({
        pathname: "/article/[id]" as any,
        params: {
          id: opening.id,
          feedDate: selectedDate ? selectedDate.toISOString().slice(0, 10) : "",
        },
      });
    },
    [router, selectedDate]
  );

  // Keep all hooks above this error return so their call order is stable across renders.
  if (error) {
    return (
      <ScreenContainer className="justify-center items-center p-4">
        <Text className="text-red-500 text-center text-lg font-semibold mb-4">Error loading events</Text>
        <Text className="text-muted text-center mb-6">{String(error)}</Text>
        <TouchableOpacity className="bg-primary px-6 py-3 rounded-full" onPress={() => refetch()}>
          <Text className="text-background font-semibold">Retry</Text>
        </TouchableOpacity>
      </ScreenContainer>
    );
  }

  const renderHeader = () => (
    <View>
      <AppHeader />
      <View style={styles.header}>
      <Text style={[styles.helperText, { color: colors.muted }]}>
        Click checkbox to add to itinerary
      </Text>


      {/* Filters & Sorting — single row: [Date/Pick Date] [Sort (n)] [Clear] */}
      <View style={styles.filterRow}>
        {/* Date button — always visible; shows selected date or "Pick Date" */}
        <TouchableOpacity
          style={[
            styles.todayToggle,
            {
              backgroundColor: "transparent",
              borderColor: colors.primary,
              borderWidth: 2,
            },
          ]}
          onPress={() => setShowDatePicker(true)}
          activeOpacity={0.8}
        >
          <Text
            style={[
              styles.todayToggleText,
              {
                color: colors.primary,
              },
            ]}
          >
            {selectedDate ? selectedDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "Pick Date"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.searchButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => setShowSearch(true)}
          activeOpacity={0.8}
        >
          <Text style={[styles.searchButtonText, { color: colors.foreground }]}>Search</Text>
        </TouchableOpacity>

        {/* Sort button — only when items are selected */}
        {itinerary.selectedArticleIds.size > 0 && (
          <TouchableOpacity
            style={[
              styles.sortButton,
              {
                backgroundColor: colors.primary,
                opacity: isSorting ? 0.6 : 1,
              },
            ]}
            onPress={handleSort}
            disabled={isSorting}
          >
            {isSorting ? (
              <ActivityIndicator color={colors.background} size="small" />
            ) : (
              <Text style={[styles.sortButtonText, { color: colors.background }]}>
                Sort ({itinerary.selectedArticleIds.size})
              </Text>
            )}
          </TouchableOpacity>
        )}

        {/* Clear button — only when a date is selected OR items are checked */}
        {(selectedDate || itinerary.selectedArticleIds.size > 0) && (
          <TouchableOpacity
            style={[styles.clearButton, { borderColor: colors.border, backgroundColor: colors.surface }]}
            onPress={() => {
              updateSelectedDate(null);
              // Remove all article-type items from itinerary (keep custom stops)
              const articleIds = Array.from(itinerary.selectedArticleIds);
              articleIds.forEach((id) => itinerary.removeArticle(id));
            }}
            activeOpacity={0.8}
          >
            <Text style={[styles.clearButtonText, { color: colors.foreground }]}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>
      <Text style={[styles.sourceInfo, { color: colors.muted }]}>
        {normalizedSearch ? `${filteredOpenings.length} matching openings` : itinerary.selectedArticleIds.size > 0 ? `${itinerary.selectedArticleIds.size} selected` : `${filteredOpenings.length} openings`}
      </Text>
    </View>
    </View>
  );

  // Generate list of all dates that have events (show all dates, not just future)
  const uniqueDates = Array.from(
    new Set(
      openings
        .map((opening) => opening.date)
        .filter((dateStr) => !!dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr))
    )
  )
    .sort()
    .map((dateStr) => new Date(dateStr + 'T00:00:00'))
    .filter((d) => !isNaN(d.getTime()));

  const renderDatePicker = () => (
    <Modal
      visible={showDatePicker}
      transparent
      animationType="slide"
      onRequestClose={() => setShowDatePicker(false)}
    >
      <View style={[styles.datePickerOverlay, { backgroundColor: "rgba(0,0,0,0.5)" }]}>
        <View style={[styles.datePickerContainer, { backgroundColor: colors.background }]}>
          <View style={[styles.datePickerHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.datePickerTitle, { color: colors.foreground }]}>
              Select Date
            </Text>
            <Pressable onPress={() => setShowDatePicker(false)}>
              <Text style={[styles.datePickerClose, { color: colors.muted }]}>✕</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.datePickerList} showsVerticalScrollIndicator={false}>
            {uniqueDates.map((date) => {
              const isSelected = selectedDate && selectedDate.toDateString() === date.toDateString();
              const dateStr = date.toISOString().split('T')[0];
              // Count openings for this date
              const countForDate = openings.filter((o) => o.date === dateStr).length;
              
              return (
                <Pressable
                  key={date.toISOString()}
                  onPress={() => {
                    updateSelectedDate(date);
                    setShowDatePicker(false);
                    setShowTodayOnly(false);
                  }}
                  style={[
                    styles.datePickerItem,
                    {
                      backgroundColor: isSelected ? colors.primary : colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.datePickerItemText,
                      { color: isSelected ? colors.background : colors.foreground },
                    ]}
                  >
                    {date.toLocaleDateString("en-US", {
                      weekday: "long",
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </Text>
                  <Text
                    style={[
                      styles.datePickerItemCount,
                      { color: isSelected ? colors.background : colors.muted },
                    ]}
                  >
                    {countForDate} opening{countForDate !== 1 ? "s" : ""}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  const renderSearch = () => (
    <Modal visible={showSearch} transparent animationType="slide" onRequestClose={() => setShowSearch(false)}>
      <View style={styles.datePickerOverlay}>
        <View style={[styles.searchContainer, { backgroundColor: colors.background }]}>
          <View style={[styles.datePickerHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.datePickerTitle, { color: colors.foreground }]}>Search Feed</Text>
            <Pressable onPress={() => setShowSearch(false)} hitSlop={8}>
              <Text style={[styles.datePickerClose, { color: colors.muted }]}>✕</Text>
            </Pressable>
          </View>
          <TextInput
            autoFocus
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search gallery, title, address…"
            placeholderTextColor={colors.muted}
            returnKeyType="search"
            style={[styles.searchInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]}
          />
          <TouchableOpacity onPress={() => setShowSearch(false)} style={[styles.searchDoneButton, { backgroundColor: colors.primary }]}>
            <Text style={{ color: colors.background, fontWeight: "800", textAlign: "center" }}>Done</Text>
          </TouchableOpacity>
          {!!searchQuery && (
            <Pressable onPress={() => setSearchQuery("")} style={styles.clearSearchButton}>
              <Text style={{ color: colors.muted, textAlign: "center" }}>Clear search</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );

  if (isLoading && openings.length === 0) {
    return (
      <ScreenContainer>
        <FlatList
          data={[1, 2, 3]}
          keyExtractor={(item) => String(item)}
          renderItem={() => <SkeletonCard />}
          ListHeaderComponent={renderHeader}
          contentContainerStyle={styles.listContent}
          scrollEnabled={false}
        />
      </ScreenContainer>
    );
  }

  if (filteredOpenings.length === 0) {
    return (
      <ScreenContainer>
        <FlatList
          data={filteredOpenings}
          keyExtractor={(item) => item.id}
          renderItem={() => null}
          ListHeaderComponent={renderHeader}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={[styles.emptyText, { color: colors.muted }]}>
                {normalizedSearch ? `No openings match “${searchQuery}”` : showTodayOnly ? "No openings today" : "No openings available"}
              </Text>
            </View>
          }
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
          }
        />
        {renderDatePicker()}
        {renderSearch()}
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <FlatList
        data={filteredOpenings}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ArticleCard
            article={{
              id: item.id,
              title: item.exhibition,
              link: `https://curate.la/?opening=${item.id}`,
              pubDate: item.date,
              creator: item.venue,
              categories: item.tags,
              content: `${item.venue}\n${item.address}\n\nDate: ${item.date}${item.time ? `\nTime: ${item.time}` : ""}${item.description ? `\n\n${item.description}` : ""}`,
              excerpt: `${item.date}`,
              imageUrl: item.imageUrl || null,
              time: item.time,
              address: item.address,
              description: item.description,
              galleryWebsite: item.galleryWebsite || "",
            } as any}
            onPress={handleOpeningPress}
            showCheckbox
            isGalleryFavorited={community.galleriesByName.get(item.venue)?.isFavorited ?? false}
            onToggleGalleryFavorite={community.toggleFavorite}
          />
        )}
        ListHeaderComponent={renderHeader}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      />
      {renderDatePicker()}
      {renderSearch()}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingBottom: 24,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    gap: 8,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  helperText: {
    fontSize: 11,
    marginTop: 2,
    marginBottom: 2,
  },
  headerSubtitle: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  headerDivider: {
    height: 2,
    marginTop: 12,
    marginBottom: 12,
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 8,
    flexWrap: "wrap",
  },
  todayToggle: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  todayToggleText: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  searchButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  searchButtonText: {
    fontSize: 12,
    fontWeight: "700",
  },
  searchContainer: {
    width: "100%",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    gap: 12,
  },
  searchInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 16,
  },
  searchDoneButton: {
    borderRadius: 10,
    paddingVertical: 12,
  },
  clearSearchButton: {
    paddingVertical: 4,
  },
  sortToggle: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  sortToggleText: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  sortButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 0,
  },
  sortButtonText: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  datePickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    marginBottom: 8,
  },
  selectedDateText: {
    fontSize: 13,
    fontWeight: "600",
  },
  clearDateButton: {
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  clearDateText: {
    fontSize: 12,
    fontWeight: "600",
  },
  clearButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  clearButtonText: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  sourceInfo: {
    fontSize: 11,
    fontWeight: "500",
  },
  emptyContainer: {
    paddingTop: 60,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 15,
  },
  datePickerOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  datePickerContainer: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "80%",
  },
  datePickerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  datePickerTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  datePickerClose: {
    fontSize: 24,
    fontWeight: "300",
  },
  datePickerList: {
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  datePickerItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  datePickerItemText: {
    fontSize: 14,
    fontWeight: "600",
    flex: 1,
  },
  datePickerItemCount: {
    fontSize: 12,
    fontWeight: "500",
  },
});
