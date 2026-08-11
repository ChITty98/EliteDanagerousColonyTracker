/**
 * Upload an image file into a gallery key — the one flow used by the 2nd-screen
 * sighting card and the Sights wall, so both attach photos identically:
 * base64 → POST /api/gallery/upload (writes the file), then PATCH the meta with
 * the new entry appended under the key.
 */

function apiUrl(path: string): string {
  let t: string | null = null;
  try { t = sessionStorage.getItem('colony-token'); } catch { /* no storage */ }
  return t ? `${path}${path.includes('?') ? '&' : '?'}token=${t}` : path;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

export async function uploadToGalleryKey(galleryKey: string, file: File): Promise<void> {
  const dataUrl = await readAsDataUrl(file);
  const up = await fetch(apiUrl('/api/gallery/upload'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl }),
  });
  const img = await up.json();
  if (!up.ok) throw new Error(img.error || 'Upload failed');
  const metaRes = await fetch(apiUrl('/api/gallery'));
  if (!metaRes.ok) throw new Error('Could not load gallery metadata');
  const meta = await metaRes.json();
  const arr = Array.isArray(meta[galleryKey]) ? meta[galleryKey] : [];
  arr.push({ id: img.id, url: img.url, caption: file.name, addedAt: new Date().toISOString() });
  meta[galleryKey] = arr;
  const patch = await fetch(apiUrl('/api/gallery'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(meta),
  });
  if (!patch.ok) throw new Error('Could not save gallery metadata');
}

/** Remove one image: scrub its meta entry from the key, then delete the file. */
export async function deleteFromGalleryKey(galleryKey: string, imageId: string): Promise<void> {
  const metaRes = await fetch(apiUrl('/api/gallery'));
  if (!metaRes.ok) throw new Error('Could not load gallery metadata');
  const meta = await metaRes.json();
  const arr = Array.isArray(meta[galleryKey]) ? meta[galleryKey] : [];
  const entry = arr.find((e: { id: string }) => e && e.id === imageId);
  meta[galleryKey] = arr.filter((e: { id: string }) => e && e.id !== imageId);
  if (meta[galleryKey].length === 0) delete meta[galleryKey];
  const patch = await fetch(apiUrl('/api/gallery'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(meta),
  });
  if (!patch.ok) throw new Error('Could not save gallery metadata');
  // File cleanup is best-effort — the meta entry is what the UI renders.
  if (entry && typeof (entry as { url?: string }).url === 'string') {
    const filename = (entry as { url: string }).url.split('/').pop();
    if (filename) await fetch(apiUrl(`/api/gallery/${encodeURIComponent(filename)}`), { method: 'DELETE' }).catch(() => {});
  }
}

/** Upload several files in sequence; returns the first error message, if any. */
export async function uploadAllToGalleryKey(galleryKey: string, files: FileList | File[]): Promise<string | null> {
  for (const f of Array.from(files)) {
    try {
      await uploadToGalleryKey(galleryKey, f);
    } catch (e) {
      return e instanceof Error ? e.message : 'Upload failed';
    }
  }
  return null;
}
