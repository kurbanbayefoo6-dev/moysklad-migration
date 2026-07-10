import { counterpartyRepository } from '../repositories/counterpartyRepository.js'
import { organizationRepository } from '../repositories/organizationRepository.js'
import { BaseResolver } from './BaseResolver.js'
import { logIgnoredError } from '../utils/migrationDiagnostics.js'

const COPY_FIELDS = [
	'name',
	'code',
	'externalCode',
	'phone',
	'email',
	'inn',
	'kpp',
	'okpo',
	'description',
	'actualAddress',
	'legalAddress',
	'actualAddressFull',
	'legalAddressFull',
	'tags',
	'archived',
]

function normalizeType(value) {
	return String(value ?? '')
		.trim()
		.toLowerCase()
}

function normalizeExactValue(value) {
	return String(value ?? '').trim()
}

function normalizeLookupValue(value) {
	return normalizeExactValue(value).toLowerCase()
}

function hasValue(value) {
	return value !== undefined && value !== null && value !== ''
}

function getReferenceId(source) {
	return source?.id || source?.meta?.href?.split('/').filter(Boolean).at(-1) || ''
}

function cloneValue(value) {
	if (typeof structuredClone === 'function') {
		return structuredClone(value)
	}

	return JSON.parse(JSON.stringify(value))
}

function formatValue(value) {
	return hasValue(value) ? value : 'Unknown'
}

function printMissingCounterparty(source) {
	return source
}

function getIndexValue(entity, field) {
	if (field === 'trimmedName') {
		return normalizeLookupValue(entity?.name)
	}

	if (field === 'name') {
		return normalizeExactValue(entity?.name)
	}

	if (field === 'email') {
		return normalizeLookupValue(entity?.email)
	}

	return normalizeExactValue(entity?.[field])
}

function buildIndex(entities, field) {
	const index = new Map()

	for (const entity of entities) {
		const value = getIndexValue(entity, field)
		if (!value || index.has(value)) {
			continue
		}

		index.set(value, entity)
	}

	return index
}

function getSourceValue(source, field) {
	if (field === 'trimmedName') {
		return normalizeLookupValue(source?.name)
	}

	if (field === 'name') {
		return normalizeExactValue(source?.name)
	}

	if (field === 'email') {
		return normalizeLookupValue(source?.email)
	}

	return normalizeExactValue(source?.[field])
}

function matchEntity(indexes, source) {
	const strategies = [
		['byExternalCode', 'externalCode'],
		['byCode', 'code'],
		['byName', 'name'],
		['byTrimmedName', 'trimmedName'],
		['byPhone', 'phone'],
		['byEmail', 'email'],
		['byInn', 'inn'],
	]

	for (const [indexName, field] of strategies) {
		const value = getSourceValue(source, field)
		if (!value) {
			continue
		}

		const matchedEntity = indexes[indexName]?.get(value)
		if (matchedEntity) {
			return matchedEntity
		}
	}

	return null
}

async function loadAllCounterparties(repository) {
	return repository.findAll({ client: 'new' })
}

async function loadAllOrganizations(repository) {
	return repository.findAll({ client: 'new' })
}

async function loadCompanySettingsMeta(repository) {
	const response = await repository.resolveClient('new').get('entity/companysettings')
	return response?.meta || null
}

function copyCounterpartyPayload(source) {
	const payload = {}

	for (const field of COPY_FIELDS) {
		if (source[field] !== undefined) {
			payload[field] = cloneValue(source[field])
		}
	}

	if (!payload.name) {
		payload.name = source?.externalCode || source?.code || getReferenceId(source)
	}

	return payload
}

export class CounterpartyResolver extends BaseResolver {
	constructor(options = {}) {
		super({
			entityName: 'Counterparty',
			repository: options.repository || counterpartyRepository,
			client: options.client || 'new',
			strategies: [
				{
					name: 'externalCode',
					field: 'externalCode',
					method: 'findByExternalCode',
				},
				{ name: 'code', field: 'code', method: 'findByCode' },
				{ name: 'name', field: 'name', method: 'findByName' },
			],
		})
		this.counterpartyIndexes = null
		this.counterpartyIndexesPending = null
		this.organizationIndexes = null
		this.organizationIndexesPending = null
		this.companySettingsMeta = null
		this.companySettingsMetaPending = null
		this.createdCounterparties = new Map()
	}

	buildIndexes(entities) {
		return {
			byExternalCode: buildIndex(entities, 'externalCode'),
			byCode: buildIndex(entities, 'code'),
			byName: buildIndex(entities, 'name'),
			byTrimmedName: buildIndex(entities, 'trimmedName'),
			byPhone: buildIndex(entities, 'phone'),
			byEmail: buildIndex(entities, 'email'),
			byInn: buildIndex(entities, 'inn'),
		}
	}

	async getCounterpartyIndexes() {
		if (this.counterpartyIndexes) {
			return this.counterpartyIndexes
		}

		if (!this.counterpartyIndexesPending) {
			this.counterpartyIndexesPending = loadAllCounterparties(
				this.repository,
			).then(counterparties => this.buildIndexes(counterparties))
		}

		this.counterpartyIndexes = await this.counterpartyIndexesPending
		this.counterpartyIndexesPending = null
		return this.counterpartyIndexes
	}

	async getOrganizationIndexes() {
		if (this.organizationIndexes) {
			return this.organizationIndexes
		}

		if (!this.organizationIndexesPending) {
			this.organizationIndexesPending = loadAllOrganizations(
				organizationRepository,
			).then(organizations => this.buildIndexes(organizations))
		}

		this.organizationIndexes = await this.organizationIndexesPending
		this.organizationIndexesPending = null
		return this.organizationIndexes
	}

	async getCompanySettingsMeta() {
		if (this.companySettingsMeta) {
			return this.companySettingsMeta
		}

		if (!this.companySettingsMetaPending) {
			this.companySettingsMetaPending = loadCompanySettingsMeta(this.repository)
		}

		this.companySettingsMeta = await this.companySettingsMetaPending
		this.companySettingsMetaPending = null
		return this.companySettingsMeta
	}

	async getOldCounterpartyDetails(source) {
		const id = getReferenceId(source)
		if (!id) {
			return source
		}

		try {
			return await this.repository.findById(id, { client: 'old' })
		} catch (error) {
			logIgnoredError(
				'Old counterparty details lookup error ignored to preserve migration behavior',
				error,
			)
			return source
		}
	}

	async createMissingCounterparty(source) {
		const id = getReferenceId(source)
		if (id && this.createdCounterparties.has(id)) {
			return this.createdCounterparties.get(id)
		}

		const details = await this.getOldCounterpartyDetails(source)
		printMissingCounterparty(details)

		const existing = matchEntity(await this.getCounterpartyIndexes(), details)
		if (existing?.meta) {
			return existing
		}

		const payload = copyCounterpartyPayload(details)
		const createdCounterparty = await this.repository.create(payload, {
			client: 'new',
		})

		this.counterpartyIndexes = null
		this.counterpartyIndexesPending = null
		this.clearCache()

		if (id) {
			this.createdCounterparties.set(id, createdCounterparty)
		}

		return createdCounterparty
	}

	async resolve(source) {
		const type = normalizeType(source?.meta?.type)
		if (type === 'counterparty') {
			const details = await this.getOldCounterpartyDetails(source)
			const indexes = await this.getCounterpartyIndexes()
			const matchedCounterparty = matchEntity(indexes, details)

			if (matchedCounterparty?.meta) {
				return { meta: matchedCounterparty.meta }
			}

			const createdCounterparty = await this.createMissingCounterparty(details)
			if (createdCounterparty?.meta) {
				return { meta: createdCounterparty.meta }
			}
		}

		if (type === 'organization') {
			const indexes = await this.getOrganizationIndexes()
			const matchedOrganization = matchEntity(indexes, source)

			if (matchedOrganization?.meta) {
				return { meta: matchedOrganization.meta }
			}
		}

		if (type === 'companysettings') {
			const companySettingsMeta = await this.getCompanySettingsMeta()
			if (companySettingsMeta) {
				return { meta: companySettingsMeta }
			}
		}

		printMissingCounterparty(source)
		throw new Error('Counterparty not found')
	}
}

export const counterpartyResolver = new CounterpartyResolver()

export default counterpartyResolver
