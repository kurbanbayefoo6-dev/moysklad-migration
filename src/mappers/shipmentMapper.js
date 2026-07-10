import { newClient } from '../api/newClient.js'
import { oldClient } from '../api/oldClient.js'
import { contractResolver } from '../resolvers/ContractResolver.js'
import { counterpartyResolver } from '../resolvers/CounterpartyResolver.js'
import { currencyResolver } from '../resolvers/CurrencyResolver.js'
import { organizationResolver } from '../resolvers/OrganizationResolver.js'
import { productResolver } from '../resolvers/ProductResolver.js'
import { projectResolver } from '../resolvers/ProjectResolver.js'
import { shipmentAttributeResolver } from '../resolvers/ShipmentAttributeResolver.js'
import { stateResolver } from '../resolvers/StateResolver.js'
import { warehouseResolver } from '../resolvers/WarehouseResolver.js'
import {
	annotateDiagnosticError,
	createDiagnosticError,
	getReferenceDiagnostics,
	logFailed,
	logIgnoredError,
	logOk,
} from '../utils/migrationDiagnostics.js'

function cloneValue(value) {
	if (typeof structuredClone === 'function') {
		return structuredClone(value)
	}

	return JSON.parse(JSON.stringify(value))
}

function isObject(value) {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function compactObject(value) {
	return isObject(value) && Object.keys(value).length === 0 ? undefined : value
}

function extractMeta(meta) {
	if (!meta?.href || !meta?.type || !meta?.mediaType) {
		return null
	}

	return {
		href: meta.href,
		type: meta.type,
		mediaType: meta.mediaType,
	}
}

function toMetaReference(resolved) {
	const meta = extractMeta(resolved?.meta)
	return meta ? { meta } : null
}

function getShipmentNumber(shipment) {
	return shipment?.name || shipment?.number || shipment?.code || shipment?.id || ''
}

async function resolveRequiredReference(source, resolver, label, failureReason) {
	let resolved
	try {
		resolved = await resolver.resolve(source)
	} catch (error) {
		logFailed(failureReason, {
			...getReferenceDiagnostics(source),
			message: error?.message || 'Unknown error',
		})
		throw annotateDiagnosticError(error, failureReason, source)
	}

	const reference = toMetaReference(resolved)
	if (!reference) {
		logFailed(failureReason, getReferenceDiagnostics(source))
		throw createDiagnosticError(
			`${label} is required and could not be mapped`,
			failureReason,
			source,
		)
	}

	logOk(`${label} resolved`)
	return reference
}

async function resolveOptionalReference(source, resolver, label, failureReason = null) {
	if (!source) {
		return null
	}

	try {
		const reference = toMetaReference(await resolver.resolve(source))
		if (reference) {
			logOk(`${label} resolved`)
			return reference
		}

		if (failureReason) {
			logFailed(failureReason, getReferenceDiagnostics(source))
		}
		return null
	} catch (error) {
		if (failureReason) {
			logFailed(failureReason, {
				...getReferenceDiagnostics(source),
				message: error?.message || 'Unknown error',
			})
		}
		logIgnoredError(`${label} resolver error ignored to preserve migration behavior`, error)
		return null
	}
}

async function mapRate(rate) {
	if (!isObject(rate)) {
		return undefined
	}

	const mappedRate = {}
	if (rate.currency) {
		const currency = toMetaReference(
			await currencyResolver.resolveOldReference(rate.currency),
		)
		if (currency) {
			mappedRate.currency = currency
		}
	}

	return compactObject(mappedRate)
}

function getRelativeApiPath(href) {
	const marker = '/api/remap/1.2/'
	const index = href?.indexOf(marker) ?? -1
	return index >= 0 ? href.slice(index + marker.length) : href
}

async function mapOrganizationAccount(oldAccount, mappedOrganization) {
	const oldHref = oldAccount?.meta?.href
	const newOrganizationHref = mappedOrganization?.meta?.href
	if (!oldHref || !newOrganizationHref) {
		return null
	}

	try {
		const oldAccountDetails = await oldClient.get(getRelativeApiPath(oldHref))
		const newAccountsResponse = await newClient.get(`${newOrganizationHref}/accounts`)
		const newAccounts = Array.isArray(newAccountsResponse?.rows)
			? newAccountsResponse.rows
			: []
		const newAccount = newAccounts.find(account =>
			Boolean(
				oldAccountDetails?.accountNumber &&
					account?.accountNumber === oldAccountDetails.accountNumber,
			),
		)

		return toMetaReference(newAccount)
	} catch (error) {
		logIgnoredError('Organization account resolver error ignored to preserve migration behavior', error)
		return null
	}
}

async function mapAttributes(attributes) {
	if (!Array.isArray(attributes)) {
		return undefined
	}

	const mappedAttributes = []
	for (const attribute of attributes) {
		const mappedAttribute = await resolveOptionalReference(
			attribute,
			shipmentAttributeResolver,
			'Attribute',
			'Attribute not found',
		)
		if (!mappedAttribute) {
			continue
		}

		mappedAttributes.push({
			...mappedAttribute,
			value: cloneValue(attribute.value),
		})
	}

	return mappedAttributes
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

async function mapPosition(position, shipment) {
	const assortment = await resolveRequiredReference(
		position.assortment,
		productResolver,
		`Product in shipment ${getShipmentNumber(shipment)}`,
		'Product not found',
	)
	logOk(`Product ${position.assortment?.name || position.assortment?.code || position.assortment?.article || position.assortment?.externalCode || position.assortment?.id || 'Unknown'} resolved`)
	const mappedPosition = { assortment }
	const fields = [
		'quantity',
		'price',
		'discount',
		'vat',
		'vatEnabled',
		'overhead',
		'reserve',
		'pack',
		'trackingCodes',
	]

	for (const field of fields) {
		if (position[field] !== undefined) {
			mappedPosition[field] = cloneValue(position[field])
		}
	}

	return mappedPosition
}

async function mapPositions(shipment) {
	const positions = await Promise.all(
		getShipmentPositions(shipment).map(position => mapPosition(position, shipment)),
	)
	logOk(`Positions resolved (count=${positions.length})`)
	return positions
}

function copyScalarFields(payload, shipment) {
	const fields = [
		'name',
		'moment',
		'applicable',
		'description',
		'externalCode',
		'shipmentAddress',
		'shipmentAddressFull',
		'vatEnabled',
		'vatIncluded',
	]

	for (const field of fields) {
		if (shipment[field] !== undefined) {
			payload[field] = cloneValue(shipment[field])
		}
	}
}

function removeUndefined(value) {
	if (Array.isArray(value)) {
		return value.map(removeUndefined).filter(item => item !== undefined)
	}

	if (!isObject(value)) {
		return value
	}

	const result = {}
	for (const [key, child] of Object.entries(value)) {
		const mappedChild = removeUndefined(child)
		if (mappedChild !== undefined) {
			result[key] = mappedChild
		}
	}

	return compactObject(result)
}

export class ShipmentMapper {
	async map(shipment) {
		if (!isObject(shipment)) {
			throw new Error('Shipment payload is required')
		}

		const payload = {}
		copyScalarFields(payload, shipment)

		payload.organization = await resolveRequiredReference(
			shipment.organization,
			organizationResolver,
			'Organization',
			'Organization not found',
		)
		payload.store = await resolveRequiredReference(
			shipment.store,
			warehouseResolver,
			'Warehouse',
			'Warehouse not found',
		)
		payload.agent = await resolveRequiredReference(
			shipment.agent || shipment.counterparty,
			counterpartyResolver,
			'Counterparty',
			'Counterparty not found',
		)

		const contract = await resolveOptionalReference(
			shipment.contract,
			contractResolver,
			'Contract',
			'Contract not found',
		)
		if (contract) {
			payload.contract = contract
		}

		const project = await resolveOptionalReference(
			shipment.project,
			projectResolver,
			'Project',
			'Project not found',
		)
		if (project) {
			payload.project = project
		}

		const state = await resolveOptionalReference(
			shipment.state,
			stateResolver,
			'State',
		)
		if (state) {
			payload.state = state
		}

		const rate = await mapRate(shipment.rate)
		if (rate) {
			payload.rate = rate
		}

		const organizationAccount = await mapOrganizationAccount(
			shipment.organizationAccount,
			payload.organization,
		)
		if (organizationAccount) {
			payload.organizationAccount = organizationAccount
		}

		const attributes = await mapAttributes(shipment.attributes)
		if (attributes) {
			payload.attributes = attributes
		}
		logOk(`Attributes resolved (count=${attributes?.length || 0})`)

		payload.positions = await mapPositions(shipment)

		return removeUndefined(payload) || {}
	}

	async mapMany(shipments) {
		return Promise.all(shipments.map(shipment => this.map(shipment)))
	}
}

export const shipmentMapper = new ShipmentMapper()

export default shipmentMapper
