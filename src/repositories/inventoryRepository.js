import { BaseRepository } from './baseRepository.js'

const INVENTORY_EXPAND = [
	'organization',
	'store',
	'positions.assortment',
	'state',
	'project',
	'owner',
	'group',
].join(',')

export class InventoryRepository extends BaseRepository {
	constructor(options = {}) {
		super({
			endpoint: 'entity/inventory',
			...options,
		})
	}

	findById(id, options = {}) {
		return super.findById(id, {
			...options,
			params: {
				expand: INVENTORY_EXPAND,
				...(options.params || {}),
			},
		})
	}
}

export const inventoryRepository = new InventoryRepository()

export default inventoryRepository
