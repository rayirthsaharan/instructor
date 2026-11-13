/** Upload and processing limits (PRD F1). One place so routes, pipeline and tests agree. */
export const MAX_TOTAL_BYTES = 40 * 1024 * 1024;
export const MAX_PAGES = 60;
/** Long edge of stored page images, in pixels. */
export const PAGE_IMAGE_MAX_DIM = 1600;
/** sharp refuses to decode inputs with more pixels than this (decompression-bomb guard). */
export const MAX_INPUT_PIXELS = 60_000_000;
/** Bump when stage logic changes in a way that invalidates stored analyses. Part of the analysis key. */
export const PIPELINE_VERSION = 'p2';

export const UPLOAD_LIMIT_PER_SESSION = { limit: 10, windowMs: 60 * 60 * 1000 };
export const UPLOAD_LIMIT_PER_IP = { limit: 30, windowMs: 60 * 60 * 1000 };
/** Ceiling across all clients, for when no trustworthy client IP exists. Generous: it only stops runaway abuse. */
export const UPLOAD_LIMIT_GLOBAL = { limit: 600, windowMs: 60 * 60 * 1000 };
/** Uploads being read and probed at once in one web process. */
export const MAX_CONCURRENT_UPLOADS = 2;
export const QUOTA_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
