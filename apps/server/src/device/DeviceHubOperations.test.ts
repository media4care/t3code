import { describe, expect, it } from "vite-plus/test";

import { avdVersions } from "./DeviceHubOperations.ts";

describe("avdVersions", () => {
  it("names each AVD's Android version from its system image's API level", () => {
    expect(
      avdVersions(
        "Pixel_Tablet\tandroid-35\nMedium_Phone_API_36.1\tandroid-36.1\nOld\tandroid-32\nPreview\tandroid-Baklava\nBroken\t\n",
      ),
    ).toEqual(
      new Map([
        ["Pixel_Tablet", "Android 15"],
        ["Medium_Phone_API_36.1", "Android 16"],
        ["Old", "Android 12"],
      ]),
    );
  });
});
