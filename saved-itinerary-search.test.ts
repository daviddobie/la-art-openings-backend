import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(__dirname, "..");

describe("saved itineraries and feed search", () => {
  it("provides a saved-itineraries screen with save, load, delete, and favorites sections", () => {
    const source = readFileSync(resolve(projectRoot, "app/saved-itineraries.tsx"), "utf8");
    expect(source).toContain("la_gallery_saved_itineraries_v1");
    expect(source).toContain("Save Current Itinerary");
    expect(source).toContain("handleLoad");
    expect(source).toContain("handleDelete");
    expect(source).toContain("Favorite Galleries");
    expect(source).toContain("fetchFavoriteGalleries");
  });

  it("adds the itinerary save-management entry point", () => {
    const source = readFileSync(resolve(projectRoot, "app/(tabs)/itinerary.tsx"), "utf8");
    expect(source).toContain('router.push("/saved-itineraries")');
    expect(source).toContain(">Save</Text>");
  });

  it("searches feed content across titles, galleries, addresses, dates, and descriptions", () => {
    const source = readFileSync(resolve(projectRoot, "app/(tabs)/index.tsx"), "utf8");
    expect(source).toContain("Search Feed");
    expect(source).toContain("const normalizedSearch = searchQuery.trim().toLowerCase()");
    expect(source).toContain("opening.venue");
    expect(source).toContain("opening.address");
    expect(source).toContain("opening.description");
    expect(source).toContain("setShowSearch(true)");
  });

  it("exposes favorite galleries and restores selected articles when loading items", () => {
    const router = readFileSync(resolve(projectRoot, "server/routers.ts"), "utf8");
    const db = readFileSync(resolve(projectRoot, "server/db.ts"), "utf8");
    const context = readFileSync(resolve(projectRoot, "lib/itinerary-context.tsx"), "utf8");
    expect(router).toContain("getFavoriteGalleries");
    expect(db).toContain("getFavoriteGalleries(deviceId: string)");
    expect(context).toContain("setSelectedArticleIds(new Set(sharedItems");
  });
});
