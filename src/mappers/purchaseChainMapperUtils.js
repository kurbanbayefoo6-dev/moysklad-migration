import { newClient } from '../api/newClient.js'
import { oldClient } from '../api/oldClient.js'
import { contractResolver } from '../resolvers/ContractResolver.js'
import { counterpartyResolver } from '../resolvers/CounterpartyResolver.js'
import { countryResolver } from '../resolvers/CountryResolver.js'
import { currencyResolver } from '../resolvers/CurrencyResolver.js'
import { organizationResolver } from '../resolvers/OrganizationResolver.js'
import { productResolver } from '../resolvers/ProductResolver.js'
import { projectResolver } from '../resolvers/ProjectResolver.js'
import { StateResolver } from '../resolvers/StateResolver.js'
import { ShipmentAttributeResolver } from '../resolvers/ShipmentAttributeResolver.js'
import { warehouseResolver } from '../resolvers/WarehouseResolver.js'
import {
	annotateDiagnosticError,
	createDiagnosticError,
	getReferenceDiagnostics,
	logFailed,
	logIgnoredError,
	logOk,
} from '../utils/migrationDiagnostics.js'

export const purchaseOrderStateResolver = new StateResolver({
	metadataEndpoint: 'entity/purchaseorder/metadata',
})
export const supplyStateResolver = new StateResolver({
	metadataEndpoint: 'entity/supply/metadata',
})
export const paymentOutStateResolver = new StateResolver({
	metadataEndpoint: 'entity/paymentout/metadata',
})
export const cashOutStateResolver = new StateResolver({
	metadataEndpoint: 'entity/cashout/metadata',
})
export const moveStateResolver = new StateResolver({
	metadataEndpoint: 'entity/move/metadata',
})
export const enterStateResolver = new StateResolver({
	metadataEndpoint: 'entity/enter/metadata',
})
export const lossStateResolver = new StateResolver({
	metadataEndpoint: 'entity/loss/metadata',
})
export const inventoryStateResolver = new StateResolver({
	metadataEndpoint: 'entity/inventory/metadata',
})
export const paymentInStateResolver = new StateResolver({
	metadataEndpoint: 'entity/paymentin/metadata',
})
export const cashInStateResolver = new StateResolver({
	metadataEndpoint: 'entity/cashin/metadata',
})

export const purchaseOrderAttributeResolver = new ShipmentAttributeResolver({
	attributesEndpoint: 'entity/purchaseorder/metadata/attributes',
})
export const supplyAttributeResolver = new ShipmentAttributeResolver({
	attributesEndpoint: 'entity/supply/metadata/attributes',
})
export const paymentOutAttributeResolver = new ShipmentAttributeResolver({
	attributesEndpoint: 'entity/paymentout/metadata/attributes',
})
export const cashOutAttributeResolver = new ShipmentAttributeResolver({
	attributesEndpoint: 'entity/cashout/metadata/attributes',
})
export const moveAttributeResolver = new ShipmentAttributeResolver({
	attributesEndpoint: 'entity/move/metadata/attributes',
})
export const enterAttributeResolver = new ShipmentAttributeResolver({
	attributesEndpoint: 'entity/enter/metadata/attributes',
})
export const lossAttributeResolver = new ShipmentAttributeResolver({
	attributesEndpoint: 'entity/loss/metadata/attributes',
})
export const inventoryAttributeResolver = new ShipmentAttributeResolver({
	attributesEndpoint: 'entity/inventory/metadata/attributes',
})
export const paymentInAttributeResolver = new ShipmentAttributeResolver({
	attributesEndpoint: 'entity/paymentin/metadata/attributes',
})
export const cashInAttributeResolver = new ShipmentAttributeResolver({
	attributesEndpoint: 'entity/cashin/metadata/attributes',
})

const RATE_EPSILON = 0.000000001

const rateRemapDiagnostics = {
	purchaseorder: 0,
	supply: 0,
	paymentout: 0,
	failures: [],
}

let rateRemapContext = null
let rateRemapContextPending = null

export function cloneValue(value) {
	if (typeof structuredClone === 'function') {
		return structuredClone(value)
	}

	return JSON.parse(JSON.stringify(value))
}

export function isObject(value) {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function getRows(value) {
	if (Array.isArray(value)) {
		return value
	}

	if (Array.isArray(value?.rows)) {
		return value.rows
	}

	if (Array.isArray(value?.items)) {
		return value.items
	}

	return []
}

export function compactObject(value) {
	return isObject(value) && Object.keys(value).length === 0 ? undefined : value
}

export function removeUndefined(value) {
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

export function extractMeta(meta) {
	if (!meta?.href || !meta?.type || !meta?.mediaType) {
		return null
	}

	return {
		href: meta.href,
		type: meta.type,
		mediaType: meta.mediaType,
	}
}

export function toMetaReference(resolved) {
	const meta = extractMeta(resolved?.meta)
	return meta ? { meta } : null
}

export function getEntityId(entity) {
	return (
		entity?.id ||
		entity?.meta?.href?.split('/').filter(Boolean).at(-1) ||
		entity?.href?.split('/').filter(Boolean).at(-1) ||
		''
	)
}

export function getDocumentNumber(document) {
	return document?.name || document?.number || document?.code || document?.id || ''
}

export function getRelativeApiPath(href) {
	const marker = '/api/remap/1.2/'
	const index = href?.indexOf(marker) ?? -1
	return index >= 0 ? href.slice(index + marker.length) : href
}

export async function resolveRequiredReference(source, resolver, label, failureReason) {
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

export async function resolveOptionalReference(
	source,
	resolver,
	label,
	failureReason = null,
) {
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
		logIgnoredError(`${label} resolver error ignored`, error)
		return null
	}
}

function normalizeString(value) {
	return String(value ?? '').trim()
}

function getCurrencyKey(currency) {
	return (
		normalizeString(currency?.isoCode) ||
		normalizeString(currency?.code) ||
		normalizeString(currency?.name)
	)
}

function getReferenceHref(source) {
	return source?.meta?.href || source?.href || ''
}

function getReferenceId(source) {
	return (
		source?.id ||
		getReferenceHref(source).split('/').filter(Boolean).at(-1) ||
		''
	)
}

function getCurrencyEffectiveRate(currency) {
	if (!currency) {
		return null
	}

	if (currency.default) {
		return 1
	}

	const rate = Number(currency.rate)
	if (!Number.isFinite(rate) || rate <= 0) {
		return null
	}

	return currency.indirect ? 1 / rate : rate
}

function getDocumentEffectiveRate(rate, currency) {
	const value = Number(rate?.value)
	if (Number.isFinite(value) && value > 0) {
		return value
	}

	return getCurrencyEffectiveRate(currency)
}

function findCurrencyByReference(currencies, reference) {
	const href = getReferenceHref(reference)
	const id = getReferenceId(reference)

	return (
		currencies.find(currency => href && currency?.meta?.href === href) ||
		currencies.find(currency => id && currency?.id === id) ||
		null
	)
}

function findMatchingCurrency(currencies, source) {
	const key = getCurrencyKey(source)
	return (
		currencies.find(currency => key && getCurrencyKey(currency) === key) ||
		currencies.find(currency => source?.name && currency?.name === source.name) ||
		null
	)
}

function isSameCurrency(left, right) {
	const leftHref = getReferenceHref(left)
	const rightHref = getReferenceHref(right)
	const leftId = getReferenceId(left)
	const rightId = getReferenceId(right)

	return Boolean(
		(leftHref && rightHref && leftHref === rightHref) ||
			(leftId && rightId && leftId === rightId),
	)
}

async function getRateRemapContext() {
	if (rateRemapContext) {
		return rateRemapContext
	}

	if (!rateRemapContextPending) {
		rateRemapContextPending = (async () => {
			const [oldCurrencies, newCurrencies] = await Promise.all([
				currencyResolver.getOldCurrencies(),
				currencyResolver.repository.findAll({ client: 'new' }),
			])
			const newDefaultCurrency =
				newCurrencies.find(currency => currency.default) ||
				newCurrencies.find(currency => !currency.archived) ||
				newCurrencies[0] ||
				null
			const oldAnchorCurrency = findMatchingCurrency(
				oldCurrencies,
				newDefaultCurrency,
			)
			const anchorEffectiveRate = getCurrencyEffectiveRate(oldAnchorCurrency)

			if (!newDefaultCurrency || !oldAnchorCurrency || !anchorEffectiveRate) {
				throw new Error(
					'Unable to determine Purchase Chain rate normalization currency',
				)
			}

			return {
				oldCurrencies,
				newCurrencies,
				newDefaultCurrency,
				oldAnchorCurrency,
				anchorEffectiveRate,
			}
		})()
	}

	try {
		rateRemapContext = await rateRemapContextPending
		return rateRemapContext
	} finally {
		rateRemapContextPending = null
	}
}

function recordRateRemap(documentType) {
	if (Object.hasOwn(rateRemapDiagnostics, documentType)) {
		rateRemapDiagnostics[documentType] += 1
	}
}

function recordRateRemapFailure(documentType, document, reason) {
	rateRemapDiagnostics.failures.push({
		type: documentType,
		number: getDocumentNumber(document),
		id: getEntityId(document),
		reason,
	})
}

export function resetPurchaseRateRemapDiagnostics() {
	rateRemapDiagnostics.purchaseorder = 0
	rateRemapDiagnostics.supply = 0
	rateRemapDiagnostics.paymentout = 0
	rateRemapDiagnostics.failures = []
}

export function getPurchaseRateRemapDiagnostics() {
	return {
		purchaseorder: rateRemapDiagnostics.purchaseorder,
		supply: rateRemapDiagnostics.supply,
		paymentout: rateRemapDiagnostics.paymentout,
		failures: [...rateRemapDiagnostics.failures],
	}
}

export async function mapRate(rate, { documentType = '', document = null } = {}) {
	if (!isObject(rate)) {
		return undefined
	}

	const mappedRate = {}
	if (rate.currency) {
		const context = await getRateRemapContext()
		const oldCurrency = findCurrencyByReference(context.oldCurrencies, rate.currency)
		const resolvedCurrency = await currencyResolver.resolveOldReference(rate.currency)
		const currency = toMetaReference(resolvedCurrency)
		const newCurrency = findCurrencyByReference(
			context.newCurrencies,
			resolvedCurrency,
		)
		if (currency) {
			mappedRate.currency = currency
		}

		const oldEffectiveRate = getDocumentEffectiveRate(rate, oldCurrency)
		if (oldEffectiveRate && context.anchorEffectiveRate) {
			const normalizedRate = oldEffectiveRate / context.anchorEffectiveRate
			const isAccountingCurrency = isSameCurrency(
				newCurrency,
				context.newDefaultCurrency,
			)
			if (
				!isAccountingCurrency &&
				Math.abs(normalizedRate - 1) > RATE_EPSILON
			) {
				mappedRate.value = normalizedRate
			}
			recordRateRemap(documentType)
		} else {
			recordRateRemapFailure(
				documentType,
				document,
				`Unable to remap rate for currency ${newCurrency?.name || oldCurrency?.name || 'unknown'}`,
			)
		}
	}

	return compactObject(mappedRate)
}

export async function mapAccount(oldAccount, mappedOwner) {
	const oldHref = oldAccount?.meta?.href
	const newOwnerHref = mappedOwner?.meta?.href
	if (!oldHref || !newOwnerHref) {
		return null
	}

	try {
		const oldAccountDetails = await oldClient.get(getRelativeApiPath(oldHref))
		const newAccountsResponse = await newClient.get(`${newOwnerHref}/accounts`)
		const newAccounts = getRows(newAccountsResponse)
		const newAccount = newAccounts.find(account =>
			Boolean(
				oldAccountDetails?.accountNumber &&
					account?.accountNumber === oldAccountDetails.accountNumber,
			),
		)

		return toMetaReference(newAccount)
	} catch (error) {
		logIgnoredError('Account resolver error ignored', error)
		return null
	}
}

export async function mapAttributes(attributes, resolver) {
	if (!Array.isArray(attributes)) {
		return undefined
	}

	const mappedAttributes = []
	for (const attribute of attributes) {
		const mappedAttribute = await resolveOptionalReference(
			attribute,
			resolver,
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

export async function mapCommonDocumentReferences(
	payload,
	document,
	{
		stateResolver,
		attributeResolver,
		requireStore = true,
		documentType = '',
		agentResolver = counterpartyResolver,
		agentLabel = 'Counterparty',
		agentFailureReason = 'Counterparty not found',
	} = {},
) {
	payload.organization = await resolveRequiredReference(
		document.organization,
		organizationResolver,
		'Organization',
		'Organization not found',
	)
	payload.agent = await resolveRequiredReference(
		document.agent,
		agentResolver,
		agentLabel,
		agentFailureReason,
	)

	if (requireStore) {
		payload.store = await resolveRequiredReference(
			document.store,
			warehouseResolver,
			'Warehouse',
			'Warehouse not found',
		)
	} else if (document.store) {
		const store = await resolveOptionalReference(
			document.store,
			warehouseResolver,
			'Warehouse',
			'Warehouse not found',
		)
		if (store) {
			payload.store = store
		}
	}

	const contract = await resolveOptionalReference(
		document.contract,
		contractResolver,
		'Contract',
		'Contract not found',
	)
	if (contract) {
		payload.contract = contract
	}

	const project = await resolveOptionalReference(
		document.project,
		projectResolver,
		'Project',
		'Project not found',
	)
	if (project) {
		payload.project = project
	}

	const state = await resolveOptionalReference(document.state, stateResolver, 'State')
	if (state) {
		payload.state = state
	}

	const rate = await mapRate(document.rate, { documentType, document })
	if (rate) {
		payload.rate = rate
	}

	const organizationAccount = await mapAccount(
		document.organizationAccount,
		payload.organization,
	)
	if (organizationAccount) {
		payload.organizationAccount = organizationAccount
	}

	const agentAccount = await mapAccount(document.agentAccount, payload.agent)
	if (agentAccount) {
		payload.agentAccount = agentAccount
	}

	const attributes = await mapAttributes(document.attributes, attributeResolver)
	if (attributes) {
		payload.attributes = attributes
	}
	logOk(`Attributes resolved (count=${attributes?.length || 0})`)
}

export function copyScalarFields(payload, source, fields) {
	for (const field of fields) {
		if (source[field] !== undefined) {
			payload[field] = cloneValue(source[field])
		}
	}
}

export async function mapAssortmentPosition(position, document, extraFields = []) {
	const assortment = await resolveRequiredReference(
		position.assortment,
		productResolver,
		`Product in ${getDocumentNumber(document)}`,
		'Product not found',
	)
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
		...extraFields,
	]

	for (const field of fields) {
		if (position[field] !== undefined) {
			mappedPosition[field] = cloneValue(position[field])
		}
	}

	if (position.country) {
		const country = await resolveOptionalReference(
			position.country,
			countryResolver,
			'Country',
			'Country not found',
		)
		if (country) {
			mappedPosition.country = country
		}
	}

	return mappedPosition
}
