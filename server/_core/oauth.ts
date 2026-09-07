import { COOKIE_NAME, ONE_YEAR_MS, OAUTH_STATE_COOKIE, decodeOAuthState } from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";
import { sdk } from "./sdk";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

export function registerOAuthRoutes(app: Express) {
  for (const provider of ["google", "github"] as const) {
    app.get(`/api/auth/${provider}`, (req: Request, res: Response) => {
      const configured = provider === "google"
        ? ENV.googleClientId && ENV.googleClientSecret
        : ENV.githubClientId && ENV.githubClientSecret;
      if (!configured) {
        res.status(503).json({
          error: `${provider[0].toUpperCase()}${provider.slice(1)} login is not configured`,
          required: provider === "google"
            ? ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]
            : ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"],
        });
        return;
      }

      const redirectUri = `${req.protocol}://${req.get("host")}/api/auth/${provider}/callback`;
      const params = new URLSearchParams({
        client_id: provider === "google" ? ENV.googleClientId : ENV.githubClientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: provider === "google" ? "openid email profile" : "read:user user:email",
        state: redirectUri,
      });
      const authorizationUrl = provider === "google"
        ? `https://accounts.google.com/o/oauth2/v2/auth?${params}`
        : `https://github.com/login/oauth/authorize?${params}`;
      res.redirect(302, authorizationUrl);
    });

    app.get(`/api/auth/${provider}/callback`, (_req: Request, res: Response) => {
      res.status(501).json({
        error: `${provider[0].toUpperCase()}${provider.slice(1)} callback exchange is not implemented yet`,
      });
    });
  }

  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    // CSRF guard: the nonce in `state` must match the one-time cookie that
    // startLogin set in the browser that began this login. An attacker can
    // forge `state`, but cannot plant this cookie in the victim's browser.
    const { nonce } = decodeOAuthState(state);
    const expectedNonce = parseCookieHeader(req.headers.cookie ?? "")[OAUTH_STATE_COOKIE];
    if (!nonce || nonce !== expectedNonce) {
      res.status(403).json({ error: "invalid oauth state" });
      return;
    }
    res.clearCookie(OAUTH_STATE_COOKIE, { path: "/", secure: true, sameSite: "none" });

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      await db.upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.redirect(302, "/dashboard");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}
