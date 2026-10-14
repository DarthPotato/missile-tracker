/** Normalize an article URL so the same story isn't drafted twice: drop the hash and tracking parameters. */
export function canonical(url: string): string {
  const u = new URL(url);
  u.hash = "";
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|cmpid)/.test(k)) u.searchParams.delete(k);
  return u.toString();
}
