export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function generateProjectSlug(name: string, id: string): string {
  const base = toSlug(name) || "project";
  const suffix = id.replace(/-/g, "").slice(0, 6);
  return `${base}-${suffix}`;
}
