import { currencyRepository } from '../repositories/currencyRepository.js'
import { BaseResolver } from './BaseResolver.js'

function getCurrencyCode(source) {
	return source?.code || source?.isoCode || source?.name || ''
}

export class CurrencyResolver extends BaseResolver {
	constructor(options = {}) {
		super({
			entityName: 'Currency',
			repository: options.repository || currencyRepository,
			client: options.client || 'new',
			strategies: [
				{
					name: 'code',
					getValue: source => getCurrencyCode(source),
					method: 'findByCode',
				},
				{ name: 'name', field: 'name', method: 'findByName' },
			],
		})
	}
}

export const currencyResolver = new CurrencyResolver()

export default currencyResolver
