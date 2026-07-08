import { contractResolver } from '../resolvers/ContractResolver.js'
import { counterpartyResolver } from '../resolvers/CounterpartyResolver.js'
import { organizationResolver } from '../resolvers/OrganizationResolver.js'
import { productResolver } from '../resolvers/ProductResolver.js'
import { projectResolver } from '../resolvers/ProjectResolver.js'
import { warehouseResolver } from '../resolvers/WarehouseResolver.js'

function cloneValue(value) {
	if (typeof structuredClone === 'function') {
		return structuredClone(value)
	}

	return JSON.parse(JSON.stringify(value))
}

function isObject(value) {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function mergeMeta(entity, meta) {
	if (!isObject(entity)) {
		return { meta }
	}

	return { ...entity, meta }
}

function normalizeReference(source) {
	if (!source) {
		return null
	}

	return isObject(source) ? source : { meta: source }
}

function getReferenceLabel(reference, keys) {
	for (const key of keys) {
		const value = reference?.[key]
		if (typeof value === 'string' && value.trim()) {
			return value.trim()
		}
	}

	return ''
}

function buildNotFoundMessage(entityName, reference, keys) {
	const label = getReferenceLabel(reference, keys)
	return label ? `${entityName} ${label} not found` : `${entityName} not found`
}

async function resolveReference(source, resolver, entityName) {
	const reference = normalizeReference(source)
	if (!reference) {
		return source
	}

	try {
		const resolved = await resolver.resolve(reference)
		if (!resolved?.meta) {
			throw new Error(
				buildNotFoundMessage(entityName, reference, [
					'externalCode',
					'code',
					'article',
					'name',
				]),
			)
		}

		return mergeMeta(reference, resolved.meta)
	} catch (error) {
		if (error?.name === 'EntityNotFoundError') {
			throw new Error(
				buildNotFoundMessage(entityName, reference, [
					'externalCode',
					'code',
					'article',
					'name',
				]),
			)
		}

		throw error
	}
}

async function resolveMetaReference(source, resolver, entityName) {
	const reference = normalizeReference(source)
	if (!reference) {
		return source
	}

	try {
		const resolved = await resolver.resolve(reference)
		if (!resolved?.meta) {
			throw new Error(
				buildNotFoundMessage(entityName, reference, [
					'externalCode',
					'code',
					'article',
					'name',
				]),
			)
		}

		return { meta: resolved.meta }
	} catch (error) {
		if (error?.name === 'EntityNotFoundError') {
			throw new Error(
				buildNotFoundMessage(entityName, reference, [
					'externalCode',
					'code',
					'article',
					'name',
				]),
			)
		}

		throw error
	}
}

async function mapPosition(position) {
	const mappedPosition = cloneValue(position)
	if (position?.assortment) {
		mappedPosition.assortment = await resolveReference(
			position.assortment,
			productResolver,
			'Product',
		)
	}

	return mappedPosition
}

function getShipmentPositions(shipment) {
	if (Array.isArray(shipment?.positions)) {
		return shipment.positions
	}

	if (Array.isArray(shipment?.positions?.rows)) {
		return shipment.positions.rows
	}

	return []
}

async function mapPositions(shipment) {
	const positions = getShipmentPositions(shipment)
	return Promise.all(positions.map(position => mapPosition(position)))
}

async function mapShipmentReferences(shipment) {
	const mappedShipment = cloneValue(shipment)
	if (shipment.organization) {
		mappedShipment.organization = await resolveMetaReference(
			shipment.organization,
			organizationResolver,
			'Organization',
		)
	}

	if (shipment.store) {
		mappedShipment.store = await resolveMetaReference(
			shipment.store,
			warehouseResolver,
			'Warehouse',
		)
	}

	if (shipment.counterparty) {
		mappedShipment.counterparty = await resolveReference(
			shipment.counterparty,
			counterpartyResolver,
			'Counterparty',
		)
	}

	if (shipment.agent) {
		mappedShipment.agent = await resolveMetaReference(
			shipment.agent,
			counterpartyResolver,
			'Counterparty',
		)
	}

	if (shipment.contract) {
		mappedShipment.contract = await resolveMetaReference(
			shipment.contract,
			contractResolver,
			'Contract',
		)
	}

	if (shipment.project) {
		mappedShipment.project = await resolveMetaReference(
			shipment.project,
			projectResolver,
			'Project',
		)
	}

	return mappedShipment
}

export class ShipmentMapper {
	async map(shipment) {
		if (!isObject(shipment)) {
			throw new Error('Shipment payload is required')
		}

		let mappedShipment = await mapShipmentReferences(shipment)
		const positions = getShipmentPositions(shipment)
		if (positions.length > 0) {
			mappedShipment.positions = await mapPositions(shipment)
		} else if (!Array.isArray(mappedShipment.positions)) {
			mappedShipment.positions = []
		}

		return mappedShipment
	}

	async mapMany(shipments) {
		return Promise.all(shipments.map(shipment => this.map(shipment)))
	}
}

export const shipmentMapper = new ShipmentMapper()

export default shipmentMapper
