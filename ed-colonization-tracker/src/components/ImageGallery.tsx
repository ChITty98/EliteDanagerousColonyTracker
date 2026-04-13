import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { useGalleryStore, resizeImageToDataUrl, type GalleryImage } from '@/store/galleryStore';

interface ImageGalleryProps {
  galleryKey: string;
  title?: string;
  compact?: boolean; // Inline mode: show thumbnails in a row, no big title
}

export function ImageGallery({ galleryKey, title, compact }: ImageGalleryProps) {
  const rawImages = useGalleryStore((s) => s.images[galleryKey]);
  const images = useMemo(() => rawImages ?? [], [rawImages]);
  const addImage = useGalleryStore((s) => s.addImage);
  const removeImage = useGalleryStore((s) => s.removeImage);
  const updateCaption = useGalleryStore((s) => s.updateCaption);

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const [rawSlide, setRawSlide] = useState(0);
  const currentSlide = images.length === 0 ? 0 : Math.min(rawSlide, images.length - 1);
  const setCurrentSlide = setRawSlide;
  const [editingCaption, setEditingCaption] = useState<string | null>(null);
  const [captionValue, setCaptionValue] = useState('');

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const dataUrl = await resizeImageToDataUrl(file);
        await addImage(galleryKey, dataUrl, file.name.replace(/\.\w+$/, ''));
      }
    } catch (err) {
      console.error('Failed to add image:', err);
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleStartEditCaption = (img: GalleryImage) => {
    setEditingCaption(img.id);
    setCaptionValue(img.caption);
  };

  const handleSaveCaption = (imgId: string) => {
    updateCaption(galleryKey, imgId, captionValue);
    setEditingCaption(null);
  };

  const handleDelete = (img: GalleryImage) => {
    if (!confirm('Delete this image?')) return;
    removeImage(galleryKey, img.id);
    if (viewIndex !== null) {
      if (images.length <= 1) {
        setViewIndex(null);
      } else if (viewIndex >= images.length - 1) {
        setViewIndex(images.length - 2);
      }
    }
  };

  const goNext = useCallback(() => {
    if (viewIndex !== null && viewIndex < images.length - 1) setViewIndex(viewIndex + 1);
  }, [viewIndex, images.length]);

  const goPrev = useCallback(() => {
    if (viewIndex !== null && viewIndex > 0) setViewIndex(viewIndex - 1);
  }, [viewIndex]);

  const viewImage = viewIndex !== null ? images[viewIndex] ?? null : null;

  if (compact) {
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        {images.map((img, idx) => (
          <button
            key={img.id}
            onClick={() => setViewIndex(idx)}
            className="w-16 h-11 rounded overflow-hidden border border-border hover:border-primary transition-colors shrink-0"
          >
            <img src={img.url} alt={img.caption} className="w-full h-full object-cover" />
          </button>
        ))}
        <label className="w-16 h-11 rounded border border-dashed border-border/60 hover:border-primary/60 flex items-center justify-center cursor-pointer transition-colors shrink-0">
          <span className="text-sm text-muted-foreground">{uploading ? '\u23F3' : '+'}</span>
          <input type="file" accept="image/*" multiple onChange={handleFileChange} ref={fileRef} className="hidden" />
        </label>

        {viewImage && (
          <Lightbox
            image={viewImage}
            imageIndex={viewIndex!}
            totalImages={images.length}
            onClose={() => setViewIndex(null)}
            onDelete={() => handleDelete(viewImage)}
            onNext={goNext}
            onPrev={goPrev}
            editingCaption={editingCaption}
            captionValue={captionValue}
            onStartEditCaption={handleStartEditCaption}
            onSaveCaption={handleSaveCaption}
            setCaptionValue={setCaptionValue}
            setEditingCaption={setEditingCaption}
          />
        )}
      </div>
    );
  }

  // --- Non-compact: inline carousel with arrows ---
  const currentImage = images[currentSlide] ?? null;
  const hasPrevSlide = currentSlide > 0;
  const hasNextSlide = currentSlide < images.length - 1;

  return (
    <div>
      {title && <h4 className="text-sm font-semibold text-muted-foreground mb-2">{title}</h4>}

      {images.length === 0 && !uploading ? (
        <label className="flex items-center justify-center gap-2 py-6 px-6 border border-dashed border-border/60 rounded-lg cursor-pointer hover:border-primary/60 transition-colors">
          <span className="text-muted-foreground text-sm">{'\u{1F4F7}'} Add screenshot</span>
          <input type="file" accept="image/*" multiple onChange={handleFileChange} ref={fileRef} className="hidden" />
        </label>
      ) : (
        <div>
          {/* Main image with inline arrows */}
          {currentImage && (
            <div className="relative group">
              <button
                onClick={() => setViewIndex(currentSlide)}
                className="w-full rounded-lg overflow-hidden border border-border hover:border-primary transition-colors"
              >
                <img src={currentImage.url} alt={currentImage.caption} className="w-full aspect-video object-cover" />
              </button>

              {/* Prev arrow */}
              {hasPrevSlide && (
                <button
                  onClick={(e) => { e.stopPropagation(); setCurrentSlide(currentSlide - 1); }}
                  className="absolute left-1 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white/80 hover:text-white rounded-full w-7 h-7 flex items-center justify-center text-lg transition-all opacity-0 group-hover:opacity-100"
                >
                  {'\u2039'}
                </button>
              )}

              {/* Next arrow */}
              {hasNextSlide && (
                <button
                  onClick={(e) => { e.stopPropagation(); setCurrentSlide(currentSlide + 1); }}
                  className="absolute right-1 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white/80 hover:text-white rounded-full w-7 h-7 flex items-center justify-center text-lg transition-all opacity-0 group-hover:opacity-100"
                >
                  {'\u203A'}
                </button>
              )}

              {/* Counter badge */}
              {images.length > 1 && (
                <div className="absolute bottom-1.5 right-1.5 text-[10px] text-white/70 bg-black/50 px-1.5 py-0.5 rounded">
                  {currentSlide + 1}/{images.length}
                </div>
              )}
            </div>
          )}

          {/* Thumbnail strip + add button */}
          <div className="flex items-center gap-1 mt-1.5">
            {images.length > 1 && images.map((img, idx) => (
              <button
                key={img.id}
                onClick={() => setCurrentSlide(idx)}
                className={`w-10 h-7 rounded overflow-hidden border transition-colors shrink-0 ${idx === currentSlide ? 'border-primary' : 'border-border/50 hover:border-border opacity-60'}`}
              >
                <img src={img.url} alt={img.caption} className="w-full h-full object-cover" />
              </button>
            ))}
            <label className="w-10 h-7 rounded border border-dashed border-border/60 hover:border-primary/60 flex items-center justify-center cursor-pointer transition-colors shrink-0">
              <span className="text-xs text-muted-foreground">{uploading ? '\u23F3' : '+'}</span>
              <input type="file" accept="image/*" multiple onChange={handleFileChange} ref={fileRef} className="hidden" />
            </label>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {viewImage && (
        <Lightbox
          image={viewImage}
          imageIndex={viewIndex!}
          totalImages={images.length}
          onClose={() => setViewIndex(null)}
          onDelete={() => handleDelete(viewImage)}
          onNext={goNext}
          onPrev={goPrev}
          editingCaption={editingCaption}
          captionValue={captionValue}
          onStartEditCaption={handleStartEditCaption}
          onSaveCaption={handleSaveCaption}
          setCaptionValue={setCaptionValue}
          setEditingCaption={setEditingCaption}
        />
      )}
    </div>
  );
}

// --- Lightbox modal with prev/next navigation ---
function Lightbox({
  image, imageIndex, totalImages, onClose, onDelete, onNext, onPrev,
  editingCaption, captionValue, onStartEditCaption, onSaveCaption, setCaptionValue, setEditingCaption,
}: {
  image: GalleryImage;
  imageIndex: number;
  totalImages: number;
  onClose: () => void;
  onDelete: () => void;
  onNext: () => void;
  onPrev: () => void;
  editingCaption: string | null;
  captionValue: string;
  onStartEditCaption: (img: GalleryImage) => void;
  onSaveCaption: (id: string) => void;
  setCaptionValue: (v: string) => void;
  setEditingCaption: (v: string | null) => void;
}) {
  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); onNext(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); onPrev(); }
      else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onNext, onPrev, onClose]);

  const hasPrev = imageIndex > 0;
  const hasNext = imageIndex < totalImages - 1;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="max-w-4xl max-h-[90vh] flex flex-col relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Image counter */}
        {totalImages > 1 && (
          <div className="absolute top-2 right-2 text-xs text-white/60 bg-black/40 px-2 py-0.5 rounded z-10">
            {imageIndex + 1} / {totalImages}
          </div>
        )}

        {/* Prev arrow */}
        {hasPrev && (
          <button
            onClick={onPrev}
            className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-12 text-white/70 hover:text-white text-4xl transition-colors z-10 px-2 py-4"
            title="Previous (\u2190)"
          >
            {'\u2039'}
          </button>
        )}

        {/* Next arrow */}
        {hasNext && (
          <button
            onClick={onNext}
            className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-12 text-white/70 hover:text-white text-4xl transition-colors z-10 px-2 py-4"
            title="Next (\u2192)"
          >
            {'\u203A'}
          </button>
        )}

        <img
          src={image.url}
          alt={image.caption}
          className="max-h-[80vh] w-auto object-contain rounded-lg"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          {editingCaption === image.id ? (
            <form className="flex-1 flex gap-2" onSubmit={(e) => { e.preventDefault(); onSaveCaption(image.id); }}>
              <input
                type="text"
                value={captionValue}
                onChange={(e) => setCaptionValue(e.target.value)}
                className="flex-1 bg-muted border border-border rounded px-2 py-1 text-sm text-foreground"
                autoFocus
                onBlur={() => setEditingCaption(null)}
              />
              <button
                type="submit"
                className="text-xs text-progress-complete hover:underline"
                onMouseDown={(e) => e.preventDefault()}
              >
                {'\u2713'}
              </button>
            </form>
          ) : (
            <button
              onClick={() => onStartEditCaption(image)}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {image.caption || 'Add caption...'}
            </button>
          )}
          <div className="flex gap-2">
            <button
              onClick={onDelete}
              className="text-xs text-destructive/60 hover:text-destructive transition-colors px-2 py-1"
            >
              {'\u{1F5D1}'} Delete
            </button>
            <button
              onClick={onClose}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
