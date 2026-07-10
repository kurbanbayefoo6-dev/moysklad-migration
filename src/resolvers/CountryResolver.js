import { BaseRepository } from '../repositories/baseRepository.js'
import { BaseResolver } from './BaseResolver.js'

export class CountryResolver extends BaseResolver {
	constructor(options = {}) {
		super({
			entityName: 'Country',
			repository:
				options.repository ||
				new BaseRepository({
					endpoint: 'entity/country',
				}),
			client: options.client || 'new',
			strategies: [{ name: 'name', field: 'name', method: 'findByName' }],
		})
	}
}

export const countryResolver = new CountryResolver()

export default countryResolver
