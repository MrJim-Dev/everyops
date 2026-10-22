/**
 * Reads barcodes and QR codes from the camera or a photo, on the device: the browser's own BarcodeDetector where it
 * has one (Chrome on Android and macOS), otherwise ZXing compiled to WebAssembly (Safari, Firefox, iPhones),
 * loaded only when a scan starts and served from /vendor so no code leaves the device.
 */
export type Detector = { detect(source: ImageBitmapSource): Promise<{ rawValue: string; format: string }[]> };

let ready: Promise<Detector> | null = null;

export function barcodeDetector(): Promise<Detector> {
  ready ??= (async () => {
    const native = (
      globalThis as { BarcodeDetector?: { new (): Detector; getSupportedFormats(): Promise<string[]> } }
    ).BarcodeDetector;
    if (native) {
      try {
        if ((await native.getSupportedFormats()).length) return new native();
      } catch {
        // Some browsers have the API without any formats; use ZXing then.
      }
    }
    const { BarcodeDetector, prepareZXingModule, ZXING_WASM_VERSION } = await import(
      "barcode-detector/ponyfill"
    );
    prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) =>
          path.endsWith(".wasm") ? `/vendor/zxing_reader-${ZXING_WASM_VERSION}.wasm` : prefix + path,
      },
    });
    return new BarcodeDetector() as unknown as Detector;
  })();
  ready.catch(() => {
    ready = null;
  });
  return ready;
}
