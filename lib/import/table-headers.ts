export function isImportNotesHeader(header: string): boolean {
  return /^(?:notes?|备注|注释)$/i.test(header.trim());
}
