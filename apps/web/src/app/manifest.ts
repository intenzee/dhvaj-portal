import type { MetadataRoute } from 'next';

/**
 * Lets the portal be added to a phone's Home Screen as an app. On iPhone and
 * iPad that is the only way a web app can get push alerts (quick tasks).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Dhvaj Portal',
    short_name: 'Dhvaj',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#2563eb',
  };
}
