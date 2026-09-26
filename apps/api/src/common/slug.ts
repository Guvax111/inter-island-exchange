/** "Island Baby Supplies Ltd." -> "island-baby-supplies-ltd" */
export function slugify(value: string, maxLength = 50): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug.length >= 3 ? slug : `store-${slug}`.replace(/-+$/, '');
}
