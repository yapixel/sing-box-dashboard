import { describe, expect, it } from "vitest";

import { isLoopbackHost, isOpaqueNetworkError } from "./connectivity";

describe("isOpaqueNetworkError", () => {
  it("matches the per-engine wordings", () => {
    expect(isOpaqueNetworkError("Failed to fetch")).toBe(true);
    expect(isOpaqueNetworkError("Load failed")).toBe(true);
    expect(isOpaqueNetworkError("NetworkError when attempting to fetch resource.")).toBe(true);
  });

  it("passes daemon errors through", () => {
    expect(isOpaqueNetworkError("bad secret")).toBe(false);
    expect(isOpaqueNetworkError("Stream ended without a status message")).toBe(false);
  });
});

describe("isLoopbackHost", () => {
  it("recognizes loopback hosts", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("foo.localhost")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("127.1.2.3")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isLoopbackHost("192.168.1.2")).toBe(false);
    expect(isLoopbackHost("example.com")).toBe(false);
    expect(isLoopbackHost("127.0.0.1.evil.com")).toBe(false);
  });
});
