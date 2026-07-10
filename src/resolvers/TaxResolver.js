import { BaseRepository } from '../repositories/baseRepository.js'
import { BaseResolver } from './BaseResolver.js'

function getTaxName(source) {
	return source?.name || source?.taxName || ''
}

function getTaxRate(source) {
	return source?.rate ?? source?.vat ?? ''
}

export class TaxResolver extends BaseResolver {
	constructor(options = {}) {
		super({
			entityName: 'Tax',
			repository:
				options.repository ||
				new BaseRepository({
					endpoint: 'entity/taxrate',
				}),
			client: options.client || 'new',
			strategies: [
				{ name: 'name', getValue: source => getTaxName(source), method: 'findByName' },
				{ name: 'rate', getValue: source => getTaxRate(source), method: 'findByField', field: 'rate' },
			],
		})
	}

	getEntityFieldValue(entity, strategy) {
		if (strategy.name === 'rate') {
			return entity?.rate
		}

		return super.getEntityFieldValue(entity, strategy)
	}
}

export const taxResolver = new TaxResolver()

export default taxResolver
