import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const nginx = readFileSync('nginx.conf', 'utf8')

describe('share resource delivery', () => {
  it('compresses text responses without including already compressed binary MIME types', () => {
    expect(nginx).toMatch(/gzip\s+on;/u)
    expect(nginx).toMatch(/gzip_comp_level\s+5;/u)
    expect(nginx).toMatch(/gzip_min_length\s+1024;/u)
    expect(nginx).toMatch(/gzip_vary\s+on;/u)
    expect(nginx).toMatch(/gzip_proxied\s+any;/u)
    const types = nginx.match(/gzip_types\s+([^;]+);/u)?.[1] ?? ''
    for (const type of ['text/css', 'application/javascript', 'text/javascript', 'application/json', 'text/plain']) expect(types).toContain(type)
    expect(types).not.toMatch(/image\/|application\/zip|application\/octet-stream/u)
  })

  it('isolates immutable hashed assets from HTML fallback and protected content', () => {
    expect(nginx).toContain('map $uri $dashboard_asset_cache_control')
    expect(nginx).toContain('public, max-age=31536000, immutable')
    const location = nginx.match(/location \^~ \/console\/assets\/ \{([\s\S]*?)\n  \}/u)?.[1]
    expect(location).toContain('alias /app/dashboard/dist/assets/;')
    expect(location).toContain('add_header Cache-Control $dashboard_asset_cache_control;')
    expect(location).not.toContain('index.html')
    expect(location).not.toContain('always')
    for (const path of ['/sites/', '/share/']) {
      const block = nginx.slice(nginx.indexOf(`location ${path} {`)).split('\n  }')[0]
      expect(block).not.toContain('immutable')
    }
  })
})
