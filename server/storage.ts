import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_IMAGE_MIME_PREFIXES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/avif',
];

export function sanitizeFileName(raw: string): string {
  const base = path.basename(raw || 'screenshot.png');
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : 'screenshot.png';
}

export function computeBufferSha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function hasValidImageMagicBytes(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  // GIF: 47 49 46 38
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return true;
  // WEBP: RIFF....WEBP
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return true;
  }
  // BMP: 42 4D
  if (buf[0] === 0x42 && buf[1] === 0x4d) return true;
  // AVIF / ISO BMFF: ....ftyp
  if (
    buf.length >= 12 &&
    buf[4] === 0x66 &&
    buf[5] === 0x74 &&
    buf[6] === 0x79 &&
    buf[7] === 0x70
  ) {
    return true;
  }
  return false;
}

export function validateImageUpload(
  buf: Buffer,
  contentType: string,
  options?: { strictMagicBytes?: boolean }
): { valid: boolean; error?: string; normalizedContentType: string } {
  if (!buf || buf.length === 0) {
    return { valid: false, error: 'Uploaded file is empty.', normalizedContentType: 'image/png' };
  }
  if (buf.length > MAX_ATTACHMENT_BYTES) {
    return {
      valid: false,
      error: `Attachment exceeds maximum allowed size (${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB).`,
      normalizedContentType: 'image/png',
    };
  }
  const normalized = (contentType || 'image/png').split(';')[0].trim().toLowerCase();
  const isAllowedMime =
    ALLOWED_IMAGE_MIME_PREFIXES.includes(normalized) ||
    (normalized.startsWith('image/') && !normalized.includes('svg'));
  if (!isAllowedMime) {
    return {
      valid: false,
      error: `Unsupported attachment MIME type "${normalized}". Only standard raster images (PNG, JPEG, WebP, GIF, BMP, AVIF) are allowed.`,
      normalizedContentType: normalized,
    };
  }
  if (options?.strictMagicBytes !== false && !hasValidImageMagicBytes(buf)) {
    return {
      valid: false,
      error: 'Uploaded file signature does not match a valid image format.',
      normalizedContentType: normalized,
    };
  }
  return { valid: true, normalizedContentType: normalized };
}

/**
 * Resolves a logical storagePath (e.g. `users/<uid>/attachments/<attId>/<fileName>`)
 * safely inside `uploadsDir`, preventing any path traversal outside the uploads root.
 */
export function resolveSafeUploadPath(uploadsDir: string, storagePath: string): string {
  const root = path.resolve(uploadsDir);
  const normalizedRel = storagePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalizedRel || normalizedRel.includes('..') || normalizedRel.includes('\0')) {
    throw new Error('Invalid attachment storage path.');
  }
  const full = path.resolve(root, normalizedRel);
  if (full !== root && !full.startsWith(`${root}${path.sep}`)) {
    throw new Error('Attachment path escapes configured uploads directory.');
  }
  return full;
}

export function writeAttachmentFile(
  uploadsDir: string,
  storagePath: string,
  buffer: Buffer
): string {
  const fullPath = resolveSafeUploadPath(uploadsDir, storagePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, buffer);
  return fullPath;
}

export function readAttachmentFile(uploadsDir: string, storagePath: string): Buffer | null {
  try {
    const fullPath = resolveSafeUploadPath(uploadsDir, storagePath);
    if (!fs.existsSync(fullPath)) return null;
    return fs.readFileSync(fullPath);
  } catch {
    return null;
  }
}

export function deleteAttachmentFile(uploadsDir: string, storagePath: string): void {
  try {
    const fullPath = resolveSafeUploadPath(uploadsDir, storagePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      const parentDir = path.dirname(fullPath);
      const entries = fs.readdirSync(parentDir);
      if (entries.length === 0 && parentDir !== path.resolve(uploadsDir)) {
        fs.rmdirSync(parentDir);
      }
    }
  } catch {
    // Best-effort local disk cleanup
  }
}
