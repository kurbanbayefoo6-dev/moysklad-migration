import { BaseRepository } from './baseRepository.js'

export class ShipmentRepository extends BaseRepository {
	constructor(options = {}) {
		super({
			endpoint: 'entity/demand',
			...options,
		})
	}

	async findById(id, options = {}) {
		const expand = [
			'organization',
			'store',
			'counterparty',
			'agent',
			'positions.assortment',
		]

		const params = {
			...(options.params || {}),
			expand: expand.join(','),
		}

		return super.findById(id, {
			...options,
			params,
		})
	}
}

export const shipmentRepository = new ShipmentRepository()

export default shipmentRepository
