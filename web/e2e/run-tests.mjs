import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')
const e2eDir = join(projectRoot, 'e2e')
const specPattern = /\.(spec|test)\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i
const specFiles = []

function collectSpecFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      collectSpecFiles(fullPath)
    } else if (specPattern.test(entry.name)) {
      specFiles.push(fullPath)
    }
  }
}

if (existsSync(e2eDir)) {
  collectSpecFiles(e2eDir)
} else {
  console.warn(`[e2e] No Playwright test directory found at ${relative(projectRoot, e2eDir)}`)
}

const truthy = (value) => {
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

const rawArgs = process.argv.slice(2)
const forwardedArgs = []
let forceHeadless = false
let forceHeaded = false

for (const arg of rawArgs) {
  if (arg === '--headless') {
    forceHeadless = true
    continue
  }
  if (arg === '--headed') {
    forceHeaded = true
    continue
  }
  forwardedArgs.push(arg)
}

if (specFiles.length === 0 && forwardedArgs.length === 0) {
  const rel = relative(projectRoot, e2eDir) || 'e2e'
  console.log(`[e2e] No Playwright spec files found under ${rel}; skipping run.`)
  process.exit(0)
}

const runHeaded = forceHeaded || (!forceHeadless && !truthy(process.env.CI) && !truthy(process.env.HEADLESS))
const cliArgs = ['test', ...(runHeaded ? ['--headed'] : []), ...forwardedArgs]

const binName = process.platform === 'win32' ? 'playwright.cmd' : 'playwright'
const binPath = join(projectRoot, 'node_modules', '.bin', binName)

const child = spawn(binPath, cliArgs, {
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
})

child.on('exit', (code) => {
  process.exit(code ?? 1)
})

child.on('error', (err) => {
  console.error('[e2e] Failed to launch Playwright CLI:', err)
  process.exit(1)
})
