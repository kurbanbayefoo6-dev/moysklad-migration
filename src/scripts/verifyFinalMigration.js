import { pathToFileURL } from 'node:url'

import { productRepository } from '../repositories/productRepository.js'
import { shipmentRepository } from '../repositories/shipmentRepository.js'
import { shipmentMapper } from '../mappers/shipmentMapper.js'
import {
	buildShipmentIdentityKey,
	buildShipmentIdentityMap,
	compareShipmentContent,
	findShipmentIdentityCandidates,
	prepareShipmentForIdentity,
} from '../utils/shipmentIdentity.js'
import { verifyCashInMigration } from './verifyCashInMigration.js'
import { verifyCashOutMigration } from './verifyCashOutMigration.js'
import { verifyEnterMigration } from './verifyEnterMigration.js'
import { verifyInventoryMigration } from './verifyInventoryMigration.js'
import { verifyLossMigration } from './verifyLossMigration.js'
import { verifyMoveMigration } from './verifyMoveMigration.js'
import { verifyPaymentInMigration } from './verifyPaymentInMigration.js'
import { verifyPurchaseChainMigration } from './verifyPurchaseChainMigration.js'

const SEPARATOR = '=================================================='
const FIRST_MISMATCH_LIMIT = 10

function getDocumentNumber(document) {
	return document?.name || document?.number || document?.code || document?.id || ''
}

function getCount(value) {
	if (Array.isArray(value)) {
		return value.length
	}

	return Number(value || 0)
}

function normalizeSection(name, stats) {
	const missing = Array.isArray(stats?.missing) ? stats.missing : []
	const different = Array.isArray(stats?.different) ? stats.different : []
	const matched = Number(stats?.matched || 0)

	return {
		name,
		matched,
		missing,
		different,
		total: matched + missing.length + different.length,
		error: stats?.error || null,
	}
}

function createFailureSection(name, error) {
	return {
		name,
		matched: 0,
		missing: [],
		different: [],
		total: 0,
		error,
		excluded: true,
		status: getFailureStatus(error),
	}
}

function getFailureStatus(error) {
	const message = String(error?.message || '')
	const isTimeout =
		message.includes('timeout') ||
		message.includes('ECONN') ||
		message.includes('no response') ||
		message.includes('Превышено ограничение')

	return isTimeout
		? 'Verification failed (API timeout)'
		: 'Verification failed (API error)'
}

function formatDifference(difference) {
	if (!difference) {
		return ''
	}

	if (difference.field) {
		return difference.field
	}

	return JSON.stringify(difference)
}

function formatMismatch(item) {
	const number = item?.number || item?.shipmentNumber || item?.name || ''
	const id = item?.id || item?.shipmentId || ''
	const reason = item?.reason ? ` ${item.reason}` : ''
	const differences = Array.isArray(item?.differences)
		? item.differences.slice(0, 3).map(formatDifference).join(', ')
		: ''
	const suffix = differences ? ` differences: ${differences}` : reason

	return `- ${number || id || 'unknown'}${id ? ` (${id})` : ''}${suffix}`
}

function printEntityReport(section) {
	console.log('')
	console.log(section.name)

	if (section.excluded) {
		console.log('Status:')
		console.log(section.status)
		if (section.error?.message) {
			console.log(`Reason: ${section.error.message}`)
		}
		return
	}

	console.log(`Matched: ${section.matched}`)
	console.log(`Missing: ${getCount(section.missing)}`)
	console.log(`Different: ${getCount(section.different)}`)

	const mismatches = [...section.missing, ...section.different].slice(
		0,
		FIRST_MISMATCH_LIMIT,
	)
	if (mismatches.length > 0) {
		console.log('First mismatches:')
		for (const mismatch of mismatches) {
			console.log(formatMismatch(mismatch))
		}
	}
}

async function runQuietly(action) {
	const originalLog = console.log
	try {
		console.log = () => {}
		return await action()
	} finally {
		console.log = originalLog
	}
}

async function runVerifier(name, verifier) {
	try {
		const result = await runQuietly(verifier)
		return normalizeSection(name, result)
	} catch (error) {
		return createFailureSection(name, error)
	}
}

async function verifyProducts() {
	const [oldProducts, newProducts] = await Promise.all([
		productRepository.findAllByEndpoint('entity/product', { client: 'old' }),
		productRepository.findAllByEndpoint('entity/product', { client: 'new' }),
	])
	const newByExternalCode = new Map(
		newProducts
			.filter(product => product.externalCode)
			.map(product => [product.externalCode, product]),
	)
	const newByNameAndCode = new Map(
		newProducts
			.filter(product => product.name && product.code)
			.map(product => [`${product.name}~${product.code}`, product]),
	)
	const stats = {
		matched: 0,
		missing: [],
		different: [],
	}

	for (const oldProduct of oldProducts) {
		const nameAndCodeKey =
			oldProduct.name && oldProduct.code
				? `${oldProduct.name}~${oldProduct.code}`
				: ''
		const newProduct =
			newByExternalCode.get(oldProduct.externalCode) ||
			newByNameAndCode.get(nameAndCodeKey)
		if (!newProduct) {
			stats.missing.push({
				number: getDocumentNumber(oldProduct),
				id: oldProduct.id,
				reason: 'No NEW product with matching externalCode or name+code',
			})
			continue
		}

		const differences = []
		if (oldProduct.name !== newProduct.name) {
			differences.push({
				field: 'name',
				old: oldProduct.name,
				new: newProduct.name,
			})
		}

		if (differences.length > 0) {
			stats.different.push({
				number: getDocumentNumber(oldProduct),
				id: oldProduct.id,
				differences,
			})
		} else {
			stats.matched += 1
		}
	}

	return normalizeSection('Products', stats)
}

async function verifyShipments() {
	const [oldSummaries, newShipments] = await Promise.all([
		shipmentRepository.findAll({ client: 'old' }),
		shipmentRepository.findAll({
			client: 'new',
			params: {
				expand: 'organization,store,agent,counterparty,positions.assortment',
			},
		}),
	])
	const newByExternalCode = new Map(
		newShipments
			.filter(shipment => shipment.externalCode)
			.map(shipment => [shipment.externalCode, shipment]),
	)
	const newIdentityMap = buildShipmentIdentityMap(newShipments)
	const stats = {
		matched: 0,
		missing: [],
		different: [],
	}

	for (const oldSummary of oldSummaries) {
		const oldShipment = await shipmentRepository.findById(oldSummary.id, {
			client: 'old',
		})
		const expected = prepareShipmentForIdentity(
			await runQuietly(() => shipmentMapper.map(oldShipment)),
			oldShipment,
		)
		const byExternalCode = newByExternalCode.get(oldShipment.externalCode)
		const exactByIdentity =
			newIdentityMap.get(buildShipmentIdentityKey(expected))?.[0] || null
		const newShipment = byExternalCode || exactByIdentity

		if (!newShipment) {
			const candidates = findShipmentIdentityCandidates(expected, newShipments)
			stats.missing.push({
				number: getDocumentNumber(oldShipment),
				id: oldShipment.id,
				reason: candidates.length
					? 'No exact NEW shipment match; near candidates exist'
					: 'No NEW shipment match',
			})
			continue
		}

		const differences = compareShipmentContent(expected, newShipment)
		if (differences.length > 0) {
			stats.different.push({
				number: getDocumentNumber(oldShipment),
				id: oldShipment.id,
				differences,
			})
		} else {
			stats.matched += 1
		}
	}

	return normalizeSection('Shipments', stats)
}

async function verifyPurchaseChainSections() {
	try {
		const result = await runQuietly(verifyPurchaseChainMigration)
		return [
			normalizeSection('Purchase Orders', result.purchaseOrderStats),
			normalizeSection('Supplies', result.supplyStats),
			normalizeSection('PaymentOut', result.paymentStats),
		]
	} catch (error) {
		return [
			createFailureSection('Purchase Orders', error),
			createFailureSection('Supplies', error),
			createFailureSection('PaymentOut', error),
		]
	}
}

async function verifyFinalMigration() {
	const sections = []

	sections.push(await verifyProducts())
	sections.push(...(await verifyPurchaseChainSections()))
	sections.push(await verifyShipments())
	sections.push(await runVerifier('PaymentIn', verifyPaymentInMigration))
	sections.push(await runVerifier('CashIn', verifyCashInMigration))
	sections.push(await runVerifier('CashOut', verifyCashOutMigration))
	sections.push(await runVerifier('Move', verifyMoveMigration))
	sections.push(await runVerifier('Enter', verifyEnterMigration))
	sections.push(await runVerifier('Loss', verifyLossMigration))
	sections.push(await runVerifier('Inventory', verifyInventoryMigration))

	console.log(SEPARATOR)
	console.log('FINAL MIGRATION REPORT')
	console.log(SEPARATOR)

	for (const section of sections) {
		printEntityReport(section)
	}

	const includedSections = sections.filter(section => !section.excluded)
	const excludedSections = sections.filter(section => section.excluded)
	const oldTotal = includedSections.reduce(
		(total, section) => total + section.total,
		0,
	)
	const matchedTotal = includedSections.reduce(
		(total, section) => total + section.matched,
		0,
	)
	const missingTotal = includedSections.reduce(
		(total, section) => total + section.missing.length,
		0,
	)
	const differentTotal = includedSections.reduce(
		(total, section) => total + section.different.length,
		0,
	)
	const migrationSafe =
		missingTotal === 0 && differentTotal === 0 && excludedSections.length === 0

	console.log('')
	console.log(SEPARATOR)
	console.log('TOTAL')
	console.log(SEPARATOR)
	console.log('')
	console.log(`Entities checked: ${includedSections.length}`)
	if (excludedSections.length > 0) {
		console.log(`Entities excluded: ${excludedSections.length}`)
	}
	console.log('')
	console.log('Documents:')
	console.log(`OLD total: ${oldTotal}`)
	console.log(`NEW matched: ${matchedTotal}`)
	console.log(`Missing: ${missingTotal}`)
	console.log(`Different: ${differentTotal}`)
	console.log('')
	console.log('Migration Safe:')
	console.log(migrationSafe ? 'YES' : 'NO')
	console.log('')
	console.log(SEPARATOR)

	process.exitCode = migrationSafe ? 0 : 1
	return { sections, migrationSafe }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	verifyFinalMigration().catch(error => {
		console.log('Final migration verification failed')
		console.log(error?.message || 'Unknown error')
		process.exitCode = 1
	})
}

export { verifyFinalMigration }
export default verifyFinalMigration
