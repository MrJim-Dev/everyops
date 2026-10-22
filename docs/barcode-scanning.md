# Barcode and QR scanning

Shops, canteens, stockrooms and asset lists can scan instead of typing: find a product by its barcode, fill a
Barcode field from the camera, and add items to a sale at the register.

## Which fields scan

A text field whose name is a code people scan (src/lib/blueprint/scannable.ts): Barcode, SKU, UPC/EAN, QR code,
Serial number, Asset tag, ISBN, Item/Product/Part/Stock code or number, Tracking number. It's read from the name,
so existing workspaces get scanning without setup. The AI's prompts name these fields that way for things people
scan.

## Where it shows

- **Tables** of a record type with a code field get a **Scan** button. A scan opens the matching record (trimmed,
  any letter case). An unknown code offers **Add <record>** with the code filled in.
- **Forms**: a code field has a scan button inside it that fills the field.
- **Register (checkout)**: a **Scan** button, and the search box takes a handheld scanner: the scanner types the
  code and presses Enter, and the product goes into the sale ("Added Iced tea"; sold-out items are refused).
  Search also matches codes.

## The Scan dialog

src/components/scan/scan-dialog.tsx:

- **Camera**: the back camera on phones, read about four times a second.
- **Handheld scanner or typing**: the code box (focused on desktop, so a USB or Bluetooth scanner works at once).
- **Photo**: "Scan a photo instead" takes or picks a picture. Useful when the camera isn't allowed.

## Reading codes

src/lib/scan/detector.ts uses the browser's own BarcodeDetector where it has one (Chrome on Android and macOS).
Elsewhere (Safari, Firefox, iPhones) it uses ZXing compiled to WebAssembly, through the `barcode-detector` package.
That's loaded only when a scan starts, and its `.wasm` is served by the app (`public/vendor/zxing_reader-3.1.6.wasm`,
about 0.9 MB), so codes never leave the device and no CDN is needed. When upgrading `barcode-detector` / `zxing-wasm`,
copy the new `zxing_reader.wasm` there under its version (`ZXING_WASM_VERSION`).

## QA

`tsx --conditions=react-server --env-file=.env.local scripts/qa-barcode.mts` (local databases only) seeds the canteen
POS with barcodes. Chrome can play a barcode video as a fake camera:
`--use-fake-device-for-media-stream --use-file-for-fake-video-capture=ean.y4m`.

