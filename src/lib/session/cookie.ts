import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

/** Development name. In production (Secure cookies) the `__Host-` prefix is used: Secure, Path=/, no Domain. */
export const SESSION_COOKIE = 'instructor_session';
export const sessionCookieName = (secure: boolean) => (secure ? `__Host-${SESSION_COOKIE}` : SESSION_COOKIE);
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
/** Used only outside production, where config allows SESSION_SECRET to be unset. Production refuses to start without a real one. */
const DEV_SECRET = 'instructor-dev-only-session-secret-not-for-production';

const sign = (id: string, secret: string) => createHmac('sha256', secret).update(id).digest('base64url');

export function newSessionId(): string {
  return randomUUID();
}

/** `<id>.<signature>`. */
export function signSessionId(id: string, secret: string): string {
  return `${id}.${sign(id, secret)}`;
}

/** Returns the session id when the value carries a valid signature, otherwise undefined. */
export function verifySessionValue(value: string | undefined | null, secret: string): string | undefined {
  if (!value) return undefined;
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return undefined;
  const id = value.slice(0, dot);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(sign(id, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
  return id;
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function sessionSecret(configured: string | undefined): string {
  return configured ?? DEV_SECRET;
}

/** Set-Cookie value: signed, httpOnly, SameSite=Lax, Secure in production. */
export function sessionSetCookie(id: string, secret: string, secure: boolean): string {
  const attrs = [`${sessionCookieName(secure)}=${encodeURIComponent(signSessionId(id, secret))}`, 'Path=/', `Max-Age=${MAX_AGE_SECONDS}`, 'HttpOnly', 'SameSite=Lax'];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}
