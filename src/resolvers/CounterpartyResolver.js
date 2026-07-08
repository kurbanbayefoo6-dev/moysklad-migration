import { counterpartyRepository } from '../repositories/counterpartyRepository.js'
import { BaseResolver } from './BaseResolver.js'

function normalizeValue(value) {
	return String(value ?? '')
		.trim()
		.toLowerCase()
}

function printCounterpartyNotFound(source) {
	console.log('Counterparty not found:')
	console.log(`- old id: ${source?.id || 'Unknown'}`)
	console.log(`- old name: ${source?.name || 'Unknown'}`)
	console.log(`- old externalCode: ${source?.externalCode || 'Unknown'}`)
}

function matchCounterparty(counterparties, source) {
	const externalCode = normalizeValue(source?.externalCode)
	if (externalCode) {
		const byExternalCode = counterparties.find(
			counterparty =>
				normalizeValue(counterparty?.externalCode) === externalCode,
		)
		if (byExternalCode) {
			return byExternalCode
		}
	}

	const name = normalizeValue(source?.name)
	if (name) {
		return counterparties.find(
			counterparty => normalizeValue(counterparty?.name) === name,
		)
	}

	return null
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
				{ name: 'name', field: 'name', method: 'findByName' },
			],
		})
	}

	async resolve(source) {
		const counterparties = await this.repository.findAll({ client: 'new' })
		const matchedCounterparty = matchCounterparty(counterparties, source)

		if (matchedCounterparty?.meta) {
			return { meta: matchedCounterparty.meta }
		}

		printCounterpartyNotFound(source)
		throw new Error('Counterparty not found')
	}
}

export const counterpartyResolver = new CounterpartyResolver()

export default counterpartyResolver
