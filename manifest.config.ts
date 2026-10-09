import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'Job Autofill AI',
  version: '0.5.0',
  description: 'Detects application form fields and fills them from your CV.',
  action: { default_popup: 'popup.html', default_title: 'Job Autofill AI' },
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  options_ui: { page: 'options.html', open_in_tab: true },
  permissions: ['activeTab', 'storage', 'webNavigation'],
  host_permissions: [
    'http://localhost:8000/*',
    'https://*.ngrok-free.app/*',
    'https://*.ngrok-free.dev/*',
    'https://*.ngrok.app/*',
    'https://*.ngrok.io/*',
  ],
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
      all_frames: true,
    },
  ],
})
