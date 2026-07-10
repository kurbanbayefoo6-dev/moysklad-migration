import { BaseRepository } from '../repositories/baseRepository.js'
import { BaseResolver } from './BaseResolver.js'

export class PriceTypeResolver extends BaseResolver {
	constructor(options = {}) {
		super({
			entityName: 'PriceType',
			repository:
				options.repository ||
				new BaseRepository({
					endpoint: 'context/companysettings/pricetype',
				}),
			client: options.client || 'new',
			strategies: [{ name: 'name', field: 'name', method: 'findByName' }],
		})
	}
}

export const priceTypeResolver = new PriceTypeResolver()

export default priceTypeResolver
