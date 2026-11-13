import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { sseSubscribe } from '../services/sseBus';

export interface GalleryImage {
  id: string;
  url: string; // Server URL like /gallery-images/img_xxx.jpg
  caption: string;
  addedAt: string; // ISO timestamp
  /**
   * A shot taken to DOCUMENT something rather than to picture the place — currently the F10 used
   * to record a planetary mining deposit's HUD panel. Set when such a marker is promoted to a
   * deposit, since one keypress serves both purposes and intent is only known afterwards.
   * Representative thumbnails skip these, so a photo of a rock face is never a system's portrait.
   */
  utility?: boolean;
  /** What the co-pilot saw in the shot (1.62.0): the kind, a factual description and Sights tags. */
  vision?: { kind: string; description: string; tags: string[]; at: string; model?: string; silent?: string; fixed?: string[] }; // silent: why it said nothing; fixed: what the app changed in the line (1.62.3)
  /** The co-pilot's in-character remark on this shot, when it made one. */
  copilotLine?: { line: string; persona: string; at: string };
}

// Key format: "system:SystemName" or "system:SystemName:body:BodyName" or "system:SystemName:station:StationName"
type GalleryKey = string;

interface GalleryState {
  images: Record<GalleryKey, GalleryImage[]>;
  addImage: (key: GalleryKey, dataUrl: string, caption: string) => Promise<void>;
  removeImage: (key: GalleryKey, imageId: string) => void;
  updateCaption: (key: GalleryKey, imageId: string, caption: string) => void;
  setPrimaryImage: (key: GalleryKey, imageId: string) => void;
  getImages: (key: GalleryKey) => GalleryImage[];
}

export function galleryKey(systemName: string, type?: 'body' | 'station', name?: string): string {
  const base = `system:${systemName.toLowerCase()}`;
  if (type && name) return `${base}:${type}:${name.toLowerCase()}`;
  return base;
}

// --- Token forwarding for API calls ---
function getToken(): string | null {
  try {
    return sessionStorage.getItem('colony-token') || null;
  } catch {
    return null;
  }
}

function apiUrl(path: string): string {
  const token = getToken();
  return token ? `${path}?token=${token}` : path;
}

// --- Server-side gallery storage adapter ---
// Gallery metadata (keys, URLs, captions) stored in colony-gallery.json via server API.
// Actual image files stored in colony-images/ folder, served at /gallery-images/*.

let serverAvailable: boolean | null = null;

async function checkServer(): Promise<boolean> {
  if (serverAvailable !== null) return serverAvailable;
  try {
    const res = await fetch(apiUrl('/api/gallery'));
    serverAvailable = res.ok;
  } catch {
    serverAvailable = false;
  }
  return serverAvailable;
}

const galleryStorage: StateStorage = {
  getItem: async (): Promise<string | null> => {
    const ok = await checkServer();
    if (!ok) return null;
    try {
      const res = await fetch(apiUrl('/api/gallery'));
      const data = await res.json();
      // Wrap in Zustand persist format
      if (data && Object.keys(data).length > 0) {
        return JSON.stringify({ state: { images: data }, version: 1 });
      }
      return null;
    } catch {
      return null;
    }
  },

  setItem: async (_name: string, value: string): Promise<void> => {
    const ok = await checkServer();
    if (!ok) return;
    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      const state = parsed.state || parsed;
      const images = state.images || {};
      await fetch(apiUrl('/api/gallery'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(images),
      });
    } catch (e) {
      console.error('[Gallery] Failed to save metadata:', e);
    }
  },

  removeItem: async (): Promise<void> => {
    // No-op
  },
};

// --- Upload image to server ---
async function uploadImage(dataUrl: string): Promise<{ id: string; url: string }> {
  const res = await fetch(apiUrl('/api/gallery/upload'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl }),
  });
  if (!res.ok) throw new Error('Upload failed');
  return res.json();
}

// --- Delete image file from server ---
async function deleteImageFile(url: string): Promise<void> {
  // Extract filename from URL like /gallery-images/img_xxx.jpg
  const filename = url.split('/').pop();
  if (!filename) return;
  try {
    await fetch(apiUrl(`/api/gallery/${filename}`), { method: 'DELETE' });
  } catch { /* ignore */ }
}

// ===== Store =====

export const useGalleryStore = create<GalleryState>()(
  persist(
    (set, get) => ({
      images: {},

      addImage: async (key, dataUrl, caption) => {
        try {
          // Upload image to server → get back server URL
          const { id, url } = await uploadImage(dataUrl);
          set((state) => {
            const existing = state.images[key] ?? [];
            return {
              images: {
                ...state.images,
                [key]: [...existing, { id, url, caption, addedAt: new Date().toISOString() }],
              },
            };
          });
        } catch (e) {
          console.error('[Gallery] Upload failed:', e);
        }
      },

      removeImage: (key, imageId) => {
        const existing = get().images[key] ?? [];
        const img = existing.find((i) => i.id === imageId);
        if (img) deleteImageFile(img.url);
        set((state) => ({
          images: {
            ...state.images,
            [key]: (state.images[key] ?? []).filter((i) => i.id !== imageId),
          },
        }));
      },

      updateCaption: (key, imageId, caption) =>
        set((state) => {
          const existing = state.images[key] ?? [];
          return {
            images: {
              ...state.images,
              [key]: existing.map((img) => (img.id === imageId ? { ...img, caption } : img)),
            },
          };
        }),

      setPrimaryImage: (key, imageId) =>
        set((state) => {
          const existing = state.images[key] ?? [];
          const idx = existing.findIndex((i) => i.id === imageId);
          if (idx <= 0) return state;
          const reordered = [existing[idx], ...existing.slice(0, idx), ...existing.slice(idx + 1)];
          return {
            images: { ...state.images, [key]: reordered },
          };
        }),

      getImages: (key) => get().images[key] ?? [],
    }),
    {
      name: 'ed-colonization-gallery',
      version: 1,
      storage: createJSONStorage(() => galleryStorage),
      // Once this tab has its copy, follow the server's own additions (below).
      onRehydrateStorage: () => () => { watchServerGallery(); },
    }
  )
);

// The server adds to the gallery on its own — F10 adoptions, the co-pilot's reads, BMP→JPEG — and this tab's
// copy must follow (1.62.3). Every edit here is saved as the whole map; the server now merges that, but a copy
// that is current is still the right thing to send. One refetch per burst of server events.
let watchingServer = false;
function watchServerGallery(): void {
  if (watchingServer) return;
  watchingServer = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const refetch = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      timer = null;
      try {
        const res = await fetch(apiUrl('/api/gallery'));
        if (!res.ok) return;
        const data = await res.json();
        if (data && typeof data === 'object') useGalleryStore.setState({ images: data });
      } catch { /* the next event will try again */ }
    }, 1500);
  };
  try {
    sseSubscribe('gallery_updated', refetch);
    sseSubscribe('screenshot_saved', refetch);
  } catch {
    watchingServer = false;
  }
}

/**
 * Resize an image file to a JPEG data URL with max dimension.
 * Keeps aspect ratio, compresses to 95% JPEG quality.
 */
export async function resizeImageToDataUrl(file: File, maxDim: number = 1920): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas not supported')); return; }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.95));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
    img.src = url;
  });
}

/**
 * Migrate gallery images from IndexedDB to server storage (one-time).
 * Called on first load — checks if server gallery is empty and IDB has data.
 */
export async function migrateGalleryToServer(): Promise<void> {
  try {
    // Check if server already has gallery data
    const res = await fetch(apiUrl('/api/gallery'));
    const serverData = await res.json();
    if (serverData && Object.keys(serverData).length > 0) return; // Already migrated

    // Try to read from old IndexedDB
    const idbData = await readOldGalleryFromIDB();
    if (!idbData) return;

    const parsed = JSON.parse(idbData);
    const state = parsed.state || parsed;
    const oldImages: Record<string, Array<{ id: string; dataUrl: string; caption: string; addedAt: string }>> = state.images || {};

    if (Object.keys(oldImages).length === 0) return;

    console.log('[Gallery] Migrating images from IndexedDB to server...');
    const newImages: Record<string, GalleryImage[]> = {};
    let count = 0;

    for (const [key, imgs] of Object.entries(oldImages)) {
      newImages[key] = [];
      for (const img of imgs) {
        if (!img.dataUrl) continue;
        try {
          const { id, url } = await uploadImage(img.dataUrl);
          newImages[key].push({ id, url, caption: img.caption || '', addedAt: img.addedAt || new Date().toISOString() });
          count++;
        } catch (e) {
          console.error(`[Gallery] Failed to upload image ${img.id}:`, e);
        }
      }
    }

    // Save metadata to server
    await fetch(apiUrl('/api/gallery'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newImages),
    });

    // Update Zustand store in memory
    useGalleryStore.setState({ images: newImages });

    // Clear old IndexedDB data
    try {
      const db = await openOldDB();
      const tx = db.transaction('gallery', 'readwrite');
      tx.objectStore('gallery').clear();
      console.log(`[Gallery] Migrated ${count} images to server, cleared IndexedDB`);
    } catch { /* ignore cleanup errors */ }
  } catch (e) {
    console.error('[Gallery] Migration failed:', e);
  }
}

// --- Old IndexedDB helpers for migration ---
function openOldDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('ed-colony-gallery', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('gallery')) db.createObjectStore('gallery');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function readOldGalleryFromIDB(): Promise<string | null> {
  return openOldDB().then(
    (db) =>
      new Promise<string | null>((resolve, reject) => {
        const tx = db.transaction('gallery', 'readonly');
        const store = tx.objectStore('gallery');
        const req = store.get('ed-colonization-gallery');
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
      })
  ).catch(() => null);
}
