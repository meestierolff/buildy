export interface UniqueLocalFileSelection {
  duplicateCount: number;
  files: File[];
}

function localFileIdentity(file: File): string {
  return JSON.stringify([file.name, file.size, file.type, file.lastModified]);
}

/**
 * Prevents the common accidental double-selection of the same local file.
 * The identity remains browser-local and is never used as authority or sent as metadata.
 */
export function selectUniqueLocalFiles(
  existingFiles: readonly File[],
  selectedFiles: readonly File[],
): UniqueLocalFileSelection {
  const known = new Set(existingFiles.map(localFileIdentity));
  const files: File[] = [];
  let duplicateCount = 0;

  for (const file of selectedFiles) {
    const identity = localFileIdentity(file);
    if (known.has(identity)) {
      duplicateCount += 1;
      continue;
    }
    known.add(identity);
    files.push(file);
  }

  return { duplicateCount, files };
}
