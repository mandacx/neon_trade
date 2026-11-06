import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/admin/', '/profile'] }],
    sitemap: 'https://stockstrendz.com/sitemap.xml',
  };
}
