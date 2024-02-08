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

describe("registry command", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("builds the registry successfully", async () => {
    // Setup your mocks and spies
    const mockMkdir = vi.spyOn(fs.promises, "mkdir").mockResolvedValue(undefined);
    const mockWriteFile = vi.spyOn(fs.promises, "writeFile").mockResolvedValue();
    const mockReaddir = vi.spyOn(fs.promises, "readdir").mockResolvedValue([]);

    // Assume runRegistry is your function to execute the registry command
   // await runRegistry();

    // Add your expectations here
    // Example:
    expect(mockMkdir).toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalled();
    // Further assertions to verify the behavior of your command...

    // Restore mocks
    mockMkdir.mockRestore();
    mockWriteFile.mockRestore();
    mockReaddir.mockRestore();
  });

  // You can add more tests to cover different scenarios, such as error handling, different command options, etc.
});
