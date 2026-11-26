// Loads and validates the JSON data at build time (Astro + Vitest both run on
// Vite, so import.meta.glob works in either). Node scripts use load-node.ts.
import munitionsJson from "../../data/munitions.json";
import perspectiveJson from "../../data/perspective.json";
import photosJson from "../../data/photos.json";
import aircraftPhotosJson from "../../data/aircraft-photos.json";
import liveJson from "../../data/live/events.json";
import dronesJson from "../../data/drones.json";
import droneClaimsJson from "../../data/live/drone-claims.json";
import { LiveFile } from "./live";
import { DroneClaimsFile } from "./drones";
import type { ImageMetadata } from "astro";
import {
  AircraftPhotosFile,
  DronesFile,
  PerspectiveFile,
  PhotosFile,
  type AircraftId,
  type MunitionId,
  type Photo,
} from "./schema";
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

let live: LiveFile | undefined;

/** The unverified live intercept log (data/live/events.json). */
export function getLive(): LiveFile {
  return (live ??= LiveFile.parse(liveJson));
}

let drones: DronesFile | undefined;

/** Sourced fleet and loss figures for U.S. drones (data/drones.json). */
export function getDrones(): DronesFile {
  return (drones ??= DronesFile.parse(dronesJson));
}

let droneClaims: DroneClaimsFile | undefined;

/** Iranian and Houthi drone shoot-down claims logged by the live feed (unverified). */
export function getDroneClaims(): DroneClaimsFile {
  return (droneClaims ??= DroneClaimsFile.parse(droneClaimsJson));
}

const aircraftFiles = import.meta.glob<{ default: ImageMetadata }>("../assets/photos/aircraft/*.jpg", { eager: true });
const aircraftPhotos = AircraftPhotosFile.parse(aircraftPhotosJson);

/** An aircraft type's photo and its image file, or undefined if it has none yet. */
export function getAircraftPhoto(id: AircraftId | undefined): { photo: Photo; image: ImageMetadata } | undefined {
  const photo = id && aircraftPhotos[id];
  if (!id || !photo) return undefined;
  const file = aircraftFiles[`../assets/photos/aircraft/${id}.jpg`];
  if (!file) throw new Error(`data/aircraft-photos.json has ${id} but src/assets/photos/aircraft/${id}.jpg is missing`);
  return { photo, image: file.default };
}

export function getAllAircraftPhotos(): [AircraftId, Photo][] {
  return Object.entries(aircraftPhotos) as [AircraftId, Photo][];
}
