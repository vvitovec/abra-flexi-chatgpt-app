import type { Request, Response } from "express";
import type { AppConfig } from "./config.js";
import type { AppDatabase } from "./db.js";
import type { AppSession, AppUser } from "./types.js";

export interface SessionState {
  session: AppSession | null;
  user: AppUser | null;
}

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) {
    return null;
  }
  for (const entry of header.split(";")) {
    const [rawKey, ...rest] = entry.trim().split("=");
    if (rawKey === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

export function loadSessionState(req: Request, db: AppDatabase, config: AppConfig): SessionState {
  const sessionId = parseCookie(req.headers.cookie, config.appCookieName);
  if (!sessionId) {
    return { session: null, user: null };
  }
  const session = db.getSession(sessionId);
  if (!session) {
    return { session: null, user: null };
  }
  const user = db.getUserById(session.user_id);
  if (!user) {
    return { session: null, user: null };
  }
  return { session, user };
}

export function setSessionCookie(res: Response, config: AppConfig, sessionId: string): void {
  const parts = [
    `${config.appCookieName}=${encodeURIComponent(sessionId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${config.appCookieTtlSeconds}`
  ];
  if (config.appCookieSecure) {
    parts.push("Secure");
  }
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function clearSessionCookie(res: Response, config: AppConfig): void {
  const parts = [
    `${config.appCookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0"
  ];
  if (config.appCookieSecure) {
    parts.push("Secure");
  }
  res.setHeader("Set-Cookie", parts.join("; "));
}
