import assert from "node:assert/strict";
import test from "node:test";
import { validateImageStudioConfig } from "../src/modules/images/image-studio-config.mjs";

test("Image Studio 외부 경로는 절대경로만 허용한다", () => {
  assert.throws(
    () =>
      validateImageStudioConfig({
        dailyImagesRoot: "relative/images",
      }),
    /dailyImagesRoot.*절대경로/,
  );

  assert.throws(
    () =>
      validateImageStudioConfig({
        dailyImagesRoots: ["relative/images"],
      }),
    /dailyImagesRoots\[0\].*절대경로/,
  );

  assert.throws(
    () =>
      validateImageStudioConfig({
        generation: {
          pythonExecutablePath: "python.exe",
        },
      }),
    /pythonExecutablePath.*절대경로/,
  );
});

test("비어 있는 예시 경로와 절대경로 설정을 허용한다", () => {
  assert.doesNotThrow(() =>
    validateImageStudioConfig({
      dailyImagesRoot: "",
      dailyImagesRoots: ["C:\\archive\\daily-v2", "C:\\archive\\daily-images"],
      stateRoot: "C:\\runtime\\image-studio-state",
      generation: {
        pythonExecutablePath: "C:\\Python\\python.exe",
      },
    }),
  );
});
