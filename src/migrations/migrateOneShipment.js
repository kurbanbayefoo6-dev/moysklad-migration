import { shipmentMapper } from '../mappers/shipmentMapper.js'
import { shipmentService } from '../services/shipmentService.js'
import {
	describeShipmentIdentity,
	shipmentIdentitiesMatch,
} from '../utils/shipmentIdentity.js'
import {
	printApiError,
	printFinalPayload as printDiagnosticFinalPayload,
	startShipmentDiagnostics,
} from '../utils/migrationDiagnostics.js'
import { validateShipmentPayload } from '../validators/shipmentValidator.js'

function isObject(value) {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function pickValue(source, paths, fallback = '') {
	for (const path of paths) {
		let current = source
		for (const key of path) {
			current = current?.[key]
		}

		if (current !== undefined && current !== null && current !== '') {
			return current
		}
	}

	return fallback
}

function getShipmentNumber(shipment) {
	return pickValue(
		shipment,
		[['name'], ['number'], ['code'], ['id']],
		'Unknown',
	)
}

function getReferenceLabel(reference) {
	return pickValue(
		reference,
		[['name'], ['code'], ['externalCode'], ['meta', 'href']],
		'Unknown',
	)
}

function getPositions(shipment) {
	if (Array.isArray(shipment?.positions)) {
		return shipment.positions
	}

	if (Array.isArray(shipment?.positions?.rows)) {
		return shipment.positions.rows
	}

	return []
}

function collectOldReferenceStrings(value, references = new Set()) {
	if (Array.isArray(value)) {
		for (const item of value) {
			collectOldReferenceStrings(item, references)
		}
		return references
	}

	if (!isObject(value)) {
		return references
	}

	if (value.meta?.href) {
		references.add(value.meta.href)
	}

	if (value.id) {
		references.add(value.id)
	}

	for (const child of Object.values(value)) {
		collectOldReferenceStrings(child, references)
	}

	return references
}

function findOldReferenceLeaks(value, oldReferences, path = '$', leaks = []) {
	if (Array.isArray(value)) {
		value.forEach((item, index) =>
			findOldReferenceLeaks(item, oldReferences, `${path}[${index}]`, leaks),
		)
		return leaks
	}

	if (!isObject(value)) {
		if (typeof value === 'string' && oldReferences.has(value)) {
			leaks.push(`${path}: ${value}`)
		}
		return leaks
	}

	for (const [key, child] of Object.entries(value)) {
		findOldReferenceLeaks(child, oldReferences, `${path}.${key}`, leaks)
	}

	return leaks
}

function validateNoOldReferences(payload, oldShipment) {
	const oldReferences = collectOldReferenceStrings(oldShipment)
	const leaks = findOldReferenceLeaks(payload, oldReferences)

	if (leaks.length) {
		throw new Error(
			[
				'Mapped shipment payload still contains OLD account references:',
				...leaks,
			].join('\n'),
		)
	}
}

function buildPreviewLines(oldShipment, payload, existingShipment = null) {
	const products = getPositions(payload).map(position =>
		getReferenceLabel(position.assortment),
	)

	return [
		`Shipment Number: ${getShipmentNumber(payload)}`,
		`Moment: ${payload?.moment || ''}`,
		`Counterparty: ${getReferenceLabel(payload?.agent)}`,
		`Organization: ${getReferenceLabel(payload?.organization)}`,
		`Warehouse: ${getReferenceLabel(payload?.store)}`,
		`Products: ${products.length ? products.join(', ') : 'None'}`,
		`Comment: ${oldShipment?.description || ''}`,
		`Duplicate detected: ${existingShipment ? 'YES' : 'NO'}`,
		existingShipment
			? 'Duplicate reason: moment, organization, counterparty, warehouse, total and product set match'
			: 'Duplicate reason: no full identity match found',
		'Identity:',
		describeShipmentIdentity(payload),
	]
}

function printPreview(oldShipment, payload, existingShipment = null) {
	buildPreviewLines(oldShipment, payload, existingShipment)
}

function printFinalPayload(payload) {
	printDiagnosticFinalPayload(payload)
}

function printCreatedShipment(createdShipment, shipmentNumber) {
	return { createdShipment, shipmentNumber }
}

function printCreationError(error) {
	printApiError(error)
}

async function fetchOldShipment(oldShipmentId, shipmentServiceInstance) {
	return shipmentServiceInstance.getById(oldShipmentId, { client: 'old' })
}

async function findExistingShipment(payload, shipmentServiceInstance) {
	if (!payload?.moment) {
		return null
	}

	const candidates =
		typeof shipmentServiceInstance.findAllByMoment === 'function'
			? await shipmentServiceInstance.findAllByMoment(payload.moment, {
					client: 'new',
					params: {
						expand:
							'organization,store,agent,counterparty,positions.assortment',
					},
				})
			: []

	for (const candidate of candidates.filter(Boolean)) {
		if (shipmentIdentitiesMatch(candidate, payload)) {
			return candidate
		}
	}

	return null
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
	startShipmentDiagnostics(oldShipment, oldShipmentId)
	const payload = await shipmentMapperInstance.map(oldShipment)
	const identityPayload = {
		...payload,
		sum: oldShipment?.sum,
		description: oldShipment?.description,
	}

	validator(payload)
	validateNoOldReferences(payload, oldShipment)

	const existingShipment = dryRun
		? null
		: await findExistingShipment(identityPayload, shipmentServiceInstance)

	if (!silent) {
		printPreview(oldShipment, identityPayload, existingShipment)
	}

	if (dryRun) {
		if (!silent) {
			printFinalPayload(payload)
		}
		return {
			status: 'dry-run',
			success: true,
			skipped: false,
			created: false,
			oldShipmentId,
			newShipmentId: null,
			shipmentNumber: getShipmentNumber(payload),
		}
	}

	if (existingShipment) {
		return {
			success: true,
			skipped: true,
			created: false,
			shipmentNumber: getShipmentNumber(payload),
			oldShipmentId,
			newShipmentId: existingShipment.id,
		}
	}

	let createdShipment
	try {
		printFinalPayload(payload)

		createdShipment = await createNewShipment(payload, shipmentServiceInstance)
	} catch (error) {
		printCreationError(error)
		throw error
	}

	if (!silent) {
		printCreatedShipment(createdShipment, getShipmentNumber(payload))
	}

	return {
		success: true,
		skipped: false,
		created: true,
		shipmentNumber: getShipmentNumber(payload),
		oldShipmentId,
		newShipmentId: createdShipment?.id || createdShipment?.meta?.href || null,
	}
}

export default migrateOneShipment
