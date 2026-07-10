import { pathToFileURL } from 'node:url'

import { oldClient } from '../api/oldClient.js'
import { shipmentMapper } from '../mappers/shipmentMapper.js'
import { shipmentRepository } from '../repositories/shipmentRepository.js'
import { contractResolver } from '../resolvers/ContractResolver.js'
import { counterpartyResolver } from '../resolvers/CounterpartyResolver.js'
import { currencyResolver } from '../resolvers/CurrencyResolver.js'
import { organizationResolver } from '../resolvers/OrganizationResolver.js'
import { priceTypeResolver } from '../resolvers/PriceTypeResolver.js'
import { productResolver } from '../resolvers/ProductResolver.js'
import { projectResolver } from '../resolvers/ProjectResolver.js'
import { uomResolver } from '../resolvers/UomResolver.js'
import { warehouseResolver } from '../resolvers/WarehouseResolver.js'
import {
	buildShipmentIdentityKey,
	buildShipmentIdentityMap,
	compareShipmentContent,
	describeShipmentIdentity,
	findShipmentIdentityCandidates,
	prepareShipmentForIdentity,
} from '../utils/shipmentIdentity.js'
import { validateShipmentPayload } from '../validators/shipmentValidator.js'

function isObject(value) {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getShipmentNumber(shipment) {
	return shipment?.name || shipment?.number || shipment?.code || shipment?.id || ''
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

function getHref(entity) {
	return entity?.meta?.href || entity?.href || ''
}

function getRelativeApiPath(href) {
	const marker = '/api/remap/1.2/'
	const index = href?.indexOf(marker) ?? -1
	return index >= 0 ? href.slice(index + marker.length) : href
}

function hasMeta(reference) {
	return Boolean(
		reference?.meta?.href &&
			reference?.meta?.type &&
			reference?.meta?.mediaType,
	)
}

function sameValue(left, right) {
	return String(left ?? '') === String(right ?? '')
}

function formatReason(error) {
	return error?.message || 'Unknown error'
}

function formatReference(value) {
	if (value === undefined || value === null || value === '') {
		return ''
	}

	if (!isObject(value)) {
		return String(value)
	}

	const parts = []
	for (const field of ['name', 'code', 'article', 'externalCode', 'id']) {
		if (value[field] !== undefined && value[field] !== null && value[field] !== '') {
			parts.push(`${field}: ${value[field]}`)
		}
	}

	if (value.meta?.type) {
		parts.push(`type: ${value.meta.type}`)
	}

	if (value.meta?.href) {
		parts.push(`href: ${value.meta.href}`)
	}

	return parts.length ? parts.join(', ') : JSON.stringify(value)
}

function getExpectedMapping(field) {
	if (field === 'organization') {
		return 'NEW organization matched by externalCode or exact name'
	}

	if (field === 'warehouse') {
		return 'NEW warehouse matched by externalCode or exact name'
	}

	if (field === 'counterparty' || field === 'agent') {
		return 'NEW counterparty or organization matched by externalCode or exact name'
	}

	if (field === 'currency') {
		return 'NEW currency matched from OLD currency by code/name or NEW default currency'
	}

	if (field === 'positions') {
		return 'At least one valid shipment position'
	}

	if (field.includes('assortment')) {
		return 'NEW product/service matched by externalCode, code, article, or exact name'
	}

	if (field.startsWith('payload.')) {
		return 'Mapped shipment payload accepted by shipment validator'
	}

	return `Valid mapping for ${field}`
}

function createStats() {
	return {
		shipmentsChecked: 0,
		productsResolved: 0,
		counterpartiesResolved: 0,
		organizationsResolved: 0,
		warehousesResolved: 0,
		contractsResolved: 0,
		projectsResolved: 0,
		currenciesResolved: 0,
		priceTypesResolved: 0,
		unitsResolved: 0,
		errors: [],
		warnings: [],
		productDetailsCache: new Map(),
	}
}

function addIssue(
	collection,
	shipment,
	field,
	reason,
	{ currentValue = '', expectedMapping = '' } = {},
) {
	collection.push({
		shipmentNumber: getShipmentNumber(shipment),
		shipmentId: shipment?.id || '',
		field,
		reason,
		currentValue,
		expectedMapping: expectedMapping || getExpectedMapping(field),
	})
}

function addError(stats, shipment, field, reason, details = {}) {
	addIssue(stats.errors, shipment, field, reason, details)
}

function addWarning(stats, shipment, field, reason, details = {}) {
	addIssue(stats.warnings, shipment, field, reason, details)
}

async function runCheck(
	stats,
	shipment,
	field,
	action,
	onSuccess,
	{ currentValue = '', expectedMapping = '' } = {},
) {
	try {
		const result = await action()
		if (onSuccess) {
			await onSuccess(result)
		}
		return result
	} catch (error) {
		addError(stats, shipment, field, formatReason(error), {
			currentValue,
			expectedMapping,
		})
		return null
	}
}

async function runOptionalCheck(stats, shipment, field, action, onSuccess) {
	try {
		const result = await action()
		if (onSuccess) {
			await onSuccess(result)
		}
		return result
	} catch (error) {
		addWarning(stats, shipment, field, formatReason(error))
		return null
	}
}

async function resolveRequired(stats, shipment, field, source, resolver, counter) {
	if (!source) {
		addError(stats, shipment, field, `${field} is missing`, {
			currentValue: formatReference(source),
			expectedMapping: getExpectedMapping(field),
		})
		return null
	}

	return runCheck(
		stats,
		shipment,
		field,
		() => resolver.resolve(source),
		result => {
			if (hasMeta(result)) {
				stats[counter] += 1
			} else {
				addError(stats, shipment, field, `${field} did not return meta`, {
					currentValue: formatReference(source),
					expectedMapping: getExpectedMapping(field),
				})
			}
		},
		{
			currentValue: formatReference(source),
			expectedMapping: getExpectedMapping(field),
		},
	)
}

async function resolveOptional(
	stats,
	shipment,
	field,
	source,
	resolver,
	counter,
	{ warnMissing = true } = {},
) {
	if (!source) {
		if (warnMissing) {
			addWarning(stats, shipment, field, `${field} is not present`)
		}
		return null
	}

	return runOptionalCheck(
		stats,
		shipment,
		field,
		() => resolver.resolve(source),
		result => {
			if (hasMeta(result)) {
				stats[counter] += 1
			} else {
				addWarning(stats, shipment, field, `${field} did not return meta`)
			}
		},
	)
}

async function resolveCurrency(stats, shipment) {
	const currency = shipment?.rate?.currency || shipment?.currency
	if (!currency) {
		addError(stats, shipment, 'currency', 'Currency is not present', {
			currentValue: '',
			expectedMapping: getExpectedMapping('currency'),
		})
		return null
	}

	return runCheck(
		stats,
		shipment,
		'currency',
		() => currencyResolver.resolveOldReference(currency),
		result => {
			if (hasMeta(result)) {
				stats.currenciesResolved += 1
			} else {
				addError(stats, shipment, 'currency', 'Currency did not return meta', {
					currentValue: formatReference(currency),
					expectedMapping: getExpectedMapping('currency'),
				})
			}
		},
		{
			currentValue: formatReference(currency),
			expectedMapping: getExpectedMapping('currency'),
		},
	)
}

async function loadOldProductDetails(stats, assortment) {
	const href = getHref(assortment)
	if (!href) {
		return assortment
	}

	if (stats.productDetailsCache.has(href)) {
		return stats.productDetailsCache.get(href)
	}

	const details = await oldClient.get(getRelativeApiPath(href))
	stats.productDetailsCache.set(href, details)
	return details
}

async function verifyProductDependencies(stats, shipment, product, positionIndex) {
	if (product?.uom) {
		await runOptionalCheck(
			stats,
			shipment,
			`positions[${positionIndex}].assortment.uom`,
			() => uomResolver.resolve(product.uom),
			result => {
				if (hasMeta(result)) {
					stats.unitsResolved += 1
				} else {
					addWarning(
						stats,
						shipment,
						`positions[${positionIndex}].assortment.uom`,
						'Unit did not return meta',
					)
				}
			},
		)
	} else {
		addWarning(
			stats,
			shipment,
			`positions[${positionIndex}].assortment.uom`,
			'Unit is not present',
		)
	}

	const salePrices = Array.isArray(product?.salePrices) ? product.salePrices : []
	for (let index = 0; index < salePrices.length; index += 1) {
		const salePrice = salePrices[index]
		if (!salePrice?.priceType) {
			addWarning(
				stats,
				shipment,
				`positions[${positionIndex}].assortment.salePrices[${index}].priceType`,
				'Price type is not present',
			)
			continue
		}

		await runOptionalCheck(
			stats,
			shipment,
			`positions[${positionIndex}].assortment.salePrices[${index}].priceType`,
			() => priceTypeResolver.resolve(salePrice.priceType),
			result => {
				if (hasMeta(result)) {
					stats.priceTypesResolved += 1
				} else {
					addWarning(
						stats,
						shipment,
						`positions[${positionIndex}].assortment.salePrices[${index}].priceType`,
						'Price type did not return meta',
					)
				}
			},
		)
	}
}

async function verifyProducts(stats, shipment) {
	const positions = getPositions(shipment)
	if (!positions.length) {
		addError(stats, shipment, 'positions', 'Shipment has no positions', {
			currentValue: '0 positions',
			expectedMapping: getExpectedMapping('positions'),
		})
		return
	}

	for (let index = 0; index < positions.length; index += 1) {
		const position = positions[index]
		if (!isObject(position)) {
			addError(stats, shipment, `positions[${index}]`, 'Position is invalid', {
				currentValue: formatReference(position),
				expectedMapping: 'Valid shipment position object',
			})
			continue
		}

		if (!position.assortment) {
			addError(
				stats,
				shipment,
				`positions[${index}].assortment`,
				'Product is missing',
				{
					currentValue: '',
					expectedMapping: getExpectedMapping('positions.assortment'),
				},
			)
			continue
		}

		await runCheck(
			stats,
			shipment,
			`positions[${index}].assortment`,
			() => productResolver.resolve(position.assortment, {
				shipmentNumber: getShipmentNumber(shipment),
			}),
			result => {
				if (hasMeta(result)) {
					stats.productsResolved += 1
				} else {
					addError(
						stats,
						shipment,
						`positions[${index}].assortment`,
						'Product did not return meta',
						{
							currentValue: formatReference(position.assortment),
							expectedMapping: getExpectedMapping('positions.assortment'),
						},
					)
				}
			},
			{
				currentValue: formatReference(position.assortment),
				expectedMapping: getExpectedMapping('positions.assortment'),
			},
		)

		await runOptionalCheck(
			stats,
			shipment,
			`positions[${index}].assortment.details`,
			() => loadOldProductDetails(stats, position.assortment),
			product => verifyProductDependencies(stats, shipment, product, index),
		)
	}
}

function verifyTextPreserved(stats, shipment, payload) {
	if (
		shipment?.description === undefined ||
		shipment?.description === null ||
		shipment?.description === ''
	) {
		addWarning(stats, shipment, 'comment', 'Comment is not present')
		addWarning(stats, shipment, 'description', 'Description is not present')
		return
	}

	if (!sameValue(shipment?.description, payload?.description)) {
		addWarning(
			stats,
			shipment,
			'comment',
			'Comment/description is not preserved in payload',
		)
	}

	if (!sameValue(shipment?.description, payload?.description)) {
		addWarning(
			stats,
			shipment,
			'description',
			'Description is not preserved in payload',
		)
	}
}

function verifyPositionsValid(stats, shipment, payload) {
	const positions = getPositions(payload)
	if (!positions.length) {
		addError(stats, shipment, 'positions', 'Mapped payload has no positions', {
			currentValue: '0 mapped positions',
			expectedMapping: getExpectedMapping('positions'),
		})
		return
	}

	for (let index = 0; index < positions.length; index += 1) {
		const position = positions[index]
		if (!hasMeta(position?.assortment)) {
			addError(
				stats,
				shipment,
				`payload.positions[${index}].assortment`,
				'Mapped position assortment meta is invalid',
				{
					currentValue: formatReference(position?.assortment),
					expectedMapping: getExpectedMapping('payload.positions.assortment'),
				},
			)
		}

		if (position?.quantity === undefined) {
			addError(
				stats,
				shipment,
				`payload.positions[${index}].quantity`,
				'Mapped position quantity is missing',
				{
					currentValue: formatReference(position),
					expectedMapping: 'Mapped position quantity copied from OLD shipment',
				},
			)
		}
	}
}

async function verifyShipment(stats, shipmentSummary) {
	const shipment = await shipmentRepository.findById(shipmentSummary.id, {
		client: 'old',
	})
	stats.shipmentsChecked += 1

	console.log(
		`[${stats.shipmentsChecked}] Verifying shipment ${getShipmentNumber(shipment)}`,
	)

	await resolveRequired(
		stats,
		shipment,
		'organization',
		shipment.organization,
		organizationResolver,
		'organizationsResolved',
	)
	await resolveRequired(
		stats,
		shipment,
		'warehouse',
		shipment.store,
		warehouseResolver,
		'warehousesResolved',
	)
	await resolveRequired(
		stats,
		shipment,
		'counterparty',
		shipment.counterparty || shipment.agent,
		counterpartyResolver,
		'counterpartiesResolved',
	)
	await resolveOptional(
		stats,
		shipment,
		'agent',
		shipment.agent,
		counterpartyResolver,
		'counterpartiesResolved',
		{ warnMissing: false },
	)
	await resolveOptional(
		stats,
		shipment,
		'contract',
		shipment.contract,
		contractResolver,
		'contractsResolved',
	)
	await resolveOptional(
		stats,
		shipment,
		'project',
		shipment.project,
		projectResolver,
		'projectsResolved',
	)
	await resolveCurrency(stats, shipment)
	await verifyProducts(stats, shipment)

	const payload = await runCheck(
		stats,
		shipment,
		'payload.mapping',
		() => shipmentMapper.map(shipment),
		null,
		{
			currentValue: `Shipment ${getShipmentNumber(shipment)} (${shipment?.id || ''})`,
			expectedMapping: 'Mapped payload with all required NEW account references',
		},
	)
	if (!payload) {
		return
	}

	verifyTextPreserved(stats, shipment, payload)
	verifyPositionsValid(stats, shipment, payload)

	await runCheck(
		stats,
		shipment,
		'payload.validation',
		() => Promise.resolve(validateShipmentPayload(payload)),
		null,
		{
			currentValue: JSON.stringify({
				name: payload?.name,
				moment: payload?.moment,
				organization: hasMeta(payload?.organization),
				store: hasMeta(payload?.store),
				agent: hasMeta(payload?.agent),
				positions: getPositions(payload).length,
			}),
			expectedMapping: getExpectedMapping('payload.validation'),
		},
	)
}

function printIssues(title, issues) {
	if (!issues.length) {
		return
	}

	console.log('')
	console.log(title)
	console.log('')

	for (const issue of issues) {
		console.log('--------------------------------')
		console.log(`Shipment Number: ${issue.shipmentNumber}`)
		console.log(`Shipment ID: ${issue.shipmentId}`)
		console.log(`Field: ${issue.field}`)
		console.log(`Reason: ${issue.reason}`)
		console.log(`Current Value: ${issue.currentValue || ''}`)
		console.log(`Expected Mapping: ${issue.expectedMapping || ''}`)
		console.log('--------------------------------')
	}
}

function getIssueType(issue) {
	return `${issue.field}: ${issue.reason}`
}

function groupIssues(issues) {
	const groups = new Map()

	for (const issue of issues) {
		const type = getIssueType(issue)
		if (!groups.has(type)) {
			groups.set(type, {
				type,
				shipmentNumbers: new Set(),
			})
		}

		groups.get(type).shipmentNumbers.add(issue.shipmentNumber)
	}

	return [...groups.values()].map(group => ({
		type: group.type,
		shipmentNumbers: [...group.shipmentNumbers],
	}))
}

function printRequiredErrorGroups(errors) {
	if (!errors.length) {
		return
	}

	const groups = groupIssues(errors)

	console.log('')
	console.log('Required error types:')
	console.log('')

	for (let index = 0; index < groups.length; index += 1) {
		const group = groups[index]
		console.log(`${index + 1}.`)
		console.log(`Type: ${group.type}`)
		console.log(`Affected shipments: ${group.shipmentNumbers.length}`)
		console.log(`Shipment numbers: ${group.shipmentNumbers.join(', ')}`)
		console.log('')
	}
}

function printSummary(stats) {
	console.log('--------------------------------')
	console.log('Verification summary')
	console.log(`Shipments checked: ${stats.shipmentsChecked}`)
	console.log(`Products resolved: ${stats.productsResolved}`)
	console.log(`Counterparties resolved: ${stats.counterpartiesResolved}`)
	console.log(`Organizations resolved: ${stats.organizationsResolved}`)
	console.log(`Warehouses resolved: ${stats.warehousesResolved}`)
	console.log(`Contracts resolved: ${stats.contractsResolved}`)
	console.log(`Projects resolved: ${stats.projectsResolved}`)
	console.log(`Currencies resolved: ${stats.currenciesResolved}`)
	console.log(`PriceTypes resolved: ${stats.priceTypesResolved}`)
	console.log(`Units resolved: ${stats.unitsResolved}`)
	console.log(`Errors: ${stats.errors.length}`)
	console.log(`Warnings: ${stats.warnings.length}`)
	console.log(`Required errors: ${stats.errors.length}`)
	console.log(`Optional warnings: ${stats.warnings.length}`)
	console.log(`Migration safe: ${stats.errors.length === 0 ? 'YES' : 'NO'}`)
	console.log('--------------------------------')
}

function findDiagnosticCandidates(mappedOldShipment, newShipments) {
	return findShipmentIdentityCandidates(mappedOldShipment, newShipments)
}

function formatDifferences(differences) {
	return differences
		.map(
			difference =>
				`${difference.field}: OLD=${difference.left || ''} NEW=${difference.right || ''}`,
		)
		.join('\n')
}

function printDifferentVerification({ oldShipment, mappedShipment, candidates }) {
	console.log('--------------------------------')
	console.log('DIFFERENT')
	console.log(`Shipment Number: ${getShipmentNumber(oldShipment)}`)
	console.log(`Shipment ID: ${oldShipment?.id || ''}`)
	console.log('Expected identity:')
	console.log(describeShipmentIdentity(mappedShipment))

	for (const candidate of candidates) {
		console.log('')
		console.log(`NEW Shipment Number: ${getShipmentNumber(candidate)}`)
		console.log(`NEW Shipment ID: ${candidate?.id || ''}`)
		console.log('Differences:')
		console.log(formatDifferences(compareShipmentContent(mappedShipment, candidate)))
	}

	console.log('--------------------------------')
}

function printMissingVerification({ oldShipment, mappedShipment }) {
	console.log('--------------------------------')
	console.log('MISSING')
	console.log(`Shipment Number: ${getShipmentNumber(oldShipment)}`)
	console.log(`Shipment ID: ${oldShipment?.id || ''}`)
	console.log('Expected identity:')
	console.log(describeShipmentIdentity(mappedShipment))
	console.log('--------------------------------')
}

async function compareExistingNewShipments(oldShipments) {
	const newShipments = await shipmentRepository.findAll({
		client: 'new',
		params: {
			expand: 'organization,store,agent,counterparty,positions.assortment',
		},
	})
	const newShipmentMap = buildShipmentIdentityMap(newShipments)
	const missing = []
	const different = []

	console.log('')
	console.log('Existing NEW shipment comparison:')

	for (const oldShipmentSummary of oldShipments) {
		const oldShipment = await shipmentRepository.findById(oldShipmentSummary.id, {
			client: 'old',
		})
		const mappedShipment = prepareShipmentForIdentity(
			await shipmentMapper.map(oldShipment),
			oldShipment,
		)
		const exactMatch = newShipmentMap.get(buildShipmentIdentityKey(mappedShipment))?.[0]

		if (exactMatch) {
			const differences = compareShipmentContent(mappedShipment, exactMatch)
			if (differences.length > 0) {
				different.push({
					oldShipment,
					mappedShipment,
					candidates: [exactMatch],
				})
			}
			continue
		}

		const candidates = findDiagnosticCandidates(mappedShipment, newShipments)
		if (candidates.length > 0) {
			different.push({ oldShipment, mappedShipment, candidates })
		} else {
			missing.push({ oldShipment, mappedShipment })
		}
	}

	for (const item of different) {
		printDifferentVerification(item)
	}

	for (const item of missing) {
		printMissingVerification(item)
	}

	console.log(`Different shipments: ${different.length}`)
	console.log(`Missing shipments: ${missing.length}`)

	return { different, missing }
}

export async function verifyMigration() {
	const stats = createStats()
	const oldShipments = await shipmentRepository.findAll({ client: 'old' })

	for (const shipment of oldShipments) {
		try {
			await verifyShipment(stats, shipment)
		} catch (error) {
			addError(stats, shipment, 'shipment', formatReason(error), {
				currentValue: formatReference(shipment),
				expectedMapping: 'Shipment details can be loaded and verified',
			})
		}
	}

	printIssues('Required errors:', stats.errors)
	printRequiredErrorGroups(stats.errors)
	if (stats.errors.length === 0) {
		await compareExistingNewShipments(oldShipments)
	}
	printSummary(stats)

	if (stats.errors.length > 0) {
		process.exitCode = 1
	}

	return stats
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	verifyMigration().catch(error => {
		console.log('Verification failed before all shipments could be checked')
		console.log(formatReason(error))
		process.exitCode = 1
	})
}

export default verifyMigration
