import { BaseRepository } from '../repositories/baseRepository.js'
import { BaseResolver } from './BaseResolver.js'

export class UomResolver extends BaseResolver {
	constructor(options = {}) {
		super({
			entityName: 'Uom',
			repository:
				options.repository ||
				new BaseRepository({
					endpoint: 'entity/uom',
				}),
			client: options.client || 'new',
			strategies: [
				{ name: 'name', field: 'name', method: 'findByName' },
				{ name: 'code', field: 'code', method: 'findByCode' },
			],
		})
	}
}

export const uomResolver = new UomResolver()

export default uomResolver
