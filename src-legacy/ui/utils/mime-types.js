import path from "path";

// MIME type detection map
const MIME_MAP = {
  // Text types
  ".txt": "text/plain",
  ".log": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".xml": "application/xml",
  ".yaml": "application/x-yaml",
  ".yml": "application/x-yaml",
  ".toml": "application/toml",
  ".ini": "text/plain",
  ".conf": "text/plain",
  ".config": "text/plain",
  ".env": "text/plain",
  ".gitignore": "text/plain",
  ".dockerfile": "text/plain",
  ".sh": "application/x-sh",
  ".bash": "application/x-sh",
  ".zsh": "application/x-sh",
  ".fish": "application/x-fish",
  ".ps1": "application/x-powershell",
  ".bat": "application/x-bat",
  ".cmd": "application/x-cmd",

  // Code types
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".cjs": "application/javascript",
  ".ts": "application/typescript",
  ".mts": "application/typescript",
  ".cts": "application/typescript",
  ".jsx": "application/javascript",
  ".tsx": "application/typescript",
  ".py": "text/x-python",
  ".rb": "text/x-ruby",
  ".php": "application/x-php",
  ".java": "text/x-java-source",
  ".c": "text/x-c",
  ".cpp": "text/x-c++",
  ".cc": "text/x-c++",
  ".cxx": "text/x-c++",
  ".h": "text/x-c",
  ".hpp": "text/x-c++",
  ".cs": "text/x-csharp",
  ".go": "text/x-go",
  ".rs": "text/x-rust",
  ".swift": "text/x-swift",
  ".kt": "text/x-kotlin",
  ".scala": "text/x-scala",
  ".r": "text/x-r",
  ".sql": "application/sql",
  ".pl": "text/x-perl",
  ".lua": "text/x-lua",
  ".vim": "text/x-vim",
  ".el": "text/x-elisp",
  ".lisp": "text/x-lisp",
  ".hs": "text/x-haskell",
  ".ml": "text/x-ocaml",
  ".ex": "text/x-elixir",
  ".exs": "text/x-elixir",
  ".erl": "text/x-erlang",
  ".beam": "application/x-erlang-beam",

  // Web types
  ".html": "text/html",
  ".htm": "text/html",
  ".xhtml": "application/xhtml+xml",
  ".css": "text/css",
  ".scss": "text/x-scss",
  ".sass": "text/x-sass",
  ".less": "text/x-less",
  ".styl": "text/x-stylus",
  ".vue": "text/x-vue",
  ".svelte": "text/x-svelte",

  // Data formats
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet",
  ".odp": "application/vnd.oasis.opendocument.presentation",

  // Images
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
  ".psd": "image/vnd.adobe.photoshop",
  ".ai": "application/pdf", // Illustrator files often saved as PDF
  ".eps": "application/postscript",

  // Audio
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
  ".m4a": "audio/mp4",
  ".wma": "audio/x-ms-wma",

  // Video
  ".mp4": "video/mp4",
  ".avi": "video/x-msvideo",
  ".mov": "video/quicktime",
  ".wmv": "video/x-ms-wmv",
  ".flv": "video/x-flv",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".m4v": "video/mp4",

  // Archives
  ".zip": "application/zip",
  ".rar": "application/x-rar-compressed",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".tgz": "application/gzip",
  ".bz2": "application/x-bzip2",
  ".xz": "application/x-xz",
  ".7z": "application/x-7z-compressed",
  ".deb": "application/x-debian-package",
  ".rpm": "application/x-rpm",
  ".dmg": "application/x-apple-diskimage",
  ".iso": "application/x-iso9660-image",

  // Fonts
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".eot": "application/vnd.ms-fontobject",

  // Misc
  ".bin": "application/octet-stream",
  ".exe": "application/x-msdownload",
  ".dll": "application/x-msdownload",
  ".so": "application/x-sharedlib",
  ".dylib": "application/x-mach-binary",
  ".class": "application/java-vm",
  ".jar": "application/java-archive",
  ".war": "application/java-archive",
  ".ear": "application/java-archive",
  ".apk": "application/vnd.android.package-archive",
  ".ipa": "application/x-itunes-ipa",
};

/**
 * Determine MIME type from file extension
 * @param {string} filename - File name
 * @returns {string} MIME type
 */
function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  return MIME_MAP[ext] || "application/octet-stream";
}

/**
 * Check if MIME type should be treated as text
 * @param {string} mime - MIME type
 * @returns {boolean} True if text-like
 */
function isTextMime(mime) {
  return (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/javascript" ||
    mime === "application/xml" ||
    mime === "application/x-yaml" ||
    mime === "application/x-sh" ||
    mime === "application/x-bat" ||
    mime === "application/x-cmd" ||
    mime === "application/x-powershell" ||
    mime === "image/svg+xml" ||
    mime === "application/x-ndjson" ||
    mime === "text/csv" ||
    mime === "text/markdown"
  );
}

export { MIME_MAP, getMimeType, isTextMime };
