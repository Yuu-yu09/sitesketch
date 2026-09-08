import { COOKIE_NAME, ONE_YEAR_MS, OAUTH_STATE_COOKIE, decodeOAuthState } from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";
import { sdk } from "./sdk";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

function getRedirectUri(req: Request, provider: "google" | "github"): string {
  const baseUrl = ENV.appUrl || `${req.protocol}://${req.get("host")}`;
  return `${baseUrl.replace(/\/+$/, "")}/api/auth/${provider}/callback`;
}

type ProviderProfile = {
  id: string;
  name: string | null;
  email: string | null;
};

function getProviderClient(provider: "google" | "github") {
  return provider === "google"
    ? { clientId: ENV.googleClientId, clientSecret: ENV.googleClientSecret }
    : { clientId: ENV.githubClientId, clientSecret: ENV.githubClientSecret };
}

async function exchangeProviderCode(
  provider: "google" | "github",
  code: string,
  redirectUri: string
): Promise<ProviderProfile> {
  const { clientId, clientSecret } = getProviderClient(provider);
  const tokenUrl = provider === "google"
    ? "https://oauth2.googleapis.com/token"
    : "https://github.com/login/oauth/access_token";
  const tokenBody = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });
  const tokenResponse = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: tokenBody,
  });
  const token = await tokenResponse.json() as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!tokenResponse.ok) {
    throw new Error(`${provider} token exchange failed: ${token.error_description ?? token.error ?? "provider rejected the code"}`);
  }
  if (!token.access_token) throw new Error(token.error ?? `${provider} did not return an access token`);

  if (provider === "google") {
    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!profileResponse.ok) throw new Error("Google profile request failed");
    const profile = await profileResponse.json() as { sub?: string; name?: string; email?: string; email_verified?: boolean };
    if (!profile.sub || !profile.email || profile.email_verified === false) {
      throw new Error("Google did not return a verified email address");
    }
    return { id: profile.sub, name: profile.name ?? null, email: profile.email.toLowerCase() };
  }

  const profileResponse = await fetch("https://api.github.com/user", {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token.access_token}` },
  });
  if (!profileResponse.ok) throw new Error("GitHub profile request failed");
  const profile = await profileResponse.json() as { id?: number; name?: string; login?: string; email?: string | null };
  if (!profile.id) throw new Error("GitHub did not return a user id");

  let email = profile.email;
  if (!email) {
    const emailsResponse = await fetch("https://api.github.com/user/emails", {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token.access_token}` },
    });
    if (!emailsResponse.ok) throw new Error("GitHub email request failed");
    const emails = await emailsResponse.json() as Array<{ email?: string; primary?: boolean; verified?: boolean }>;
    email = emails.find(item => item.primary && item.verified)?.email ?? emails.find(item => item.verified)?.email;
  }
  return { id: String(profile.id), name: profile.name ?? profile.login ?? null, email: email?.toLowerCase() ?? null };
}

export function registerOAuthRoutes(app: Express) {
  for (const provider of ["google", "github"] as const) {
    app.get(`/api/auth/${provider}`, (req: Request, res: Response) => {
      const configured = provider === "google"
        ? ENV.googleClientId && ENV.googleClientSecret
        : ENV.githubClientId && ENV.githubClientSecret;
      if (!configured) {
        const providerName = `${provider[0].toUpperCase()}${provider.slice(1)}`;
        console.error(`[OAuth] ${providerName} login is not configured`);
        res.redirect(`/` + `?oauth_error=${provider}_not_configured`);
        return;
      }

      const redirectUri = getRedirectUri(req, provider);
      const nonce = randomBytes(32).toString("base64url");
      res.cookie(OAUTH_STATE_COOKIE, nonce, {
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        secure: req.protocol === "https",
        maxAge: 10 * 60 * 1000,
      });
      const params = new URLSearchParams({
        client_id: provider === "google" ? ENV.googleClientId : ENV.githubClientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: provider === "google" ? "openid email profile" : "read:user user:email",
        state: Buffer.from(JSON.stringify({ redirectUri, nonce })).toString("base64"),
      });
      if (provider === "google") params.set("prompt", "select_account");
      const authorizationUrl = provider === "google"
        ? `https://accounts.google.com/o/oauth2/v2/auth?${params}`
        : `https://github.com/login/oauth/authorize?${params}`;
      res.redirect(302, authorizationUrl);
    });

    app.get(`/api/auth/${provider}/callback`, async (req: Request, res: Response) => {
      const code = getQueryParam(req, "code");
      const state = getQueryParam(req, "state");
      if (!code || !state) {
        res.status(400).json({ error: "code and state are required" });
        return;
      }

      const decoded = decodeOAuthState(state);
      const expectedNonce = parseCookieHeader(req.headers.cookie ?? "")[OAUTH_STATE_COOKIE];
      const validNonce = Boolean(decoded.nonce && expectedNonce && decoded.nonce.length === expectedNonce.length);
      if (!validNonce || !timingSafeEqual(Buffer.from(decoded.nonce ?? ""), Buffer.from(expectedNonce ?? ""))) {
        res.status(403).json({ error: "invalid oauth state" });
        return;
      }
      const redirectUri = getRedirectUri(req, provider);
      if (decoded.redirectUri !== redirectUri) {
        res.status(403).json({ error: "invalid oauth redirect" });
        return;
      }
      res.clearCookie(OAUTH_STATE_COOKIE, { path: "/", secure: req.protocol === "https", sameSite: "lax" });

      try {
        const profile = await exchangeProviderCode(provider, code, redirectUri);
        const existingUser = profile.email ? await db.getUserByEmail(profile.email) : undefined;
        const openId = existingUser?.openId ?? `${provider}:${profile.id}`;
        await db.upsertUser({
          openId,
          name: profile.name,
          email: profile.email,
          loginMethod: provider,
          lastSignedIn: new Date(),
        });
        const user = await db.getUserByOpenId(openId);
        if (!user) throw new Error("Provider account could not be saved");
        const sessionToken = await sdk.createLocalSession(user);
        res.cookie(COOKIE_NAME, sessionToken, { ...getSessionCookieOptions(req), maxAge: ONE_YEAR_MS });
        res.redirect(302, "/dashboard");
      } catch (error) {
        console.error(`[OAuth] ${provider} callback failed`, error);
        res.status(502).json({ error: `${provider[0].toUpperCase()}${provider.slice(1)} login failed` });
      }
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
