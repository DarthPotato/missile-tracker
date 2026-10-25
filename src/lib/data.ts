// Loads and validates the JSON data at build time (Astro + Vitest both run on
// Vite, so import.meta.glob works in either). Node scripts use load-node.ts.
import munitionsJson from "../../data/munitions.json";
import perspectiveJson from "../../data/perspective.json";
import photosJson from "../../data/photos.json";
import type { ImageMetadata } from "astro";
import { PerspectiveFile, PhotosFile, type MunitionId, type Photo } from "./schema";
import { buildDataset, type Dataset } from "./dataset";

const reportModules = import.meta.glob<{ default: unknown }>("../../data/reports/*.json", { eager: true });

let cached: Dataset | undefined;

export function getDataset(): Dataset {
  if (!cached) {
    const reports = Object.entries(reportModules).map(([path, mod]) => ({
      file: path.split("/").pop()!,
      json: mod.default,
    }));
    cached = buildDataset(munitionsJson, reports);
  }
  return cached;
}

let perspective: PerspectiveFile | undefined;

export function getPerspective(): PerspectiveFile {
  return (perspective ??= PerspectiveFile.parse(perspectiveJson));
}

const photoFiles = import.meta.glob<{ default: ImageMetadata }>("../assets/photos/*.jpg", { eager: true });
const photos = PhotosFile.parse(photosJson);

/** A missile's photo and its image file, or undefined if it has none. */
export function getPhoto(id: MunitionId): { photo: Photo; image: ImageMetadata } | undefined {
  const photo = photos[id];
  const file = photoFiles[`../assets/photos/${id}.jpg`];
  if (!photo) return undefined;
  if (!file) throw new Error(`data/photos.json has ${id} but src/assets/photos/${id}.jpg is missing`);
  return { photo, image: file.default };
}

export function getAllPhotos(): [MunitionId, Photo][] {
  return Object.entries(photos) as [MunitionId, Photo][];
}
