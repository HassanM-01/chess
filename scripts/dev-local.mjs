// Dev server in local mode: ignores the Supabase settings in .env.local so there is no login and data stays in the browser.
// (Real environment variables win over .env.local in Vite, so blank values switch Supabase off.)
import { spawn } from 'node:child_process';

const port = process.env.PORT ?? '5174';
const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', port, '--strictPort'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '', VITE_COACH_ENABLED: '1', VITE_COACH_MOCK: '1' },
});
child.on('exit', (code) => process.exit(code ?? 0));
