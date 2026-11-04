import { chromium } from 'playwright'

const baseUrl = process.env.AEROSIM_E2E_URL ?? 'http://127.0.0.1:5173'
const pageErrors = []
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(30000)
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto(baseUrl + '/overview', { waitUntil: 'networkidle' })
  await page.getByText('Fleet overview', { exact: true }).waitFor()
  await page.getByRole('link', { name: 'Component registry' }).click()
  await page.getByRole('link', { name: 'ENG-MOUNT-001', exact: true }).click()
  await page.getByRole('button', { name: 'Historical profile' }).click()
  await page.getByText('Historical sensor observations').waitFor()
  await page.getByRole('button', { name: 'Initialise from history' }).click()
  await page.getByText(/ENG-MOUNT-001 initialised from its own history/).waitFor({ timeout: 90000 })

  await page.getByRole('link', { name: 'Flights & schedule' }).click()
  await page.getByRole('button', { name: 'Complete flight (synthetic)' }).first().click()
  await page.getByText('AC001-F0013', { exact: true }).last().waitFor({ timeout: 30000 })
  await page.getByRole('link', { name: 'Upcoming-flight predictions' }).click()
  await page.getByRole('button', { name: 'Generate and store pre-flight prediction' }).waitFor()
  await page.getByRole('button', { name: 'Generate and store pre-flight prediction' }).click()
  await page.getByText(/Prediction pred-/).waitFor({ timeout: 30000 })

  await page.getByRole('link', { name: 'Validation' }).click()
  await page.getByText('External experimental benchmark — PHM 2019 aluminum lap joint').waitFor({ timeout: 300000 })
  await page.getByText('Dataset files not detected').waitFor({ timeout: 300000 })

  await page.getByRole('link', { name: 'Component registry' }).click()
  await page.getByRole('link', { name: 'ENG-MOUNT-001', exact: true }).click()
  await page.getByRole('button', { name: 'Correct identity' }).click()
  await page.getByLabel('Effective date').fill('2026-11-05')
  await page.getByLabel('Serial number').fill('E2E-SN-CORRECTED')
  await page.getByLabel('Reason').fill('Verified serial number against the nameplate and maintenance register.')
  await page.getByLabel('Maintenance / identity reference').fill('E2E-IDENTITY-001')
  await page.getByRole('button', { name: 'Record identity correction' }).click()
  await page.getByText(/Identity correction recorded for ENG-MOUNT-001/).waitFor()

  await page.getByRole('button', { name: 'Replace component' }).click()
  await page.getByLabel('Replacement installation date').fill('2026-11-05')
  await page.getByLabel('New serial number').fill('E2E-SN-REPLACEMENT')
  await page.getByLabel('Work order / reference').fill('E2E-WO-REPLACEMENT-001')
  await page.getByLabel('Replacement reason').fill('Physical component removed and replaced with a new serial-numbered assembly.')
  await page.getByRole('button', { name: 'Retire and create replacement' }).click()
  await page.getByText('E2E-SN-REPLACEMENT').waitFor({ timeout: 30000 })

  if (pageErrors.length) throw new Error('Browser page errors: ' + pageErrors.join(' | '))
  console.log('Browser acceptance passed: overview → twin history → flight completion → prediction → PHM not-ready state → identity correction → component replacement.')
} finally {
  await browser.close()
}
