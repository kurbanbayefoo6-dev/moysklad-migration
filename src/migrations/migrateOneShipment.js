import { shipmentMapper } from '../mappers/shipmentMapper.js'
import { shipmentService } from '../services/shipmentService.js'
import { validateShipmentPayload } from '../validators/shipmentValidator.js'

function isObject(value) {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function firstDefined(value, fallback = '') {
	return value === undefined || value === null || value === ''
		? fallback
		: value
}

function getNestedValue(source, path) {
	let current = source
	for (const key of path) {
		if (!isObject(current) && !Array.isArray(current)) {
			return undefined
		}

		current = current[key]
	}

	return current
}

function pickValue(source, paths, fallback = '') {
	for (const path of paths) {
		const value = getNestedValue(source, path)
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

function getShipmentNumber(shipment) {
	return pickValue(
		shipment,
		[['name'], ['number'], ['code'], ['id']],
		'Unknown',
	)
}

function getCurrencyValue(shipment) {
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

function getTotalSum(shipment) {
	return pickValue(shipment, [['sum'], ['totalSum'], ['price']], 0)
}

function buildPreviewLines(shipment) {
	const positions = Array.isArray(shipment.positions) ? shipment.positions : []
	const products = positions.map(position =>
		getReferenceLabel(position.assortment),
	)

	return [
		`Shipment Number: ${getShipmentNumber(shipment)}`,
		`Moment: ${firstDefined(shipment.moment, 'Unknown')}`,
		`Counterparty: ${getReferenceLabel(shipment.counterparty)}`,
		`Organization: ${getReferenceLabel(shipment.organization)}`,
		`Warehouse: ${getReferenceLabel(shipment.store)}`,
		`Number of positions: ${positions.length}`,
		`Products: ${products.length ? products.join(', ') : 'None'}`,
		`Currency: ${getCurrencyValue(shipment)}`,
		`Total Sum: ${getTotalSum(shipment)}`,
	]
}

function printPreview(shipment) {
	console.log('--- Shipment Migration Preview ---')
	for (const line of buildPreviewLines(shipment)) {
		console.log(line)
	}
}

function printFinalPayload(payload) {
	console.log('--- Final Payload ---')
	console.log(JSON.stringify(payload, null, 2))
}

function printCreatedShipment(createdShipment, shipmentNumber) {
	console.log('Shipment created')
	console.log(
		`New Shipment ID: ${createdShipment?.id || createdShipment?.meta?.href || 'Unknown'}`,
	)
	console.log(`Shipment Number: ${shipmentNumber}`)
}

function printCreationError(error) {
	const body =
		error?.responseBody ||
		error?.response?.data ||
		error?.data ||
		error?.body ||
		error?.message ||
		'Unknown error'

	console.log('Shipment creation failed')
	console.error(JSON.stringify(body, null, 2))
}

const STRIP_FIELDS = new Set([
	'owner',
	'group',
	'created',
	'updated',
	'accountId',
	'id',
	'meta',
	'files',
	'buyPrice',
	'salePrices',
	'minPrice',
	'currency',
])

const RELATION_FIELDS = new Set([
	'agent',
	'organization',
	'store',
	'contract',
	'project',
	'counterparty',
	'assortment',
])

function shouldPreserveMeta(path) {
	return path.some(part => RELATION_FIELDS.has(part))
}

function sanitizePayload(value, path = []) {
	if (Array.isArray(value)) {
		return value.map((item, index) => sanitizePayload(item, [...path, index]))
	}

	if (!isObject(value)) {
		return value
	}

	if (path.includes('agent')) {
		return value.meta
			? { meta: sanitizePayload(value.meta, [...path, 'meta']) }
			: {}
	}

	const sanitized = {}
	for (const [key, childValue] of Object.entries(value)) {
		if (STRIP_FIELDS.has(key)) {
			if (key === 'meta' && shouldPreserveMeta(path)) {
				sanitized[key] = sanitizePayload(childValue, [...path, key])
			}
			continue
		}

		sanitized[key] = sanitizePayload(childValue, [...path, key])
	}

	return sanitized
}

async function fetchOldShipment(oldShipmentId, shipmentServiceInstance) {
	return shipmentServiceInstance.getById(oldShipmentId, { client: 'old' })
}

async function mapShipment(oldShipment, mapper) {
	return mapper.map(oldShipment)
}

async function createNewShipment(payload, shipmentServiceInstance) {
	return shipmentServiceInstance.create(payload, { client: 'new' })
}

export async function migrateOneShipment(
	oldShipmentId,
	{
		dryRun = true,
		silent = false,
		shipmentService: shipmentServiceInstance = shipmentService,
		shipmentMapper: shipmentMapperInstance = shipmentMapper,
		validator = validateShipmentPayload,
	} = {},
) {
	if (!oldShipmentId) {
		throw new Error('Shipment ID is required')
	}

	const oldShipment = await fetchOldShipment(
		oldShipmentId,
		shipmentServiceInstance,
	)
	const payload = await mapShipment(oldShipment, shipmentMapperInstance)
	validator(payload)
	if (!silent) {
		printPreview(payload)
	}

	if (dryRun) {
		if (!silent) {
			printFinalPayload(payload)
		}
		return {
			success: true,
			oldShipmentId,
			newShipmentId: null,
			shipmentNumber: getShipmentNumber(payload),
		}
	}

	let createdShipment
	try {
		if (!dryRun && !silent) {
			console.log('Creating shipment...')
		}
		const sanitizedPayload = sanitizePayload(payload)
		if (!silent) {
			console.log('Final payload.agent')
			console.log(JSON.stringify(sanitizedPayload.agent ?? null, null, 2))
		}
		createdShipment = await createNewShipment(
			sanitizedPayload,
			shipmentServiceInstance,
		)
	} catch (error) {
		printCreationError(error)
		throw error
	}

	if (!silent) {
		console.log('Shipment created successfully')
		printCreatedShipment(createdShipment, getShipmentNumber(payload))
	}

	return {
		success: true,
		oldShipmentId,
		newShipmentId: createdShipment?.id || createdShipment?.meta?.href || null,
		shipmentNumber: getShipmentNumber(payload),
	}
}

export default migrateOneShipment
