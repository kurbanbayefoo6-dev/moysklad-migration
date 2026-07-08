import { warehouseRepository } from '../repositories/warehouseRepository.js'
import { BaseResolver } from './BaseResolver.js'

export class WarehouseResolver extends BaseResolver {
	constructor(options = {}) {
		super({
			entityName: 'Warehouse',
			repository: options.repository || warehouseRepository,
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
}

export const warehouseResolver = new WarehouseResolver()

export default warehouseResolver
