// Loads MediaPipe Pose Landmarker (Apache-2.0) from files bundled with the app: WASM runtime from the npm
// package, model from public/models. Nothing is fetched from third-party servers and no camera frame
// leaves the device.
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import wasmLoaderPath from "@mediapipe/tasks-vision/vision_wasm_internal.js?url";
import wasmBinaryPath from "@mediapipe/tasks-vision/vision_wasm_internal.wasm?url";

const MODEL_URL = `${import.meta.env.BASE_URL}models/pose_landmarker_full.task`;

let pending: Promise<PoseLandmarker> | null = null;

export function loadPoseLandmarker(): Promise<PoseLandmarker> {
  pending ??= (async () => {
    const { PoseLandmarker } = await import("@mediapipe/tasks-vision");
    const fileset = { wasmLoaderPath, wasmBinaryPath };
    const options = (delegate: "GPU" | "CPU") => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: "VIDEO" as const,
      numPoses: 1,
      outputSegmentationMasks: true,
      // Slightly below the defaults: keeps tracking in dim rooms where confidence drops.
      minPoseDetectionConfidence: 0.45,
      minPosePresenceConfidence: 0.45,
      minTrackingConfidence: 0.45,
    });
    try {
      return await PoseLandmarker.createFromOptions(fileset, options("GPU"));
    } catch {
      // No WebGL2 (old GPU, remote desktop): the CPU path is slower but works everywhere.
      return await PoseLandmarker.createFromOptions(fileset, options("CPU"));
    }
  })().catch((e) => {
    pending = null;
    throw e;
  });
  return pending;
}
