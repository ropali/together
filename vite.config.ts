import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

function getBasePath(): string {
  const custom = process.env.BASE_PATH
  if (custom) {
    return custom.endsWith('/') ? custom : `${custom}/`
  }
  if (process.env.GITHUB_ACTIONS === 'true') {
    return '/together/'
  }
  return '/'
}

// https://vite.dev/config/
export default defineConfig({
  base: getBasePath(),
  plugins: [react()],
})
