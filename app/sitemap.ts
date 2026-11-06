import type { MetadataRoute } from 'next';

const BASE = 'https://stockstrendz.com';

export default function sitemap(): MetadataRoute.Sitemap {
  return ['/', '/guide', '/upgrade', '/about', '/contact', '/privacy', '/terms'].map((p) => ({
    url: `${BASE}${p === '/' ? '' : p}`,
  }));
}
