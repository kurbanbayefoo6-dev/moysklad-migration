import fs from 'node:fs/promises'
import path from 'node:path'

import { shipmentRepository } from '../repositories/shipmentRepository.js'
import { migrateOneShipment } from './migrateOneShipment.js'

const REPORT_FILE = path.join(process.cwd(), 'reports', 'shipment-migration-report.json')

async function readShipments(repository, client) {
	return repository.findAll({ client })
}

async function writeReport(report) {
	await fs.mkdir(path.dirname(REPORT_FILE), { recursive: true })
	await fs.writeFile(REPORT_FILE, JSON.stringify(report, null, 2), 'utf8')
}

function createReport({ dryRun, startedAt }) {
	return {
		created: 0,
		failed: 0,
		skipped: 0,
		startedAt: startedAt.toISOString(),
		finishedAt: null,
		duration: 0,
		dryRun,
		oldShipmentsLoaded: 0,
		reportFile: REPORT_FILE,
	}
}

function finalizeReport(report, startedAt) {
	report.finishedAt = new Date().toISOString()
	report.duration = Date.now() - startedAt.getTime()
	return report
}

export async function migrateShipments({
	dryRun = false,
	shipmentRepository: shipmentRepositoryInstance = shipmentRepository,
	migrateOneShipment: migrateOneShipmentFn = migrateOneShipment,
} = {}) {
	const startedAt = new Date()
	const report = createReport({
		dryRun,
		startedAt,
	})

	let fatalError = null
	try {
		const oldShipments = await readShipments(shipmentRepositoryInstance, 'old')
		report.oldShipmentsLoaded = oldShipments.length

		for (let index = 0; index < oldShipments.length; index += 1) {
			const shipment = oldShipments[index]
			try {
				const result = await migrateOneShipmentFn(shipment.id, {
					dryRun,
					silent: true,
				})

				if (result?.skipped) {
					report.skipped += 1
				} else {
					report.created += 1
				}
			} catch (error) {
				report.failed += 1
				console.log('FAILED')
				console.log('Reason:')
				console.log(error?.message || 'Unknown error')
				console.log('------------------------------------------------')
			}
		}

		console.log('--------------------------------')
		console.log('Migration finished')
		console.log(`Created: ${report.created}`)
		console.log(`Skipped: ${report.skipped}`)
		console.log(`Failed: ${report.failed}`)
		console.log('--------------------------------')

		return finalizeReport(report, startedAt)
	} catch (error) {
		fatalError = error
		report.failed += 1
		report.error = error?.message || 'Unknown error'
		console.log('FAILED')
		console.log('Reason:')
		console.log(report.error)
		console.log('------------------------------------------------')
		return finalizeReport(report, startedAt)
	} finally {
		const finalReport = finalizeReport(report, startedAt)
		try {
			await writeReport(finalReport)
		} catch (writeError) {
			console.log('FAILED')
			console.log('Reason:')
			console.log(writeError?.message || 'Unable to write report')
			console.log('------------------------------------------------')
			if (!fatalError) {
				fatalError = writeError
			}
		}
		if (fatalError) {
			throw fatalError
		}
	}
}

export default migrateShipments
