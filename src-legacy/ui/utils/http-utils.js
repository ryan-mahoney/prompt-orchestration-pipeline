/**
 * HTTP utility functions for request/response handling
 */

/**
 * Send JSON response with proper headers
 * @param {http.ServerResponse} res - HTTP response object
 * @param {number} code - HTTP status code
 * @param {Object} obj - Response body object
 */
export const sendJson = (res, code, obj) => {
  res.writeHead(code, {
    "content-type": "application/json",
    connection: "close",
  });
  res.end(JSON.stringify(obj));
};

/**
 * Read raw request body with size limit
 * @param {http.IncomingMessage} req - HTTP request object
 * @param {number} maxBytes - Maximum bytes to read (default: 2MB)
 * @returns {Promise<Buffer>} Raw request body as Buffer
 */
export async function readRawBody(req, maxBytes = 2 * 1024 * 1024) {
  // 2MB guard
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error("Payload too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Parse multipart form data from request
 * @param {http.IncomingMessage} req - HTTP request object
 * @returns {Promise<Object>} Parsed form data with file content as Buffer
 */
export function parseMultipartFormData(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let boundary = null;

    // Extract boundary from content-type header
    const contentType = req.headers["content-type"];
    if (!contentType || !contentType.includes("multipart/form-data")) {
      reject(new Error("Invalid content-type: expected multipart/form-data"));
      return;
    }

    const boundaryMatch = contentType.match(/boundary=([^;]+)/);
    if (!boundaryMatch) {
      reject(new Error("Missing boundary in content-type"));
      return;
    }

    boundary = `--${boundaryMatch[1].trim()}`;

    req.on("data", (chunk) => {
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        const buffer = Buffer.concat(chunks);

        // Find file part in the buffer using string operations for headers
        const data = buffer.toString(
          "utf8",
          0,
          Math.min(buffer.length, 1024 * 1024)
        ); // First MB for header search
        const parts = data.split(boundary);

        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];

          if (part.includes('name="file"') && part.includes("filename")) {
            // Extract filename
            const filenameMatch = part.match(/filename="([^"]+)"/);
            if (!filenameMatch) continue;

            // Extract content type
            const contentTypeMatch = part.match(/Content-Type:\s*([^\r\n]+)/);

            // Find this specific part's start in the data string
            const partIndexInData = data.indexOf(part);
            const headerEndInPart = part.indexOf("\r\n\r\n");
            if (headerEndInPart === -1) {
              reject(
                new Error("Could not find end of headers in multipart part")
              );
              return;
            }

            // Calculate the actual byte positions in the buffer for this part
            const headerEndInData = partIndexInData + headerEndInPart + 4;

            // Use binary buffer to find the next boundary
            const boundaryBuf = Buffer.from(boundary, "ascii");
            const nextBoundaryIndex = buffer.indexOf(
              boundaryBuf,
              headerEndInData
            );
            const contentEndInData =
              nextBoundaryIndex !== -1
                ? nextBoundaryIndex - 2 // Subtract 2 for \r\n before boundary
                : buffer.length;

            // Extract the file content as Buffer
            const contentBuffer = buffer.slice(
              headerEndInData,
              contentEndInData
            );

            resolve({
              filename: filenameMatch[1],
              contentType: contentTypeMatch
                ? contentTypeMatch[1]
                : "application/octet-stream",
              contentBuffer: contentBuffer,
            });
            return;
          }
        }

        reject(new Error("No file field found in form data"));
      } catch (error) {
        console.error("Error parsing multipart:", error);
        reject(error);
      }
    });

    req.on("error", reject);
  });
}
