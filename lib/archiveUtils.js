const AdmZip = require("adm-zip");
const { createExtractorFromData } = require("node-unrar-js");

/**
 * Detect archive type from magic bytes
 */
function getArchiveType(buffer) {
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) return "zip";
  if (buffer[0] === 0x52 && buffer[1] === 0x61 && buffer[2] === 0x72)
    return "rar";
  return "zip";
}

/**
 * List all SRT files in a ZIP archive (names only)
 */
function listSrtsFromZip(buffer) {
  const zip = new AdmZip(buffer);
  return zip
    .getEntries()
    .filter(
      (e) =>
        !e.isDirectory &&
        !e.entryName.includes("__MACOSX") &&
        e.entryName.toLowerCase().endsWith(".srt")
    )
    .map((e) => e.entryName);
}

/**
 * List all SRT files in a RAR archive (names only)
 */
async function listSrtsFromRar(buffer) {
  const extractor = await createExtractorFromData({ data: buffer });
  const list = extractor.getFileList();
  const fileHeaders = [...list.fileHeaders];

  return fileHeaders
    .filter(
      (h) =>
        !h.flags.directory &&
        h.name.toLowerCase().endsWith(".srt") &&
        !h.name.includes("__MACOSX")
    )
    .map((h) => h.name);
}

/**
 * List all SRT file names in an archive (ZIP or RAR)
 * @param {Buffer} archiveBuffer - The archive data
 * @returns {Promise<string[]>} - Array of SRT file paths inside the archive
 */
async function listSrtFiles(archiveBuffer) {
  const archiveType = getArchiveType(archiveBuffer);

  if (archiveType === "rar") {
    return await listSrtsFromRar(archiveBuffer);
  } else {
    return listSrtsFromZip(archiveBuffer);
  }
}

/**
 * Extract a specific SRT file from a ZIP archive
 */
function extractSrtFromZip(buffer, srtPath) {
  const zip = new AdmZip(buffer);
  const entry = zip.getEntry(srtPath);
  if (!entry) return null;
  return entry.getData();
}

/**
 * Extract a specific SRT file from a RAR archive
 */
async function extractSrtFromRar(buffer, srtPath) {
  const extractor = await createExtractorFromData({ data: buffer });
  const extracted = extractor.extract({ files: [srtPath] });
  const files = [...extracted.files];

  if (files.length === 0) return null;
  return Buffer.from(files[0].extraction);
}

/**
 * Extract a specific SRT file from an archive (ZIP or RAR)
 * @param {Buffer} archiveBuffer - The archive data
 * @param {string} srtPath - Path of the SRT file inside the archive
 * @returns {Promise<Buffer|null>} - The SRT file content or null if not found
 */
async function extractSrtFile(archiveBuffer, srtPath) {
  const archiveType = getArchiveType(archiveBuffer);

  if (archiveType === "rar") {
    return await extractSrtFromRar(archiveBuffer, srtPath);
  } else {
    return extractSrtFromZip(archiveBuffer, srtPath);
  }
}

module.exports = {
  getArchiveType,
  listSrtFiles,
  extractSrtFile,
};
