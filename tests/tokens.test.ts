import { describe, expect, it } from "vitest";
import { NemiNetworkError, NemiOAuthError } from "../src/core";
import { MemoryTokenStore } from "../src/storage";
import { CLIENT_ID, createServer, json, makeAuth } from "./helpers";

type GalleryClient = { gallery: { photos: { list(): Promise<{ photos: { id: string; thumbnailUrl: string }[] }> } } };

describe("token persistence and refresh", () => {
  it("restores the session from the token store in a new instance", async () => {
    const server = createServer();
    const store = new MemoryTokenStore();
    await makeAuth({ server, tokenStore: store }).signIn();

    const restored = makeAuth({ server, tokenStore: store });
    expect(restored.getState().status).toBe("loading");
    await restored.initialize();
    expect(restored.isSignedIn).toBe(true);
    expect(restored.user?.name).toBe("Ada Lovelace");
    expect(await restored.getAccessToken()).toBe("nemi_oat_1");
    expect(server.tokenRequests).toHaveLength(1);
  });

  it("refreshes an expiring access token and persists the rotated refresh token", async () => {
    const server = createServer();
    const store = new MemoryTokenStore();
    let now = 1_000_000;
    const auth = makeAuth({ server, tokenStore: store, now: () => now });
    await auth.signIn();

    now += 3600 * 1000 - 30 * 1000; // inside the 60 second leeway
    expect(await auth.getAccessToken()).toBe("nemi_oat_2");

    const form = server.tokenRequests[1]!;
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("nemi_ort_1");
    expect(form.get("client_id")).toBe(CLIENT_ID);
    expect(form.has("client_secret")).toBe(false);

    const stored = JSON.parse((await store.getItem(`nemi.${CLIENT_ID}.tokens`))!);
    expect(stored.refreshToken).toBe("nemi_ort_2");
  });

  it("sends one refresh for concurrent 401s and retries with the new token", async () => {
    const server = createServer();
    const auth = makeAuth({ server });
    await auth.signIn();
    server.onApi = (header) =>
      header === "Bearer nemi_oat_1" ? json({ error: { code: "invalid_token" } }, 401) : json({ photos: [] });

    const client = auth.client as unknown as GalleryClient;
    const results = await Promise.all([client.gallery.photos.list(), client.gallery.photos.list(), client.gallery.photos.list()]);

    expect(results.map((r) => r.photos)).toEqual([[], [], []]);
    const refreshes = server.tokenRequests.filter((f) => f.get("grant_type") === "refresh_token");
    expect(refreshes).toHaveLength(1);
    expect(server.apiAuthHeaders.filter((h) => h === "Bearer nemi_oat_2")).toHaveLength(3);
  });

  it("signs out locally when the refresh token is refused", async () => {
    const server = createServer();
    const store = new MemoryTokenStore();
    let now = 0;
    const auth = makeAuth({ server, tokenStore: store, now: () => now });
    await auth.signIn();
    server.onToken = () => json({ error: "invalid_grant", error_description: "Revoked." }, 400);
    now += 2 * 3600 * 1000;

    await expect(auth.getAccessToken()).rejects.toBeInstanceOf(NemiOAuthError);
    expect(auth.isSignedIn).toBe(false);
    expect(await store.getItem(`nemi.${CLIENT_ID}.tokens`)).toBeNull();
  });

  it("keeps the session when a refresh fails on the network", async () => {
    const server = createServer();
    let now = 0;
    const auth = makeAuth({ server, now: () => now });
    await auth.signIn();
    server.onToken = () => {
      throw new TypeError("Network request failed");
    };
    now += 2 * 3600 * 1000;
    await expect(auth.getAccessToken()).rejects.toBeInstanceOf(NemiNetworkError);
    expect(auth.isSignedIn).toBe(true);
  });
});

describe("REST client", () => {
  it("lists gallery photos through the core client with the session token", async () => {
    const server = createServer();
    const auth = makeAuth({ server });
    await auth.signIn();
    const page = await (auth.client as unknown as GalleryClient).gallery.photos.list();
    expect(page.photos[0]).toMatchObject({ id: "p1", thumbnailUrl: "https://cdn/p1.jpg" });
    expect(server.apiAuthHeaders).toEqual(["Bearer nemi_oat_1"]);
  });

  it("only sends the token to the API: other URLs pass through untouched", async () => {
    const server = createServer();
    const auth = makeAuth({ server });
    await auth.signIn();
    const original = server.fetch.getMockImplementation() as (i: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    const seen: { url: string; auth: string | null }[] = [];
    server.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://uploads.example")) {
        seen.push({ url, auth: new Headers(init?.headers).get("Authorization") });
        return new Response(null, { status: 401 });
      }
      return original(input, init);
    });

    const res = await auth.fetch("https://uploads.example/bucket/key?sig=1", { method: "PUT", body: "x" });
    expect(res.status).toBe(401);
    expect(seen).toEqual([{ url: "https://uploads.example/bucket/key?sig=1", auth: null }]);
    // A 401 from a foreign host must not burn a refresh token.
    expect(server.tokenRequests.filter((f) => f.get("grant_type") === "refresh_token")).toHaveLength(0);
    // Look-alike hosts do not get the token either.
    await auth.fetch("https://nemilab.com/api/v1.evil.example/x").catch(() => undefined);
    expect(server.apiAuthHeaders).toEqual([]);
  });

  it("refuses API calls when nobody is signed in", async () => {
    const auth = makeAuth({ server: createServer() });
    await expect((auth.client as unknown as GalleryClient).gallery.photos.list()).rejects.toThrow(/Nobody is signed in/);
  });
});

describe("sign out", () => {
  it("revokes the refresh token and clears the store", async () => {
    const server = createServer();
    const store = new MemoryTokenStore();
    const auth = makeAuth({ server, tokenStore: store });
    await auth.signIn();

    await auth.signOut();

    expect(server.revokeRequests).toHaveLength(1);
    const form = server.revokeRequests[0]!;
    expect(form.get("token")).toBe("nemi_ort_1");
    expect(form.get("token_type_hint")).toBe("refresh_token");
    expect(form.get("client_id")).toBe(CLIENT_ID);
    expect(form.has("client_secret")).toBe(false);
    expect(auth.getState()).toEqual({ status: "signedOut", user: null, error: null });
    expect(await store.getItem(`nemi.${CLIENT_ID}.tokens`)).toBeNull();
    expect(await store.getItem(`nemi.${CLIENT_ID}.user`)).toBeNull();
    expect(await auth.getAccessToken()).toBeNull();
  });

  it("clears the store even when revoke fails", async () => {
    const server = createServer();
    const store = new MemoryTokenStore();
    const auth = makeAuth({ server, tokenStore: store });
    await auth.signIn();
    const original = server.fetch.getMockImplementation() as (i: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    server.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/revoke")) throw new TypeError("Network request failed");
      return original(input, init);
    });

    await auth.signOut();
    expect(auth.isSignedIn).toBe(false);
    expect(await store.getItem(`nemi.${CLIENT_ID}.tokens`)).toBeNull();
  });
});
