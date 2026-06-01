const { PDFDocument } = require('pdf-lib');
const fs = require('fs').promises;

/**
 * Embeds a raster image (JPEG/PNG) into a single-page PDF.
 * True "editable text" from a photo needs OCR (e.g. Tesseract) — this produces a standard PDF with the image.
 */
async function imageBufferToPdf(imageBuffer, mimeType) {
  const pdf = await PDFDocument.create();
  let image;
  if (mimeType === 'image/png') {
    image = await pdf.embedPng(imageBuffer);
  } else {
    image = await pdf.embedJpg(imageBuffer);
  }
  const page = pdf.addPage([image.width, image.height]);
  page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  return pdf.save();
}

async function writePdfFromImageFile(inputPath, outputPath, mimeType) {
  const buf = await fs.readFile(inputPath);
  const lower = inputPath.toLowerCase();
  let mt = mimeType;
  if (!mt) {
    if (lower.endsWith('.png')) mt = 'image/png';
    else mt = 'image/jpeg';
  }
  const pdfBytes = await imageBufferToPdf(buf, mt);
  await fs.writeFile(outputPath, pdfBytes);
}

module.exports = { imageBufferToPdf, writePdfFromImageFile };
