import { pathToFileURL } from 'node:url'

import { newClient } from '../api/newClient.js'

const PAGE_SIZE = 100
const DEMAND_ENDPOINT = 'entity/demand'
const TEMPORARY_STATUSES = new Set([408, 429, 500, 502, 503, 504])
const MAX_RETRIES = 4
const RETRY_DELAY_MS = 1000

const LINKED_DOCUMENT_TYPES = new Map([
	['paymentin', 'entity/paymentin'],
	['paymentout', 'entity/paymentout'],
	['cashin', 'entity/cashin'],
	['cashout', 'entity/cashout'],
	['salesreturn', 'entity/salesreturn'],
	['invoiceout', 'entity/invoiceout'],
	['factureout', 'entity/factureout'],
])

const LINKED_DOCUMENT_ENDPOINTS = [
	'entity/paymentin',
	'entity/paymentout',
	'entity/cashin',
	'entity/cashout',
	'entity/salesreturn',
	'entity/invoiceout',
	'entity/factureout',
]

const LINK_FILTER_FIELDS = ['demand', 'demands', 'operations']

function delay(ms) {
	return new Promise(resolve => {
		setTimeout(resolve, ms)
	})
}

function isObject(value) {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeItems(response) {
	if (Array.isArray(response)) {
		return response
	}

	if (Array.isArray(response?.rows)) {
		return response.rows
	}

	if (Array.isArray(response?.items)) {
		return response.items
	}

	return []
}

function getShipmentNumber(shipment) {
	return shipment?.name || shipment?.number || shipment?.code || shipment?.id || ''
}

function getHref(entity) {
	return entity?.meta?.href || entity?.href || ''
}

function getType(entity) {
	return entity?.meta?.type || entity?.type || ''
}

function getIdFromHref(href) {
	return href?.split('/').filter(Boolean).at(-1) || ''
}

function getEntityId(entity) {
	return entity?.id || getIdFromHref(getHref(entity))
}

function getRelativeApiPath(href) {
	const marker = '/api/remap/1.2/'
	const index = href?.indexOf(marker) ?? -1
	return index >= 0 ? href.slice(index + marker.length) : href
}

function formatApiError(error) {
	const body =
		error?.responseBody ||
		error?.response?.data ||
		error?.data ||
		error?.body ||
		null

	if (body) {
		return `${error?.message || 'API error'}\n${JSON.stringify(body, null, 2)}`
	}

	return error?.message || 'Unknown API error'
}

function isTemporaryError(error) {
	if (!error?.status) {
		return true
	}

	return TEMPORARY_STATUSES.has(error.status)
}

function isNotFound(error) {
	return error?.status === 404 || /not found/i.test(error?.message || '')
}

async function withRetries(action, label) {
	let lastError

	for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
		try {
			return await action()
		} catch (error) {
			lastError = error
			if (!isTemporaryError(error) || attempt === MAX_RETRIES) {
				throw error
			}

			console.log(
				`Temporary API error during ${label}. Retry ${attempt}/${MAX_RETRIES - 1}`,
			)
			console.log(formatApiError(error))
			await delay(RETRY_DELAY_MS * attempt)
		}
	}

	throw lastError
}

async function paginate(endpoint, params = {}) {
	const items = []
	let offset = 0
	let metaSize

	for (;;) {
		const response = await withRetries(
			() =>
				newClient.get(endpoint, {
					params: {
						...params,
						limit: PAGE_SIZE,
						offset,
					},
				}),
			`GET ${endpoint}`,
		)

		const rows = normalizeItems(response)
		items.push(...rows)
		if (typeof response?.meta?.size === 'number') {
			metaSize = response.meta.size
		}

		if (typeof metaSize === 'number' && items.length >= metaSize) {
			break
		}

		const nextOffset = offset + PAGE_SIZE
		if (
			rows.length < PAGE_SIZE &&
			(typeof metaSize !== 'number' || nextOffset >= metaSize)
		) {
			break
		}

		offset = nextOffset
	}

	items.metaSize = metaSize ?? items.length
	return items
}

async function loadAllShipments() {
	return paginate(DEMAND_ENDPOINT)
}

async function getEntityByHref(href) {
	return withRetries(
		() => newClient.get(getRelativeApiPath(href)),
		`GET ${href}`,
	)
}

async function getShipmentDetails(shipment) {
	const href = getHref(shipment)
	if (!href) {
		return shipment
	}

	try {
		return await getEntityByHref(href)
	} catch (error) {
		if (isNotFound(error)) {
			return shipment
		}

		throw error
	}
}

function collectLinkedDocumentReferences(value, references = new Map()) {
	if (Array.isArray(value)) {
		for (const item of value) {
			collectLinkedDocumentReferences(item, references)
		}
		return references
	}

	if (!isObject(value)) {
		return references
	}

	const type = getType(value)
	const href = getHref(value)
	if (href && LINKED_DOCUMENT_TYPES.has(type)) {
		references.set(href, {
			href,
			type,
			endpoint: LINKED_DOCUMENT_TYPES.get(type),
			id: getEntityId(value),
		})
	}

	for (const child of Object.values(value)) {
		collectLinkedDocumentReferences(child, references)
	}

	return references
}

async function findLinkedDocumentsByFilters(shipment) {
	const shipmentHref = getHref(shipment)
	if (!shipmentHref) {
		return []
	}

	const documents = new Map()
	for (const endpoint of LINKED_DOCUMENT_ENDPOINTS) {
		for (const field of LINK_FILTER_FIELDS) {
			try {
				const rows = await paginate(endpoint, {
					filter: `${field}=${shipmentHref}`,
				})
				for (const row of rows) {
					const href = getHref(row)
					if (href) {
						documents.set(href, {
							href,
							type: getType(row),
							endpoint,
							id: getEntityId(row),
						})
					}
				}
			} catch (error) {
				if (!isNotFound(error)) {
					console.log(
						`Linked document lookup skipped: ${endpoint} filter ${field}`,
					)
					console.log(formatApiError(error))
				}
			}
		}
	}

	return [...documents.values()]
}

async function detectLinkedDocuments(shipment) {
	const details = await getShipmentDetails(shipment)
	const detected = collectLinkedDocumentReferences(details)
	const queried = await findLinkedDocumentsByFilters(details)

	for (const document of queried) {
		detected.set(document.href, document)
	}

	return [...detected.values()].filter(document => document.type !== 'demand')
}

async function deleteByHref(href) {
	return withRetries(
		() => newClient.delete(getRelativeApiPath(href)),
		`DELETE ${href}`,
	)
}

async function deleteLinkedDocument(document, state, visiting = new Set()) {
	if (!document?.href || state.deletedDocumentHrefs.has(document.href)) {
		return true
	}

	if (visiting.has(document.href)) {
		return true
	}

	visiting.add(document.href)

	try {
		const details = await getEntityByHref(document.href)
		const dependencies = [
			...collectLinkedDocumentReferences(details).values(),
		].filter(dependency => dependency.href !== document.href)

		for (const dependency of dependencies) {
			await deleteLinkedDocument(dependency, state, visiting)
		}
	} catch (error) {
		if (!isNotFound(error)) {
			console.log(`Unable to inspect linked document: ${document.href}`)
			console.log(formatApiError(error))
		}
	}

	try {
		await deleteByHref(document.href)
		state.linkedDocumentsDeleted += 1
		state.deletedDocumentHrefs.add(document.href)
		console.log(`Linked document deleted: ${document.type || document.href}`)
		return true
	} catch (error) {
		if (isNotFound(error)) {
			state.deletedDocumentHrefs.add(document.href)
			return true
		}

		console.log(`Failed to delete linked document: ${document.href}`)
		console.log(formatApiError(error))
		return false
	} finally {
		visiting.delete(document.href)
	}
}

async function deleteShipment(shipment) {
	const href = getHref(shipment)
	if (!href) {
		throw new Error(`Shipment has no meta.href: ${getShipmentNumber(shipment)}`)
	}

	return deleteByHref(href)
}

async function cleanupShipment(shipment, index, total, state) {
	const number = getShipmentNumber(shipment)
	console.log(`[${index}/${total}] Shipment: ${number}`)

	try {
		const linkedDocuments = await detectLinkedDocuments(shipment)
		console.log(`Linked documents detected: ${linkedDocuments.length}`)

		for (const document of linkedDocuments) {
			await deleteLinkedDocument(document, state)
		}

		try {
			await deleteShipment(shipment)
			state.deleted += 1
			console.log('Deleted')
		} catch (error) {
			if (isNotFound(error)) {
				state.skipped += 1
				console.log('Skipped: already deleted')
				return
			}

			state.failed += 1
			console.log('Failed to delete shipment')
			console.log(formatApiError(error))
		}
	} catch (error) {
		state.failed += 1
		console.log('Failed')
		console.log(formatApiError(error))
	}
}

function printRemainingShipments(shipments) {
	if (!shipments.length) {
		return
	}

	console.log('')
	console.log('Remaining shipments:')
	for (const shipment of shipments) {
		console.log(getShipmentNumber(shipment))
	}
}

function printSummary({ before, deleted, remaining, linkedDocumentsDeleted, failed }) {
	console.log('--------------------------------')
	console.log('Cleanup finished')
	console.log(`Shipments before: ${before}`)
	console.log(`Shipments deleted: ${deleted}`)
	console.log(`Shipments remaining: ${remaining}`)
	console.log(`Linked documents deleted: ${linkedDocumentsDeleted}`)
	console.log(`Failed: ${failed}`)
	console.log('--------------------------------')
}

export async function cleanupNewShipments() {
	const state = {
		deleted: 0,
		skipped: 0,
		failed: 0,
		linkedDocumentsDeleted: 0,
		deletedDocumentHrefs: new Set(),
	}

	const shipments = await loadAllShipments()
	const before = shipments.length
	console.log(`Loaded: ${before}`)

	for (let index = 0; index < shipments.length; index += 1) {
		await cleanupShipment(shipments[index], index + 1, before, state)
		console.log(
			`Progress: Loaded=${before} Deleted=${state.deleted} Skipped=${state.skipped} Failed=${state.failed}`,
		)
	}

	const remainingShipments = await loadAllShipments()
	printRemainingShipments(remainingShipments)
	printSummary({
		before,
		deleted: state.deleted,
		remaining: remainingShipments.length,
		linkedDocumentsDeleted: state.linkedDocumentsDeleted,
		failed: state.failed,
	})

	if (state.failed > 0 || remainingShipments.length > 0) {
		process.exitCode = 1
	}

	return {
		shipmentsBefore: before,
		shipmentsDeleted: state.deleted,
		shipmentsSkipped: state.skipped,
		shipmentsRemaining: remainingShipments.length,
		linkedDocumentsDeleted: state.linkedDocumentsDeleted,
		failed: state.failed,
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	cleanupNewShipments().catch(error => {
		console.log('Cleanup failed before processing could continue')
		console.log(formatApiError(error))
		process.exitCode = 1
	})
}

export default cleanupNewShipments
