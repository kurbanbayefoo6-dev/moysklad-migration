import { BaseRepository } from './baseRepository.js'

export class WarehouseRepository extends BaseRepository {
	constructor(options = {}) {
		super({
			endpoint: 'entity/store',
			...options,
		})
	}
}

export const warehouseRepository = new WarehouseRepository()

export default warehouseRepository
