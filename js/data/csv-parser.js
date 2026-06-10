/**
 * CSV Parser for the Building Energy Analysis System.
 * Pure function — no DOM dependencies, safe for Web Worker usage.
 */

/**
 * Strip a UTF-8 BOM marker from the beginning of text if present.
 * @param {string} text
 * @returns {string}
 */
function stripBOM(text) {
  if (text.charCodeAt(0) === 0xFEFF) {
    return text.slice(1);
  }
  return text;
}

/**
 * Normalize line endings to LF and split into individual lines,
 * respecting quoted fields that may contain newlines.
 * @param {string} text
 * @returns {string[]}
 */
function splitLines(text) {
  const lines = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === '"') {
      // Peek ahead for escaped quote ("")
      if (inQuotes && i + 1 < text.length && text[i + 1] === '"') {
        current += '""';
        i++; // skip the second quote
      } else {
        inQuotes = !inQuotes;
        current += ch;
      }
    } else if (!inQuotes && (ch === '\r' || ch === '\n')) {
      // Handle CRLF as a single line break
      if (ch === '\r' && i + 1 < text.length && text[i + 1] === '\n') {
        i++;
      }
      lines.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  // Push the last line if non-empty
  if (current.length > 0) {
    lines.push(current);
  }

  return lines;
}

/**
 * Parse a single CSV line into an array of field values.
 * Handles quoted fields with embedded delimiters, newlines, and escaped quotes.
 * @param {string} line
 * @param {string} delimiter
 * @returns {string[]}
 */
function parseLine(line, delimiter) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        // Check for escaped quote ("")
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 2;
        } else {
          // End of quoted field
          inQuotes = false;
          i++;
        }
      } else {
        current += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === delimiter) {
        fields.push(current.trim());
        current = '';
        i++;
      } else {
        current += ch;
        i++;
      }
    }
  }

  // Push the last field
  fields.push(current.trim());

  return fields;
}

/**
 * Parse CSV text into structured data.
 *
 * @param {string} text - Raw CSV text content.
 * @param {Object} [options] - Parsing options.
 * @param {string} [options.delimiter=','] - Field delimiter character.
 * @param {boolean} [options.hasHeader=true] - Whether the first row is a header row.
 * @returns {{ headers: string[], rows: string[][], rowCount: number }}
 */
export function parseCSV(text, options = {}) {
  const delimiter = options.delimiter || ',';
  const hasHeader = options.hasHeader !== undefined ? options.hasHeader : true;

  // Strip BOM if present
  const cleaned = stripBOM(text);

  // Split into lines respecting quoted newlines
  const lines = splitLines(cleaned);

  // Filter out completely empty lines
  const nonEmptyLines = lines.filter(line => line.trim().length > 0);

  if (nonEmptyLines.length === 0) {
    return { headers: [], rows: [], rowCount: 0 };
  }

  // Parse all lines into field arrays
  const parsedLines = nonEmptyLines.map(line => parseLine(line, delimiter));

  let headers;
  let rows;

  if (hasHeader) {
    headers = parsedLines[0];
    rows = parsedLines.slice(1);
  } else {
    // Generate numeric headers: col_0, col_1, ...
    const maxCols = parsedLines.reduce((max, row) => Math.max(max, row.length), 0);
    headers = Array.from({ length: maxCols }, (_, i) => `col_${i}`);
    rows = parsedLines;
  }

  // Normalize row lengths to match header count
  const headerCount = headers.length;
  const normalizedRows = rows.map(row => {
    if (row.length < headerCount) {
      // Pad short rows with empty strings
      return [...row, ...Array(headerCount - row.length).fill('')];
    }
    if (row.length > headerCount) {
      // Truncate extra columns
      return row.slice(0, headerCount);
    }
    return row;
  });

  return {
    headers,
    rows: normalizedRows,
    rowCount: normalizedRows.length
  };
}
