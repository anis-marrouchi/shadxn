import fs from "fs";
import path from "path";
import { execa } from "execa";
import { afterEach, describe, expect, it, vi } from "vitest";

// Import other utilities as needed.

vi.mock("execa");
vi.mock("fs/promises", () => ({
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
}));
vi.mock("ora");
  
  describe("add command", () => {
    it("adds components successfully", async () => {
      // Setup mocks, execute your add command, and assert behaviors
      console.log("add command test");
    });
  
    afterEach(() => {
      vi.resetAllMocks();
    });
  });
  