import fs from 'node:fs/promises'
import path from 'node:path'

import { shipmentRepository } from '../repositories/shipmentRepository.js'
import { migrateOneShipment } from './migrateOneShipment.js'

const REPORT_FILE = path.join(
	process.cwd(),
	'reports',
	'shipment-migration-report.json',
)

function isObject(value) {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeText(value) {
	if (value === undefined || value === null) {
		return ''
	}

	return String(value).trim().toLowerCase()
}

function normalizeMoment(value) {
	if (!value) {
		return ''
	}

	const date = new Date(value)
	return Number.isNaN(date.getTime())
		? normalizeText(value)
		: date.toISOString()
}

function getNestedValue(source, pathParts) {
	let current = source
	for (const key of pathParts) {
		if (!isObject(current) && !Array.isArray(current)) {
			return undefined
		}

		current = current[key]
	}

	return current
}

function pickValue(source, paths, fallback = '') {
	for (const pathParts of paths) {
		const value = getNestedValue(source, pathParts)
		if (value !== undefined && value !== null && value !== '') {
			return value
		}
	}

	return fallback
}

function getReferenceLabel(reference) {
	return pickValue(
		reference,
		[['name'], ['code'], ['externalCode'], ['meta', 'href']],
		'Unknown',
	)
}

function getCurrencyLabel(shipment) {
	return pickValue(
		shipment,
		[
			['rate', 'currency', 'name'],
			['rate', 'currency', 'code'],
			['currency', 'name'],
			['currency', 'code'],
			['rate', 'name'],
		],
		'Unknown',
	)
}

function getShipmentNumber(shipment) {
	return pickValue(
		shipment,
		[['name'], ['number'], ['code'], ['id']],
		'Unknown',
	)
}

function normalizeAmount(value) {
	if (value === undefined || value === null || value === '') {
		return ''
	}

	const numericValue = Number(value)
	return Number.isNaN(numericValue)
		? normalizeText(value)
		: String(numericValue)
}

function createShipmentSignature(shipment) {
	return [
		normalizeText(getShipmentNumber(shipment)),
		normalizeMoment(shipment.moment),
		normalizeText(getReferenceLabel(shipment.counterparty)),
		normalizeText(getReferenceLabel(shipment.organization)),
		normalizeAmount(pickValue(shipment, [['sum'], ['totalSum'], ['price']], 0)),
		normalizeText(getCurrencyLabel(shipment)),
	].join('|')
}

function sortShipments(shipments) {
	return [...shipments].sort((left, right) => {
		const leftSignature = createShipmentSignature(left)
		const rightSignature = createShipmentSignature(right)
		if (leftSignature !== rightSignature) {
			return leftSignature.localeCompare(rightSignature)
		}

		return normalizeText(left.id).localeCompare(normalizeText(right.id))
	})
}

function applyWindow(shipments, limit, offset = 0) {
	const startIndex = Math.max(0, Number(offset) || 0)
	if (limit === undefined || limit === null || limit === '') {
		return shipments.slice(startIndex)
	}

	const windowSize = Math.max(0, Number(limit) || 0)
	return shipments.slice(startIndex, startIndex + windowSize)
}

function buildSignatureIndex(shipments) {
	const index = new Map()
	for (const shipment of shipments) {
		const signature = createShipmentSignature(shipment)
		index.set(signature, (index.get(signature) || 0) + 1)
	}

	return index
}

function hasSignature(index, shipment) {
	const signature = createShipmentSignature(shipment)
	return (index.get(signature) || 0) > 0
}

function consumeSignature(index, shipment) {
	const signature = createShipmentSignature(shipment)
	const currentCount = index.get(signature) || 0
	if (currentCount <= 1) {
		index.delete(signature)
		return
	}

	index.set(signature, currentCount - 1)
}

function registerSignature(index, shipment) {
	const signature = createShipmentSignature(shipment)
	index.set(signature, (index.get(signature) || 0) + 1)
}

function printLoadedSummary({ oldCount, newCount, missingCount }) {
	console.log('Loaded:')
	console.log(`Old Shipments: ${oldCount}`)
	console.log(`New Shipments: ${newCount}`)
	console.log(`Missing: ${missingCount}`)
	console.log('------------------------------------------------')
}

function printMigrationStart(index, total, shipment) {
	console.log('Migrating:')
	console.log(`${index}/${total}`)
	console.log('Shipment:')
	console.log(getShipmentNumber(shipment))
}

function printMigrationSuccess() {
	console.log('SUCCESS')
	console.log('------------------------------------------------')
}

function printMigrationFailure(error) {
	console.log('FAILED')
	console.log('Reason:')
	console.log(error?.message || 'Unknown error')
	console.log('------------------------------------------------')
}

function printFinishedSummary(report) {
	console.log('Finished')
	console.log(`Success: ${report.success}`)
	console.log(`Failed: ${report.failed}`)
	console.log(`Skipped: ${report.skipped}`)
}

async function readShipments(repository, client) {
	return repository.findAll({ client })
}

async function writeReport(report) {
	await fs.mkdir(path.dirname(REPORT_FILE), { recursive: true })
	await fs.writeFile(REPORT_FILE, JSON.stringify(report, null, 2), 'utf8')
}

function createReport({ dryRun, limit, offset, continueOnError, startedAt }) {
	return {
		success: 0,
		failed: 0,
		skipped: 0,
		startedAt: startedAt.toISOString(),
		finishedAt: null,
		duration: 0,
		dryRun,
		limit: limit ?? null,
		offset: offset ?? 0,
		continueOnError,
		oldShipmentsLoaded: 0,
		newShipmentsLoaded: 0,
		missingShipments: 0,
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
	limit,
	offset = 0,
	continueOnError = false,
	shipmentRepository: shipmentRepositoryInstance = shipmentRepository,
	migrateOneShipment: migrateOneShipmentFn = migrateOneShipment,
} = {}) {
	const startedAt = new Date()
	const report = createReport({
		dryRun,
		limit,
		offset,
		continueOnError,
		startedAt,
	})

	let fatalError = null
	try {
		const [oldShipments, newShipments] = await Promise.all([
			readShipments(shipmentRepositoryInstance, 'old'),
			readShipments(shipmentRepositoryInstance, 'new'),
		])

		const sortedOldShipments = sortShipments(oldShipments)
		const selectedOldShipments = applyWindow(sortedOldShipments, limit, offset)
		const newSignatureIndex = buildSignatureIndex(newShipments)
		const missingShipments = selectedOldShipments.filter(
			shipment => !hasSignature(newSignatureIndex, shipment),
		)

		report.oldShipmentsLoaded = selectedOldShipments.length
		report.newShipmentsLoaded = newShipments.length
		report.missingShipments = missingShipments.length
		report.skipped = selectedOldShipments.length - missingShipments.length

		printLoadedSummary({
			oldCount: report.oldShipmentsLoaded,
			newCount: report.newShipmentsLoaded,
			missingCount: report.missingShipments,
		})

		for (let index = 0; index < missingShipments.length; index += 1) {
			const shipment = missingShipments[index]
			if (hasSignature(newSignatureIndex, shipment)) {
				report.skipped += 1
				continue
			}

			printMigrationStart(index + 1, missingShipments.length, shipment)

			try {
				await migrateOneShipmentFn(shipment.id, {
					dryRun,
					silent: true,
				})

				report.success += 1
				printMigrationSuccess()

				if (!dryRun) {
					registerSignature(newSignatureIndex, shipment)
				}
			} catch (error) {
				report.failed += 1
				printMigrationFailure(error)

				if (!continueOnError) {
					report.skipped += missingShipments.length - index - 1
					break
				}
			}
		}

		printFinishedSummary(report)
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
